// ─── End-to-end verification for the Universal Staff Scanner API ─────────────
// Exercises the 5 Phase-1 scenarios against a RUNNING dev server:
//   1. RECEIVE_PICKUP + PickupBatch reconciliation (COMPLETED / DISCREPANCY)
//   2. ASSIGN_DRIVER (Dr → WITH_DRIVER, Tr → ASSIGNED_TR)
//   3. RETURN_TO_SELLER mixed-merchant block (400)
//   4. RETURN_TO_SELLER batch generation (Returns-M<id>-<YYYYMMDD-HHmm>)
//   5. MARK_DELIVERED guardrail (unassigned → 400) + happy path (DELIVERED/WD)
//
// Run: set -a && . ./.env && set +a && npx ts-node --compiler-options '{"module":"commonjs"}' scripts/verify-universal-scan.ts
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = process.env.VERIFY_BASE_URL || "http://localhost:3005";
const prisma = new PrismaClient();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

type JsonMap = Record<string, unknown>;
function metaOf(h: { meta: unknown } | null): JsonMap {
  return (h?.meta ?? {}) as JsonMap;
}
function errOf(json: JsonMap | null): string {
  const e = json?.error;
  return typeof e === "string" ? e : "";
}

async function scan(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: JsonMap | null }> {
  const res = await fetch(`${BASE}/api/admin/orders/universal-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `session=${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  // ── Mint a session token for the admin user (same secret as the server) ──
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No ADMIN user found");
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ id: admin.id, role: admin.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(secret);

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const zone = await prisma.zone.findFirst();
  const merchantA = await prisma.merchant.findFirst();
  const merchantB = await prisma.merchant.findFirst({
    where: { id: { not: merchantA!.id } },
  });
  const driver = await prisma.driverProfile.findFirst();
  if (!zone || !merchantB || !driver) throw new Error("Missing seed data");

  const stamp = Date.now();
  const mkOrder = (merchantId: string, extra: Record<string, unknown> = {}) =>
    prisma.order.create({
      data: {
        orderId: `VS-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
        customerName: "Verify Scanner",
        customerPhone: "00000000",
        customerAddress: "Verify Address",
        zoneId: zone.id,
        merchantId,
        creatorId: admin.id,
        location: "CP",
        financialStatus: "UD",
        ...extra,
      },
    });

  // Batch A: 2 orders, both will be scanned → expect COMPLETED
  const batchA = await prisma.pickupBatch.create({
    data: { batchNumber: `PKB-VS-A-${stamp}`, merchantId: merchantA!.id, totalOrders: 2 },
  });
  // Batch B: 2 orders, only 1 will be scanned → expect DISCREPANCY
  const batchB = await prisma.pickupBatch.create({
    data: { batchNumber: `PKB-VS-B-${stamp}`, merchantId: merchantA!.id, totalOrders: 2 },
  });

  const a1 = await mkOrder(merchantA!.id, { pickupBatchId: batchA.id });
  const a2 = await mkOrder(merchantA!.id, { pickupBatchId: batchA.id });
  const b1 = await mkOrder(merchantA!.id, { pickupBatchId: batchB.id });
  await mkOrder(merchantA!.id, { pickupBatchId: batchB.id }); // never scanned

  const createdOrderIds: string[] = [a1.id, a2.id, b1.id];
  const createdBatchIds: string[] = [batchA.id, batchB.id];

  try {
    // ═══ Scenario 1: RECEIVE_PICKUP + reconciliation ═══
    const r1 = await scan(token, {
      action: "RECEIVE_PICKUP",
      orderIds: [a1.id, a2.id, b1.id],
    });
    check("S1 receive: 200 success", r1.status === 200 && r1.json?.success === true, JSON.stringify(r1.json));
    check("S1 receive: count=3, reconciledBatches=2", r1.json?.count === 3 && r1.json?.reconciledBatches === 2);

    const o1 = await prisma.order.findUnique({ where: { id: a1.id } });
    check("S1 order → WAREHOUSE/UD", o1?.location === "WAREHOUSE" && o1?.financialStatus === "UD");

    const bA = await prisma.pickupBatch.findUnique({ where: { id: batchA.id } });
    check("S1 batch A → COMPLETED (receivedCount=2)", bA?.status === "COMPLETED" && bA?.receivedCount === 2, `status=${bA?.status} received=${bA?.receivedCount}`);
    const bB = await prisma.pickupBatch.findUnique({ where: { id: batchB.id } });
    check("S1 batch B → DISCREPANCY (missing 1)", bB?.status === "DISCREPANCY" && bB?.receivedCount === 1 && /Missing 1 package/.test(bB?.discrepancyNote ?? ""), `status=${bB?.status} note=${bB?.discrepancyNote}`);

    const h1 = await prisma.orderHistory.findFirst({
      where: { orderId: a1.id, action: "SC_RECEIVED_AT_WAREHOUSE" },
    });
    const m1 = metaOf(h1);
    check("S1 history SC_RECEIVED_AT_WAREHOUSE w/ staffName", m1.isScannerAction === true && m1.staffName === admin.username && h1?.userId === admin.id);

    // ═══ Scenario 2: ASSIGN_DRIVER Dr and Tr ═══
    const r2a = await scan(token, {
      action: "ASSIGN_DRIVER",
      orderIds: [a1.id],
      driverId: driver.id,
      assignmentType: "DR",
    });
    check("S2 Dr assign: 200 → WITH_DRIVER", r2a.status === 200 && r2a.json?.location === "WITH_DRIVER", JSON.stringify(r2a.json));
    const r2b = await scan(token, {
      action: "ASSIGN_DRIVER",
      orderIds: [a2.id],
      driverId: driver.id,
      assignmentType: "TR",
    });
    check("S2 Tr assign: 200 → ASSIGNED_TR", r2b.status === 200 && r2b.json?.location === "ASSIGNED_TR");

    const oA1 = await prisma.order.findUnique({ where: { id: a1.id } });
    const oA2 = await prisma.order.findUnique({ where: { id: a2.id } });
    check("S2 orders carry driverId + locations", oA1?.driverId === driver.id && oA1?.location === "WITH_DRIVER" && oA2?.location === "ASSIGNED_TR");

    const hDr = await prisma.orderHistory.findFirst({ where: { orderId: a1.id, action: "SC_ASSIGNED_DRIVER_DR" } });
    const hTr = await prisma.orderHistory.findFirst({ where: { orderId: a2.id, action: "SC_ASSIGNED_DRIVER_TR" } });
    const mDr = metaOf(hDr);
    const mTr = metaOf(hTr);
    check("S2 history SC_ASSIGNED_DRIVER_DR/TR with driver meta", mDr.assignmentType === "DR" && mTr.assignmentType === "TR" && typeof mDr.driverName === "string");

    // ═══ Scenario 3: RETURN_TO_SELLER mixed-merchant block ═══
    const mixed = await mkOrder(merchantB.id);
    createdOrderIds.push(mixed.id);
    const r3 = await scan(token, {
      action: "RETURN_TO_SELLER",
      orderIds: [b1.id, mixed.id],
    });
    check("S3 mixed merchants → 400", r3.status === 400 && /Mixed merchants/.test(errOf(r3.json)), JSON.stringify(r3.json));
    const oB1 = await prisma.order.findUnique({
      where: { id: b1.id },
      select: { location: true, returnBatchId: true },
    });
    check("S3 no mutation on mixed batch", oB1?.location === "WAREHOUSE" && oB1?.returnBatchId === null);

    // ═══ Scenario 4: RETURN_TO_SELLER batch generation ═══
    const r4 = await scan(token, {
      action: "RETURN_TO_SELLER",
      orderIds: [b1.id],
    });
    const expectedPrefix = `Returns-M${merchantA!.merchantId}-`;
    check("S4 RTS: 200 + batchNumber format", r4.status === 200 && typeof r4.json?.batchNumber === "string" && r4.json.batchNumber.startsWith(expectedPrefix) && /^\d{8}-\d{4}$/.test(r4.json.batchNumber.slice(expectedPrefix.length)), `status=${r4.status} body=${JSON.stringify(r4.json)}`);

    const oB1After = await prisma.order.findUnique({
      where: { id: b1.id },
      select: { location: true, returnBatchId: true },
    });
    check("S4 order → RTS + returnBatchId linked", oB1After?.location === "RTS" && Boolean(oB1After?.returnBatchId));

    const rb = oB1After?.returnBatchId
      ? await prisma.returnBatch.findUnique({ where: { id: oB1After.returnBatchId } })
      : null;
    check("S4 ReturnBatch row: PENDING, totalOrders=1, correct merchant", rb?.status === "PENDING" && rb?.totalOrders === 1 && rb?.merchantId === merchantA!.id);

    const hRts = await prisma.orderHistory.findFirst({ where: { orderId: b1.id, action: "SC_RETURNED_TO_SELLER_RTS" } });
    const mRts = metaOf(hRts);
    check("S4 history SC_RETURNED_TO_SELLER_RTS w/ batchNumber meta", mRts.batchNumber === rb?.batchNumber && mRts.merchantName === merchantA!.merchantName);

    // Same-minute second batch → collision retry suffix
    const dup = await mkOrder(merchantA!.id);
    createdOrderIds.push(dup.id);
    const r4b = await scan(token, { action: "RETURN_TO_SELLER", orderIds: [dup.id] });
    check("S4 second same-minute RTS gets suffixed batchNumber", r4b.status === 200 && r4b.json?.batchNumber !== r4.json?.batchNumber, `${r4.json?.batchNumber} vs ${r4b.json?.batchNumber}`);

    // ═══ Scenario 5: MARK_DELIVERED guardrail ═══
    const unassigned = await mkOrder(merchantA!.id);
    createdOrderIds.push(unassigned.id);
    const r5a = await scan(token, {
      action: "MARK_DELIVERED",
      orderIds: [a1.id, unassigned.id],
    });
    check("S5 unassigned → 400 with sample order numbers", r5a.status === 400 && /not assigned to any driver/.test(errOf(r5a.json)) && errOf(r5a.json).includes(`#${unassigned.orderId}`), JSON.stringify(r5a.json));

    const r5b = await scan(token, { action: "MARK_DELIVERED", orderIds: [a1.id] });
    check("S5 assigned → 200", r5b.status === 200 && r5b.json?.success === true);
    const oA1Del = await prisma.order.findUnique({ where: { id: a1.id } });
    check("S5 order → DELIVERED/WD + deliveredAt", oA1Del?.location === "DELIVERED" && oA1Del?.financialStatus === "WD" && oA1Del?.deliveredAt !== null);
    const hDel = await prisma.orderHistory.findFirst({ where: { orderId: a1.id, action: "SC_DELIVERED" } });
    check("S5 history SC_DELIVERED", hDel !== null && metaOf(hDel).isScannerAction === true);

    // ═══ Auth guardrail ═══
    const noAuth = await fetch(`${BASE}/api/admin/orders/universal-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RECEIVE_PICKUP", orderIds: ["x"] }),
    });
    check("Unauthenticated → 401", noAuth.status === 401);
  } finally {
    // ── Cleanup fixtures ────────────────────────────────────────────────────
    await prisma.orderHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.updateMany({ where: { id: { in: createdOrderIds } }, data: { returnBatchId: null, pickupBatchId: null, driverId: null } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.returnBatch.deleteMany({ where: { merchantId: merchantA!.id, batchNumber: { startsWith: expectedPrefixSafe() } } });
    await prisma.pickupBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
    console.log("\nFixtures cleaned up.");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

function expectedPrefixSafe(): string {
  // Match any Returns batch created during this run (merchant-scoped + today).
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `Returns-M%-${day}%`;
}

main().catch((err) => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
