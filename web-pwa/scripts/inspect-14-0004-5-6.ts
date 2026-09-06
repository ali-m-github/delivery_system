import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { orderId: "14-0004" },
        { orderId: "14-0005" },
        { orderId: "14-0006" },
        // fallback: prefix match in case of whitespace
        { orderId: { startsWith: "14-000" } },
      ],
    },
    include: {
      merchant: { select: { id: true, merchantName: true, sellerNumber: true } },
      creator: { select: { id: true, email: true } },
    },
    orderBy: { orderId: "asc" },
  });

  for (const o of orders) {
    console.log("=".repeat(80));
    console.log(`orderId: ${JSON.stringify(o.orderId)}  len(orderId) = ${o.orderId.length}`);
    console.log(`customerName: ${JSON.stringify(o.customerName)}`);
    console.log(`customerPhone: ${JSON.stringify(o.customerPhone)}`);
    console.log(`customerAddress len: ${o.customerAddress.length}`);
    console.log(`customerAddress: ${JSON.stringify(o.customerAddress)}`);
    console.log(`--- address readable ---`);
    console.log(o.customerAddress);
    console.log(`notes: ${JSON.stringify(o.notes)}`);
    console.log(`merchant: ${JSON.stringify(o.merchant)}`);
    console.log(`creator: ${JSON.stringify(o.creator)}`);
    console.log(`createdAt: ${o.createdAt.toISOString()}  updatedAt: ${o.updatedAt.toISOString()}`);
  }

  if (orders.length === 0) {
    console.log("No orders found for 14-0004/5/6. Searching prefix '14-' ...");
    const like = await prisma.order.findMany({
      where: { orderId: { startsWith: "14-" } },
      select: { orderId: true, customerAddress: true },
      take: 20,
    });
    for (const o of like) {
      console.log(o.orderId, "addrLen:", o.customerAddress.length);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
