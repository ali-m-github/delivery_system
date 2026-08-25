import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAYOUT_ID = "cmsbtrcp4000ulqagvlflynn2";

async function main() {
  const payout = await prisma.driverPayout.findUnique({
    where: { id: PAYOUT_ID },
    select: {
      id: true,
      payoutReference: true,
      status: true,
      amountPaidUsd: true,
      statementsDeductedUsd: true,
      treasuryBoxId: true,
    },
  });
  console.log("payout:", payout);

  if (payout?.treasuryBoxId) {
    const box = await prisma.treasuryBox.findUnique({
      where: { id: payout.treasuryBoxId },
    });
    console.log("box:", box);
  }

  const txns = await prisma.treasuryTransaction.findMany({
    where: { referenceId: PAYOUT_ID },
  });
  console.log("treasury transactions for payout:", JSON.stringify(txns, null, 2));

  const stmtTxs = await prisma.treasuryTransaction.findMany({
    where: { referenceId: "7e26246c-7981-4b4c-8397-48274e684dbf" },
  });
  console.log("treasury transactions for statement #3:", JSON.stringify(stmtTxs, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
