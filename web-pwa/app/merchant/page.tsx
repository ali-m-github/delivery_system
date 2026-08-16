import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify } from "jose";
import prisma from "@/lib/prisma";
import MerchantClient from "./MerchantClient";

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Normalize the Prisma JsonValue stored in Merchant.sheetImportConfig into a
// plain, serializable object so the client never needs a loose `any` type.
function normalizeSheetImportConfig(
  raw: unknown,
): { startRow?: number; colMapping?: Record<string, number> } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { startRow?: unknown; colMapping?: unknown };
  const result: { startRow?: number; colMapping?: Record<string, number> } = {};
  if (typeof obj.startRow === "number") result.startRow = obj.startRow;
  if (obj.colMapping && typeof obj.colMapping === "object") {
    const mapping: Record<string, number> = {};
    for (const [key, value] of Object.entries(obj.colMapping)) {
      if (typeof value === "number") mapping[key] = value;
    }
    if (Object.keys(mapping).length > 0) result.colMapping = mapping;
  }
  return Object.keys(result).length > 0 ? result : null;
}

// ─── Server Component: Merchant Portal ────────────────────────────────────────
// 1. Authenticates via JWT session cookie
// 2. Scoped query: only the merchant's own orders
// 3. Fetches payout statements (non-cash sellers) / cash payout batches
export default async function MerchantPage() {
  // ── Authenticate ────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  if (!token) {
    redirect("/login");
  }

  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  let payload: { id: string; role: string };
  try {
    const verified = await jwtVerify(token, secret);
    payload = verified.payload as { id: string; role: string };
  } catch {
    redirect("/login");
  }

  if (payload.role !== "MERCHANT") {
    redirect("/login");
  }

  // ── Scoped relational query ────────────────────────────────────────────
  // merchant.findUnique by userId ensures this seller only sees their own data.
  // Full dataset fetched; all filtering now happens client-side.
  const merchant = await prisma.merchant.findUnique({
    where: { userId: payload.id },
    include: {
      orders: {
        include: {
          zone: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      // Statements (MerchantPayout) are for the delivery company that pays
      // the seller after delivery — only relevant for NON-cash sellers.
      payouts: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          sequentialIndex: true,
          totalUsd: true,
          totalLbp: true,
          shippingUsd: true,
          shippingLbp: true,
          netUsd: true,
          netLbp: true,
          status: true,
          createdAt: true,
        },
      },
      // Cash-seller advance payout batches. The company-only `profit` field is
      // stripped during serialization and never sent to the merchant.
      cashPayoutBatches: {
        orderBy: { createdAt: "desc" },
        include: {
          orders: {
            select: {
              id: true,
              orderId: true,
              customerName: true,
              customerPhone: true,
              customerAddress: true,
              amountUsd: true,
              amountLbp: true,
              collectedUsd: true,
              collectedLbp: true,
              location: true,
              financialStatus: true,
              createdAt: true,
              zone: { select: { id: true, name: true } },
              driver: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          resolvedReturns: {
            select: {
              id: true,
              orderId: true,
              customerName: true,
              customerPhone: true,
              customerAddress: true,
              amountUsd: true,
              amountLbp: true,
              collectedUsd: true,
              collectedLbp: true,
              location: true,
              financialStatus: true,
              createdAt: true,
              zone: { select: { id: true, name: true } },
              driver: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
      zoneRates: {
        include: {
          zone: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!merchant) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0B0F17] text-white">
        <div className="text-center p-8 border border-white/10 rounded-2xl bg-[#121824] shadow-2xl">
          <h1 className="text-2xl font-bold text-cyan-400 mb-2">
            Account Pending Approval
          </h1>
          <p className="text-gray-400 text-sm max-w-sm">
            Your seller account has been registered but is not yet linked to a
            merchant ledger. Please contact the administrator to activate your
            dashboard.
          </p>
        </div>
      </div>
    );
  }

  // ── Serialize: convert Date objects to ISO strings for client component ─
  const serializedMerchant = {
    id: merchant.id,
    merchantId: merchant.merchantId,
    merchantName: merchant.merchantName,
    contactName: merchant.contactName,
    phone: merchant.phone,
    address: merchant.address,
    logoUrl: merchant.logoUrl,
    isCashSeller: merchant.isCashSeller,
    sheetImportConfig: normalizeSheetImportConfig(merchant.sheetImportConfig),
    zoneRates: merchant.zoneRates.map((zr) => ({
      id: zr.id,
      zoneId: zr.zoneId,
      rate: zr.rate,
      zone: zr.zone,
    })),
    orders: merchant.orders.map((o) => ({
      ...o,
      zone: o.zone,
      createdAt: o.createdAt.toISOString(),
      collectedUsd: o.collectedUsd,
      collectedLbp: o.collectedLbp,
    })),
  };

  // Statements are only meaningful for NON-cash sellers. Cash sellers have
  // already been paid in advance (via cash payout batches), so they must not
  // see these statements.
  const serializedPayouts = merchant.isCashSeller
    ? []
    : merchant.payouts.map((p) => ({
        id: p.id,
        sequentialIndex: p.sequentialIndex,
        totalUsd: p.totalUsd,
        totalLbp: p.totalLbp,
        shippingUsd: p.shippingUsd,
        shippingLbp: p.shippingLbp,
        netUsd: p.netUsd,
        netLbp: p.netLbp,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      }));

  // Cash-seller payout batches — `profit` (company-side only) is excluded.
  const serializedCashBatches = merchant.cashPayoutBatches.map((b) => ({
    id: b.id,
    batchReference: b.batchReference,
    grossAdvance: b.grossAdvance,
    deductedReturns: b.deductedReturns,
    netPaid: b.netPaid,
    createdAt: b.createdAt.toISOString(),
    orders: b.orders.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
    })),
    resolvedReturns: b.resolvedReturns.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  }));

  return (
    <MerchantClient
      merchant={serializedMerchant}
      payouts={serializedPayouts}
      cashBatches={serializedCashBatches}
    />
  );
}
