/**
 * One-way sync: Libanex (partner delivery system) → this PWA.
 *
 * Entry points:
 *  - importSellerOrders(sellerId): first-time bulk import of one seller's orders
 *    (triggered from /admin/libanex).
 *  - runSyncForLinkedSellers(): incremental status + history updates for every
 *    seller we already have links for (triggered by the 30-minute cron).
 *
 * Idempotency: every order we know about has a LibanexLink row keyed by the
 * Libanex order id (which equals our Order.orderId, e.g. "556-20738"). Orders
 * that already exist in the PWA are adopted (linked) instead of duplicated.
 *
 *  Status mapping (Libanex → PWA runtime strings):
 *  Location: W/WH/W9/OP→WAREHOUSE, CP/CP1→CP, Dr/DrD/DrR→ASSIGNED,
 *            Tr→ASSIGNED_TR, De→DELIVERED, Re/Ba/Rc→RETURN (fin forced RWD).
 *  Fin:      UD/WD pass through, Re→RWD; WO/PS are NEVER synced (owner rule:
 *            "With Office"/"Paid to Seller" are financial statements that only
 *            a Jett employee may set, so both payout systems can be compared);
 *            unknown codes keep the last valid value and are reported as
 *            warnings. The raw Libanex code is still stored on the link row.
 *  Delivery: Libanex "De" makes the PWA order DELIVERED + WD (cash with the
 *            driver, exactly like PATCH /api/orders). A Jett-side WO/PS is
 *            never downgraded, so Libanex can undo a delivery (back to
 *            warehouse / out for delivery / returned) but can never mark an
 *            order paid on our side.
 *
 * Driver rule: imported orders get driver D999 ("Libanex"). If an operator
 * later reassigns the order to another driver, the sync never touches the
 * driver field again (but still updates status/amounts).
 */
import prisma from "@/lib/prisma";

const API_URL =
  process.env.LIBANEX_API_URL ||
  "http://83.149.106.196/libanexbackup/api/internal/v1";
const API_KEY = process.env.LIBANEX_API_KEY || "";

const LIBANEX_DRIVER_CODE = "D999";
const LIBANEX_SYSTEM_USERNAME = "libanex";
const FALLBACK_ZONE_NAME = "99";

// Location codes accepted by the Libanex create_order endpoint (export side).
export const LIBANEX_LOCATION_CODES = [
  "W", "WH", "W9", "OP", "CP", "CP1", "Dr", "DrD", "DrR", "Tr", "De", "Re", "Ba", "Rc",
] as const;
// Fin-status codes currently defined in the Libanex FinStatus table.
export const LIBANEX_FIN_CODES = [
  "DC", "DP", "PS", "RD", "RM", "RS", "RW", "UD", "UP", "UR", "WC", "WD", "WO", "XD", "XS", "XW",
] as const;

const PAGE_LIMIT = 500;
const MAX_ORDERS_PER_IMPORT = 10000;
const MAX_HISTORY_ROWS_PER_RUN = 20000;
const MAX_STATUS_FETCHES_PER_SELLER = 400;

const LOCATION_MAP: Record<string, string> = {
  W: "WAREHOUSE",
  WH: "WAREHOUSE",
  W9: "WAREHOUSE",
  OP: "WAREHOUSE",
  CP: "CP",
  CP1: "CP",
  Dr: "ASSIGNED",
  DrD: "ASSIGNED",
  DrR: "ASSIGNED",
  Tr: "ASSIGNED_TR",
  De: "DELIVERED",
};

const RETURN_LOCATIONS = new Set(["Re", "Ba", "Rc"]);

const FIN_MAP: Record<string, string> = {
  UD: "UD",
  WD: "WD",
  // WO/PS are listed for completeness (they are real Libanex codes) but are
  // deliberately NOT applied — see JETT_OWNED_FIN_CODES below.
  WO: "WO",
  PS: "PS",
  Re: "RWD",
};

/**
 * Financial statuses owned by Jett, never by Libanex.
 *
 * WO (With Office) and PS (Paid to Seller) are produced only by Jett's payout
 * workflows (driver payout approval, merchant statements, cash batches). If the
 * sync mirrored them, orders would silently leave
 * PAID_OUT_ELIGIBLE_STATUSES (lib/commission.ts) and disappear from payouts.
 * They are also never written back to the PWA in reverse: a Jett-side WO/PS is
 * never downgraded to WD by a Libanex "De".
 */
const JETT_OWNED_FIN_CODES = new Set(["WO", "PS"]);

export interface LibanexOrder {
  order_id: string;
  date_rcvd: string | null;
  date_closed: string | null;
  seller_id: string;
  amount: string | null;
  customer: string | null;
  address: string | null;
  city: string | null;
  tel_number: string | null;
  driver: string | null;
  zone: string | null;
  location: string | null;
  fin_status: string | null;
  amt_collected: string | null;
  amt_ll: string | null;
  ex_shipping: string | null;
  amt_ll_collected: string | null;
  notes: string | null;
  packages: string | null;
}

export interface LibanexHistoryRow {
  order_id: string;
  stamp: string;
  location: string | null;
  driver: string | null;
  note: string | null;
  entered_by: string | null;
}

export interface ImportSummary {
  sellerId: string;
  fetched: number;
  created: number;
  adopted: number;
  skipped: number;
  warnings: string[];
}

export interface SyncResult {
  sellerId: string;
  historyRows: number;
  ordersUpdated: number;
  ordersDriverProtected: number;
  warnings: string[];
}

// ── Small helpers ────────────────────────────────────────────────────────────

function num(v: string | null | undefined): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** "2026-06-01 09:13:05" → Date (interpreted in the server's local time). */
function parseStamp(s: string): Date {
  return new Date(s.replace(" ", "T"));
}

/**
 * The Libanex received date (date_rcvd) for a newly imported order.
 * Imported orders must show their real received date, exactly like the
 * Bulk Excel/CSV and Google Sheets import paths do — never the import
 * timestamp. Falls back to "now" only when Libanex has no usable date.
 */
function receivedDate(lx: LibanexOrder): Date {
  const raw = (lx.date_rcvd ?? "").trim();
  if (!raw) return new Date();
  const d = parseStamp(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Date → "YYYY-MM-DD HH:MM:SS" in local time (what the Libanex API expects). */
function toApiStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

async function libanexPost(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<any> {
  if (!API_KEY) throw new Error("LIBANEX_API_KEY is not configured");
  const url = new URL(`${API_URL}/${endpoint}`);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(
      `Libanex API ${endpoint} failed: HTTP ${res.status} ${body?.error ?? ""}`.trim(),
    );
  }
  return body;
}

export async function libanexGet(
  endpoint: string,
  params: Record<string, string>,
): Promise<{ data: any[]; pagination: { total: number; returned: number } }> {
  if (!API_KEY) throw new Error("LIBANEX_API_KEY is not configured");
  const url = new URL(`${API_URL}/${endpoint}`);
  url.searchParams.set("apikey", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(
      `Libanex API ${endpoint} failed: HTTP ${res.status} ${body?.error ?? ""}`.trim(),
    );
  }
  return body;
}

/**
 * The financial status that goes with a PWA location, identical to the
 * server-side rule in PATCH /api/orders (app/api/orders/route.ts): DELIVERED →
 * WD (cash with the driver), WAREHOUSE/ASSIGNED/ASSIGNED_TR/WITH_DRIVER → UD,
 * RETURN → RWD. CP is intentionally absent: it carries no money meaning, so the
 * previous financial status is preserved.
 */
const LOCATION_FIN: Record<string, string> = {
  DELIVERED: "WD",
  RETURN: "RWD",
  WAREHOUSE: "UD",
  ASSIGNED: "UD",
  ASSIGNED_TR: "UD",
  WITH_DRIVER: "UD",
};

/**
 * Map a Libanex order onto PWA status strings.
 *
 * The physical flow always follows Libanex, including un-delivering an order:
 * Libanex puts it back in the warehouse, back on a driver, or returns it and the
 * PWA follows (owner rule). The one thing Libanex may NOT change is its own
 * money bookkeeping: Libanex WO/PS are never mirrored onto the PWA, because
 * "With Office" and "Paid to Seller" are statements a Jett employee creates via
 * a payout — that is what lets both systems be compared side by side.
 *
 * So financial status follows the PWA location (LOCATION_FIN) only when Libanex
 * actually moved the order, which means:
 *  - Libanex "De"  → DELIVERED + WD (never PS/WO);
 *  - Libanex warehouse/driver/return → UD/RWD, and this also releases an order
 *    we had already cleared to WO/PS, since the goods really moved;
 *  - Libanex changed only WO/PS, location unchanged → Jett value is kept.
 */
function mapStatus(
  rawLoc: string | null,
  rawFin: string | null,
  currentLoc: string,
  currentFin: string,
  orderId: string,
  warnings: string[],
): { location: string; financialStatus: string } {
  let location = currentLoc;
  const financialStatus = currentFin;

  const loc = (rawLoc ?? "").trim();
  const fin = (rawFin ?? "").trim();

  // Our WO/PS came from a Jett payout: a matching Libanex code is expected
  // bookkeeping, not a disagreement, so it must not raise a warning.
  const jettManagedPayout = JETT_OWNED_FIN_CODES.has(currentFin);

  let locationChanged = false;
  if (RETURN_LOCATIONS.has(loc)) {
    // Confirmed rule: a returned order shows as RETURN on the PWA.
    locationChanged = location !== "RETURN";
    location = "RETURN";
  } else if (loc && LOCATION_MAP[loc]) {
    locationChanged = location !== LOCATION_MAP[loc];
    location = LOCATION_MAP[loc];
  } else if (loc) {
    warnings.push(
      `Order ${orderId}: unknown Libanex location "${loc}" — kept "${currentLoc}"`,
    );
  }

  if (fin && JETT_OWNED_FIN_CODES.has(fin)) {
    // Owner rule: WO/PS are financial statements made on Jett only, so they are
    // recorded on the link row (audit) but never mirrored onto the order. The
    // order keeps its payout status (WD/UD) and stays visible in payouts.
    if (!jettManagedPayout) {
      warnings.push(
        `Order ${orderId}: Libanex fin "${fin}" NOT applied — WO/PS are set by Jett payouts only`,
      );
    }
  } else if (fin && !FIN_MAP[fin] && !RETURN_LOCATIONS.has(loc)) {
    warnings.push(
      `Order ${orderId}: unknown Libanex fin status "${fin}" — kept "${currentFin}"`,
    );
  }

  // Money state follows the physical move, never Libanex's own WO/PS bookkeeping.
  //  - Libanex physically moved the order (warehouse, out for delivery,
  //    delivered, returned) → the PWA takes the financial status that goes with
  //    that location, exactly like PATCH /api/orders does. This is what lets an
  //    undelivery/return on Libanex still come through.
  //  - Libanex only changed its WO/PS (location unchanged) → the PWA keeps the
  //    Jett payout value, so payouts/statement comparisons stay intact.
  const derivedFin = LOCATION_FIN[location];
  if (locationChanged && derivedFin) {
    return { location, financialStatus: derivedFin };
  }
  return { location, financialStatus };
}

// ── Context (system user, D999 driver, zone cache) ──────────────────────────

interface SyncContext {
  systemUserId: string;
  driverId: string;
  zoneCache: Map<string, string | null>;
}

async function resolveContext(): Promise<SyncContext> {
  const systemUser = await prisma.user.findUnique({
    where: { username: LIBANEX_SYSTEM_USERNAME },
  });
  if (!systemUser) {
    throw new Error(
      `System user "${LIBANEX_SYSTEM_USERNAME}" not found — run scripts/create-libanex-user.js first.`,
    );
  }
  const driver = await prisma.driverProfile.findUnique({
    where: { driverId: LIBANEX_DRIVER_CODE },
  });
  if (!driver) {
    throw new Error(`Driver profile ${LIBANEX_DRIVER_CODE} not found.`);
  }
  return { systemUserId: systemUser.id, driverId: driver.id, zoneCache: new Map() };
}

async function resolveZoneId(
  rawZone: string | null,
  ctx: SyncContext,
): Promise<string> {
  const key = (rawZone ?? "").trim();
  if (ctx.zoneCache.has(key)) {
    const cached = ctx.zoneCache.get(key);
    if (cached) return cached;
  }
  let zone = key ? await prisma.zone.findUnique({ where: { name: key } }) : null;
  if (!zone) zone = await prisma.zone.findUnique({ where: { name: FALLBACK_ZONE_NAME } });
  if (!zone) throw new Error(`Zone "${key}" missing and fallback zone "${FALLBACK_ZONE_NAME}" does not exist.`);
  ctx.zoneCache.set(key, zone.id);
  return zone.id;
}

// ── Libanex fetchers ─────────────────────────────────────────────────────────

async function fetchAllOrders(sellerId: string): Promise<LibanexOrder[]> {
  const out: LibanexOrder[] = [];
  for (let offset = 0; offset < MAX_ORDERS_PER_IMPORT; offset += PAGE_LIMIT) {
    const body = await libanexGet("orders.php", {
      seller_id: sellerId,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    out.push(...(body.data as LibanexOrder[]));
    if (body.pagination.returned < PAGE_LIMIT) break;
  }
  return out;
}

async function fetchOrderById(orderId: string): Promise<LibanexOrder | null> {
  const body = await libanexGet("orders.php", { order_id: orderId, limit: "1" });
  return (body.data?.[0] as LibanexOrder) ?? null;
}

async function fetchHistorySince(
  sellerId: string,
  since: Date,
): Promise<LibanexHistoryRow[]> {
  const out: LibanexHistoryRow[] = [];
  for (let offset = 0; offset < MAX_HISTORY_ROWS_PER_RUN; offset += PAGE_LIMIT) {
    const body = await libanexGet("order_history.php", {
      seller_id: sellerId,
      since: toApiStamp(since),
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    out.push(...(body.data as LibanexHistoryRow[]));
    if (body.pagination.returned < PAGE_LIMIT) break;
  }
  return out;
}

// ── Import (admin action) ────────────────────────────────────────────────────

/**
 * Preview list of a seller's Libanex orders, annotated with what we already
 * have locally (linked / existing PWA order) so the admin can pick rows.
 */
export interface LibanexOrderPreview extends LibanexOrder {
  alreadyLinked: boolean;
  existsInPwa: boolean;
}

export async function previewSellerOrders(
  sellerId: string,
): Promise<LibanexOrderPreview[]> {
  const orders = await fetchAllOrders(sellerId);

  const links = await prisma.libanexLink.findMany({
    where: { libanexOrderId: { in: orders.map((o) => o.order_id) } },
    select: { libanexOrderId: true },
  });
  const linked = new Set(links.map((l) => l.libanexOrderId));

  const existing = await prisma.order.findMany({
    where: { orderId: { in: orders.map((o) => o.order_id) } },
    select: { orderId: true },
  });
  const inPwa = new Set(existing.map((o) => o.orderId));

  return orders.map((o) => ({
    ...o,
    alreadyLinked: linked.has(o.order_id),
    existsInPwa: inPwa.has(o.order_id),
  }));
}

/**
 * Import a seller's Libanex orders. Pass `orderIds` to import only the
 * selected orders; omit it to import every order the seller has.
 * Pass `merchantId` (one of OUR merchants, validated by the API route) to
 * assign newly created orders to that seller. Orders that already exist in
 * the PWA are adopted but their current merchant is never overwritten.
 */
export async function importSellerOrders(
  sellerId: string,
  orderIds?: string[],
  merchantId?: string,
): Promise<ImportSummary> {
  const ctx = await resolveContext();
  const summary: ImportSummary = {
    sellerId,
    fetched: 0,
    created: 0,
    adopted: 0,
    skipped: 0,
    warnings: [],
  };

  let orders = await fetchAllOrders(sellerId);
  if (orderIds && orderIds.length > 0) {
    const wanted = new Set(orderIds);
    orders = orders.filter((o) => wanted.has(o.order_id));
  }
  for (const lx of orders) {
    summary.fetched++;

    const existingLink = await prisma.libanexLink.findUnique({
      where: { libanexOrderId: lx.order_id },
    });
    if (existingLink) {
      summary.skipped++;
      continue;
    }

    const existingOrder = await prisma.order.findUnique({
      where: { orderId: lx.order_id },
    });
    if (existingOrder) {
      // Already in the PWA → adopt it so it still receives updates.
      await prisma.libanexLink.create({
        data: {
          libanexOrderId: lx.order_id,
          libanexSellerId: sellerId,
          orderId: existingOrder.id,
          rawLocation: lx.location,
          rawFinStatus: lx.fin_status,
        },
      });
      summary.adopted++;
      continue;
    }

    const status = mapStatus(
      lx.location,
      lx.fin_status,
      "WAREHOUSE",
      "UD",
      lx.order_id,
      summary.warnings,
    );
    const zoneId = await resolveZoneId(lx.zone, ctx);

    const order = await prisma.order.create({
      data: {
        orderId: lx.order_id,
        // Preserve the real received date (fixes orders all showing the
        // import date, see the 2026-10-23 seller-5272 incident).
        createdAt: receivedDate(lx),
        customerName: (lx.customer ?? "").trim() || "(no name)",
        customerPhone: (lx.tel_number ?? "").trim() || "N/A",
        customerAddress:
          (lx.address ?? "").trim() || (lx.city ?? "").trim() || "N/A",
        notes: (lx.notes ?? "").trim() || null,
        packages: parseInt(lx.packages ?? "", 10) || 1,
        extraShipping: num(lx.ex_shipping),
        amountUsd: num(lx.amount),
        amountLbp: num(lx.amt_ll),
        collectedUsd: num(lx.amt_collected),
        collectedLbp: num(lx.amt_ll_collected),
        location: status.location,
        financialStatus: status.financialStatus,
        zoneId,
        creatorId: ctx.systemUserId,
        driverId: ctx.driverId, // D999 — "Libanex"
        // Assign to one of our merchants when the admin selected one.
        ...(merchantId ? { merchantId } : {}),
      },
    });

    await prisma.libanexLink.create({
      data: {
        libanexOrderId: lx.order_id,
        libanexSellerId: sellerId,
        orderId: order.id,
        rawLocation: lx.location,
        rawFinStatus: lx.fin_status,
      },
    });

    await prisma.orderHistory.create({
      data: {
        orderId: order.id,
        action: "Imported from Libanex",
        location: status.location,
        driverId: ctx.driverId,
        userId: ctx.systemUserId,
        meta: { source: "LIBANEX_IMPORT", libanexOrderId: lx.order_id },
      },
    });

    summary.created++;
  }

  return summary;
}

// ── Export (PWA → Libanex, admin action) ─────────────────────────────────────

export interface ExportSummary {
  sellerId: string;
  requested: number;
  exported: number;
  skipped: number;
  warnings: string[];
}

export interface PwaOrderPreview {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  amountUsd: number;
  amountLbp: number;
  location: string;
  financialStatus: string;
  zoneName: string;
  createdAt: string;
}

/**
 * PWA orders that have never been exported to Libanex (no LibanexLink),
 * newest first, for the export picker.
 */
export async function listExportableOrders(
  search: string,
  limit = 100,
): Promise<PwaOrderPreview[]> {
  const q = search.trim();
  const orders = await prisma.order.findMany({
    where: {
      libanexLink: null,
      ...(q
        ? {
            OR: [
              { orderId: { contains: q, mode: "insensitive" } },
              { customerName: { contains: q, mode: "insensitive" } },
              { customerPhone: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { zone: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return orders.map((o) => ({
    id: o.id,
    orderId: o.orderId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    amountUsd: o.amountUsd,
    amountLbp: o.amountLbp,
    location: o.location,
    financialStatus: o.financialStatus,
    zoneName: o.zone?.name ?? "",
    createdAt: o.createdAt.toISOString(),
  }));
}

/** "{sellerId}-{numeric tail of the PWA order id}" e.g. 1176-0086. */
function libanexIdFor(pwaOrderId: string, sellerId: string): string {
  const groups = pwaOrderId.match(/\d+/g);
  const tail =
    groups && groups.length > 0
      ? groups[groups.length - 1]
      : pwaOrderId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 20);
  return `${sellerId}-${tail}`;
}

/** Increment the numeric tail of a candidate id (collision bumping). */
function bumpLibanexId(base: string, attempt: number): string {
  const m = base.match(/^(.*?)(\d+)$/);
  if (!m) return `${base}-${attempt}`;
  const bumped = BigInt(m[2]) + BigInt(attempt);
  return m[1] + String(bumped).padStart(m[2].length, "0");
}

/**
 * Export selected PWA orders into Libanex under `sellerId` with the chosen
 * initial status. Afterwards Libanex is the source of truth: a LibanexLink is
 * created (cursor = now, so the auto "Created" row is not replayed back) and
 * the existing 30-minute sync keeps both sides in lockstep. The PWA order is
 * assigned driver D999 ("Libanex") and its status is set to the mapped
 * equivalent of the chosen initial status.
 */
export async function exportOrdersToLibanex(
  orderIds: string[], // internal PWA Order.id values
  sellerId: string,
  location: string,
  finStatus: string,
): Promise<ExportSummary> {
  const ctx = await resolveContext();
  const summary: ExportSummary = {
    sellerId,
    requested: orderIds.length,
    exported: 0,
    skipped: 0,
    warnings: [],
  };

  for (const id of orderIds) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        zone: { select: { name: true } },
        libanexLink: { select: { id: true } },
      },
    });
    if (!order) {
      summary.skipped++;
      summary.warnings.push(`Order ${id}: not found locally — skipped`);
      continue;
    }
    if (order.libanexLink) {
      summary.skipped++;
      summary.warnings.push(`Order ${order.orderId}: already linked to Libanex — skipped`);
      continue;
    }

    // Zone names on the PWA are Libanex zone codes (resolveZoneId matches by
    // name), so the reverse mapping is just the zone name itself.
    const zoneName = order.zone?.name ?? "";

    const baseId = libanexIdFor(order.orderId, sellerId);
    let created = false;
    let lxId = "";
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const candidate = attempt === 0 ? baseId : bumpLibanexId(baseId, attempt);
      try {
        await libanexPost("create_order.php", {
          order_id: candidate,
          seller_id: sellerId,
          location,
          fin_status: finStatus,
          customer: order.customerName,
          address: order.customerAddress,
          city: "",
          tel_number: order.customerPhone,
          zone: zoneName,
          notes: order.notes ?? "",
          packages: String(order.packages ?? 1),
          amount: order.amountUsd,
          amt_ll: order.amountLbp,
          amt_collected: order.collectedUsd,
          amt_ll_collected: order.collectedLbp,
          ex_shipping: order.extraShipping,
        });
        created = true;
        lxId = candidate;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("already exists")) continue; // id collision → bump
        summary.warnings.push(`Order ${order.orderId}: ${msg}`);
        break;
      }
    }
    if (!created) {
      if (!summary.warnings.some((w) => w.startsWith(`Order ${order.orderId}:`))) {
        summary.warnings.push(
          `Order ${order.orderId}: could not find a free Libanex order id near "${baseId}"`,
        );
      }
      summary.skipped++;
      continue;
    }

    // Reflect the chosen initial status on the PWA side too (Libanex is now
    // the source of truth and the sync would set this on the next run anyway).
    const status = mapStatus(
      location,
      finStatus,
      order.location,
      order.financialStatus,
      lxId,
      summary.warnings,
    );

    await prisma.order.update({
      where: { id },
      data: {
        driverId: ctx.driverId, // D999 — handed over to Libanex
        location: status.location,
        financialStatus: status.financialStatus,
      },
    });

    await prisma.libanexLink.create({
      data: {
        libanexOrderId: lxId,
        libanexSellerId: sellerId,
        orderId: id,
        lastHistoryStamp: new Date(), // don't replay the "Created" row back
        rawLocation: location,
        rawFinStatus: finStatus,
      },
    });

    await prisma.orderHistory.create({
      data: {
        orderId: id,
        action: "Exported to Libanex",
        location: status.location,
        driverId: ctx.driverId,
        userId: ctx.systemUserId,
        meta: {
          source: "LIBANEX_EXPORT",
          libanexOrderId: lxId,
          initialLocation: location,
          initialFinStatus: finStatus,
        },
      },
    });

    summary.exported++;
  }

  return summary;
}

// ── Incremental sync (cron) ──────────────────────────────────────────────────

export async function runSyncForLinkedSellers(): Promise<SyncResult[]> {
  const ctx = await resolveContext();
  const groups = await prisma.libanexLink.groupBy({
    by: ["libanexSellerId"],
    _count: { _all: true },
  });
  const results: SyncResult[] = [];
  for (const g of groups) {
    results.push(await syncSeller(g.libanexSellerId, ctx));
  }
  return results;
}

async function syncSeller(sellerId: string, ctx: SyncContext): Promise<SyncResult> {
  const result: SyncResult = {
    sellerId,
    historyRows: 0,
    ordersUpdated: 0,
    ordersDriverProtected: 0,
    warnings: [],
  };

  const links = await prisma.libanexLink.findMany({
    where: { libanexSellerId: sellerId },
    select: {
      id: true,
      libanexOrderId: true,
      orderId: true,
      lastHistoryStamp: true,
      order: {
        select: {
          id: true,
          location: true,
          financialStatus: true,
          driverId: true,
          deliveredAt: true,
        },
      },
    },
  });
  if (links.length === 0) return result;

  const linkByLibId = new Map(links.map((l) => [l.libanexOrderId, l]));
  const oldestCursor = Math.min(
    ...links.map((l) => (l.lastHistoryStamp ? l.lastHistoryStamp.getTime() : 0)),
  );
  const since = oldestCursor === 0 ? new Date(Date.UTC(2000, 0, 1)) : new Date(oldestCursor);

  // 1) Replay new history events for linked orders.
  const rows = await fetchHistorySince(sellerId, since);
  const maxStampByLink = new Map<string, Date>();
  const touchedOrderIds = new Set<string>();
  const historyBuffer: {
    orderId: string;
    action: string;
    location: string | null;
    driverId: string | null;
    userId: string;
    createdAt: Date;
    meta: Record<string, unknown>;
  }[] = [];

  for (const row of rows) {
    const link = linkByLibId.get(row.order_id);
    if (!link) continue;
    const stamp = parseStamp(row.stamp);
    if (link.lastHistoryStamp && stamp <= link.lastHistoryStamp) continue;

    const mappedLoc = LOCATION_MAP[(row.location ?? "").trim()] ?? null;
    historyBuffer.push({
      orderId: link.orderId,
      action:
        (row.note ?? "").trim() ||
        `Libanex update${row.location ? ` (${row.location})` : ""}`,
      location: mappedLoc,
      driverId: (row.driver ?? "").trim() === LIBANEX_DRIVER_CODE ? ctx.driverId : null,
      userId: ctx.systemUserId,
      createdAt: stamp,
      meta: {
        source: "LIBANEX",
        libanexOrderId: row.order_id,
        enteredBy: row.entered_by,
        rawLocation: row.location,
        rawDriver: row.driver,
      },
    });

    const cur = maxStampByLink.get(link.id);
    if (!cur || stamp > cur) maxStampByLink.set(link.id, stamp);
    touchedOrderIds.add(row.order_id);
    result.historyRows++;
  }

  for (let i = 0; i < historyBuffer.length; i += 500) {
    // meta values are plain JSON-safe objects; cast satisfies Prisma's InputJsonValue.
    await prisma.orderHistory.createMany({
      data: historyBuffer.slice(i, i + 500) as unknown as {
        orderId: string;
        action: string;
        location: string | null;
        driverId: string | null;
        userId: string;
        createdAt: Date;
        meta: object;
      }[],
    });
  }

  // 2) Pull fresh status for every touched order (capped per run).
  let fetches = 0;
  for (const libId of touchedOrderIds) {
    if (fetches >= MAX_STATUS_FETCHES_PER_SELLER) {
      result.warnings.push(
        `Seller ${sellerId}: status refresh capped at ${MAX_STATUS_FETCHES_PER_SELLER} orders this run`,
      );
      break;
    }
    fetches++;
    const link = linkByLibId.get(libId)!;
    try {
      const lx = await fetchOrderById(libId);
      if (!lx) {
        result.warnings.push(`Order ${libId}: not found on Libanex anymore — skipped`);
        continue;
      }
      await applyStatusUpdate(link, lx, ctx, result);
      result.ordersUpdated++;
    } catch (err) {
      result.warnings.push(`Order ${libId}: ${(err as Error).message}`);
    }
  }

  // 3) Advance cursors.
  const now = new Date();
  for (const link of links) {
    const newStamp = maxStampByLink.get(link.id);
    await prisma.libanexLink.update({
      where: { id: link.id },
      data: {
        lastHistoryStamp: newStamp ?? link.lastHistoryStamp ?? now,
        lastSyncedAt: now,
      },
    });
  }

  return result;
}

async function applyStatusUpdate(
  link: {
    id: string;
    orderId: string;
    order: {
      id: string;
      location: string;
      financialStatus: string;
      driverId: string | null;
      deliveredAt: Date | null;
    };
  },
  lx: LibanexOrder,
  ctx: SyncContext,
  result: SyncResult,
): Promise<void> {
  const status = mapStatus(
    lx.location,
    lx.fin_status,
    link.order.location,
    link.order.financialStatus,
    lx.order_id,
    result.warnings,
  );
  const zoneId = await resolveZoneId(lx.zone, ctx);

  // Respect manual driver reassignment: once the order points at a driver other
  // than D999, the sync never touches the driver field again.
  const driverProtected =
    link.order.driverId !== null && link.order.driverId !== ctx.driverId;
  if (driverProtected) result.ordersDriverProtected++;

  const data: Record<string, unknown> = {
    location: status.location,
    financialStatus: status.financialStatus,
    amountUsd: num(lx.amount),
    amountLbp: num(lx.amt_ll),
    collectedUsd: num(lx.amt_collected),
    collectedLbp: num(lx.amt_ll_collected),
    extraShipping: num(lx.ex_shipping),
    zoneId,
  };
  if (!driverProtected && link.order.driverId === null) {
    data.driverId = ctx.driverId;
  }
  if (status.location === "DELIVERED" && !link.order.deliveredAt) {
    data.deliveredAt = lx.date_closed ? parseStamp(lx.date_closed) : new Date();
  }

  await prisma.order.update({ where: { id: link.orderId }, data });
  await prisma.libanexLink.update({
    where: { id: link.id },
    data: { rawLocation: lx.location, rawFinStatus: lx.fin_status },
  });
}
