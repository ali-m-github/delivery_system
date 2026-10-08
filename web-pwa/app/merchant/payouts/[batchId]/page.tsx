export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/server-permissions";
import BatchDetailClient from "@/app/merchants/[id]/payouts/[batchId]/BatchDetailClient";

// ─── Server Component: Merchant-facing Payout Batch Detail ───────────────────
// Mirrors the admin batch view at /merchants/[id]/payouts/[batchId], but the
// batch is scoped to the authenticated merchant and the company-only `profit`
// figure is stripped before it reaches the client.
export default async function MerchantPayoutBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const batchIdInt = parseInt(batchId, 10);

  if (isNaN(batchIdInt)) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Invalid Batch ID</p>
      </div>
    );
  }

  // ── Authenticate: only the signed-in merchant may open this page ─────────
  const user = await getSessionUser();
  if (!user || user.role !== "MERCHANT") {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Unauthorized</p>
      </div>
    );
  }

  const merchant = await prisma.merchant.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!merchant) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">No merchant profile linked to your account</p>
      </div>
    );
  }

  // Scoped by merchantId so a seller can never open another seller's batch.
  const batch = await prisma.cashPayoutBatch.findFirst({
    where: { id: batchIdInt, merchantId: merchant.id },
    include: {
      merchant: {
        select: { id: true, merchantName: true, merchantId: true },
      },
      orders: {
        include: {
          driver: true,
          zone: true,
          merchant: { select: { merchantName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      resolvedReturns: {
        include: {
          driver: true,
          zone: true,
          merchant: { select: { merchantName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      adjustments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Batch Not Found</p>
      </div>
    );
  }

  // Strip the company-only `profit` figure before serializing to the client —
  // consistent with the merchant portal, which never receives it.
  const safeBatch = JSON.parse(JSON.stringify(batch));
  delete safeBatch.profit;

  return <BatchDetailClient batch={safeBatch} merchantView />;
}
