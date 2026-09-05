/**
 * fix-10007622-fin-status.js
 *
 * One-off data fix: change main order 10007622 financialStatus WO -> WD.
 * WD = delivered, cash collected by driver / owed to office (D999 collected $5).
 * Runs pre-flight validation then a single atomic update + history entry.
 *
 * Run: node scripts/fix-10007622-fin-status.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const o = await prisma.order.findUnique({ where: { orderId: "10007622" } });
  if (!o) {
    console.error("ERROR: order 10007622 not found. Aborting.");
    process.exit(1);
  }
  if (o.location !== "DELIVERED") {
    console.error(`ERROR: location is ${o.location}, expected DELIVERED. Aborting.`);
    process.exit(1);
  }
  if (o.financialStatus !== "WO") {
    console.error(`ERROR: financialStatus is ${o.financialStatus}, expected WO. Nothing to change.`);
    return;
  }

  console.log(`BEFORE: 10007622 location=${o.location} fin=${o.financialStatus} driver=${o.driverId}`);

  let actor = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!actor) actor = { id: o.creatorId };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: o.id },
      data: {
        financialStatus: "WD",
        history: {
          create: {
            action: "Financial status WO → WD (delivered, cash owed to office)",
            location: "DELIVERED",
            driverId: o.driverId,
            userId: actor.id,
          },
        },
      },
    });
  });

  const after = await prisma.order.findUnique({ where: { orderId: "10007622" }, select: { orderId: true, location: true, financialStatus: true } });
  console.log(`AFTER: ${after.orderId} location=${after.location} fin=${after.financialStatus}`);
  console.log("✓ Done.");
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
