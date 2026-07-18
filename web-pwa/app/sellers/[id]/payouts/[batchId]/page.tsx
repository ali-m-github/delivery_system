export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import BatchDetailClient from "./BatchDetailClient";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const resolvedParams = await params;
  const merchantId = resolvedParams.id;
  const batchId = parseInt(resolvedParams.batchId, 10);

  if (isNaN(batchId)) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Invalid Batch ID</p>
      </div>
    );
  }

  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { id: batchId },
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

  const safeBatch = JSON.parse(JSON.stringify(batch));

  return <BatchDetailClient batch={safeBatch} />;
}
