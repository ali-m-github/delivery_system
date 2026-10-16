// Temporary E2E helper: mint a session JWT for an admin user (reads .env manually, no dotenv dep)
const fs = require("fs");
const path = require("path");
const { SignJWT } = require("jose");
const { PrismaClient } = require("@prisma/client");

const envPath = path.join(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const m = env.match(/^JWT_SECRET=(.*)$/m);
if (!m) {
  console.error("JWT_SECRET not found in .env");
  process.exit(1);
}
const jwtSecret = m[1].trim().replace(/^["']|["']$/g, "");

const prisma = new PrismaClient();

(async () => {
  const username = process.argv[2] || "a.matar";
  const u = await prisma.user.findFirst({ where: { username } });
  if (!u) {
    console.error("user not found: " + username);
    process.exit(1);
  }
  const secret = new TextEncoder().encode(jwtSecret);
  const token = await new SignJWT({ id: u.id, role: u.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
  console.log(token);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
