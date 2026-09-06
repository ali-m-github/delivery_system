import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ids = ["14-0003", "14-0004", "14-0005", "14-0006"];

  for (const orderId of ids) {
    const o = await prisma.order.findUnique({
      where: { orderId },
      include: {
        history: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!o) {
      console.log(orderId, "not found");
      continue;
    }
    console.log("=".repeat(70));
    console.log(orderId, "addrLen=" + o.customerAddress.length);
    for (const h of o.history) {
      console.log(
        "  " + h.createdAt.toISOString() + " | " + h.action + " | loc=" + h.location + " | userId=" + h.userId,
      );
    }
  }

  const merchant = await prisma.merchant.findUnique({
    where: { sellerNumber: 14 },
    select: { merchantName: true, sheetImportConfig: true },
  });
  console.log("=".repeat(70));
  console.log("merchant 14 sheetImportConfig:", JSON.stringify(merchant, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
