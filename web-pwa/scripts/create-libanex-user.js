/**
 * Creates the "libanex" system user used to attribute imported orders and
 * replicated Libanex history events (OrderHistory.userId is required).
 *
 * Run: node scripts/create-libanex-user.js
 * Idempotent: prints the existing user if it already exists.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const USERNAME = "libanex";

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (existing) {
    console.log(`System user already exists: ${existing.id} (${existing.username})`);
    return;
  }

  // Random, unusable password — this account is never meant to log in.
  const password = await bcrypt.hash(require("crypto").randomBytes(24).toString("hex"), 10);

  const user = await prisma.user.create({
    data: {
      email: "libanex@system.local",
      username: USERNAME,
      password,
      role: "USER",
      permissions: [],
    },
  });
  console.log(`Created system user: ${user.id} (${user.username})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
