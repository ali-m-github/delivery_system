/**
 * Backfills trackToken for all orders that don't have one yet.
 *
 * Run: npx tsx scripts/backfill-track-tokens.ts
 *
 * - Generates a unique random 8-digit token per order
 * - Uses unique-constraint collision retry so no token is ever duplicated
 * - Idempotent: safe to re-run (only touches rows where trackToken IS NULL)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function randomTrackToken(): string {
  return String(10000000 + Math.floor(Math.random() * 90000000));
}

async function uniqueToken(excludeId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const token = randomTrackToken();
    const existing = await prisma.order.findUnique({
      where: { trackToken: token },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return token;
  }
  // Last resort: timestamp-derived suffix, retry on collision
  for (let attempt = 0; attempt < 20; attempt++) {
    const token =
      String(Date.now() % 90000000) + String(Math.floor(Math.random() * 10));
    const existing = await prisma.order.findUnique({
      where: { trackToken: token },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return token;
  }
  throw new Error("Could not generate a unique track token after 40 attempts");
}

async function main() {
  const missing = await prisma.order.findMany({
    where: { trackToken: null },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  console.log(`Orders missing trackToken: ${missing.length}`);
  if (missing.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const row of missing) {
    try {
      const token = await uniqueToken(row.id);
      await prisma.order.update({
        where: { id: row.id },
        data: { trackToken: token },
      });
      updated++;
    } catch (err) {
      failed++;
      if (failed <= 5) {
        console.error(`  failed for order id=${row.id}:`, (err as Error).message);
      }
    }
  }

  console.log(`Done. updated=${updated} failed=${failed}`);

  const remaining = await prisma.order.count({ where: { trackToken: null } });
  console.log(`Orders still missing trackToken: ${remaining}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
