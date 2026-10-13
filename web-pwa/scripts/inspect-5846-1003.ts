/**
 * Inspect order 5846-1003 and the RTS manifest order IDs.
 *
 * Run: npx tsx scripts/inspect-5846-1003.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: { orderId: { contains: "5846-1003" } },
    select: {
      id: true,
      orderId: true,
      location: true,
      financialStatus: true,
      merchantId: true,
      amountUsd: true,
    },
  });
  console.log("MATCHES FOR 5846-1003:", JSON.stringify(orders, null, 2));

  const ids = [
    "cmuvjm9dk004aiyqthtg0mump",
    "cmuvjm9i8004iiyqt6lsibulo",
    "cmuvjm9vq0056iyqtib5fifn8",
    "cmupc541600vegw8q33180191",
    "cmunt5bu600mmrbhdotfvrcgc",
    "cmunt5bwa00mqrbhdpovrmxzx",
    "cmuml7spn00ewrbhduiph2nez",
    "cmul2hiwn00a9rbhdvuzfvpkz",
    "cmugw74iy006orbhdxu22wio6",
    "cmugw74gy006krbhdqkawh1rq",
    "cmugw74l0006srbhdmmtbhe46",
  ];
  const manifest = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderId: true, location: true, financialStatus: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("MANIFEST:", JSON.stringify(manifest, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Inspect failed:", err);
  process.exit(1);
});
