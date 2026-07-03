import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify } from "jose";
import prisma from "@/lib/prisma";
import MerchantClient from "./MerchantClient";

// ─── Server Component: Merchant Portal ────────────────────────────────────────
// 1. Authenticates via JWT session cookie
// 2. Scoped query: only the merchant's own orders (excluding archived & PS)
// 3. Fetches zones for the order form dropdown
// 4. Fetches historical payout statements
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

  // ── Zones for the Destination Zone dropdown ─────────────────────────────
  const zones = await prisma.zone.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // ── Serialize: convert Date objects to ISO strings for client component ─
  const serializedMerchant = {
    id: merchant.id,
    merchantId: merchant.merchantId,
    merchantName: merchant.merchantName,
    contactName: merchant.contactName,
    phone: merchant.phone,
    address: merchant.address,
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

  const serializedPayouts = merchant.payouts.map((p) => ({
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

  return (
    <MerchantClient
      merchant={serializedMerchant}
      zones={zones}
      payouts={serializedPayouts}
    />
  );
}
