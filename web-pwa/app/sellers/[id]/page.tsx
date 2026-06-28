import prisma from "@/lib/prisma";
import SellerClient from "./SellerClient";

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;

  const merchant = await prisma.merchant.findUnique({
    where: { id: resolvedParams.id },
    include: {
      zoneRates: true, // Fetch the seller's specific shipping rates
      orders: {
        include: {
          driver: true,
          zone: true, // Fetch the zone for each order to match against the rates
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!merchant) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Seller Not Found</p>
      </div>
    );
  }

  const safeMerchant = JSON.parse(JSON.stringify(merchant));

  return <SellerClient merchant={safeMerchant} />;
}
