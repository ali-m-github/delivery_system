/**
 * Audit verification for app/api/drivers/[id]/payouts/route.ts
 * Run against the dev server on :3005. Creates temporary users, verifies the
 * authorization matrix, the mixed-batch atomicity (9 valid + 1 invalid =>
 * NOTHING created), and that client-supplied money is ignored. Cleans up all
 * test artifacts afterwards.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = "http://localhost:3005";

// Plain node does not auto-load .env — load it before building Prisma and
// signing tokens (must match the server's getJwtSecret()).
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const JWT_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET ||
    "web-pwa:development-only-session-salt",
);

const prisma = new PrismaClient();

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function tokenFor(userId: string, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ id: userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(JWT_KEY);
}

interface PayoutResponse {
  id?: string;
  totalUsd?: number;
  totalLbp?: number;
  commissionUsd?: number;
  netUsd?: number;
  status?: string;
  error?: string;
  rejectedOrderIds?: string[];
}

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: PayoutResponse | null }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { cookie: `session=${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: PayoutResponse | null = null;
  try {
    json = JSON.parse(text) as PayoutResponse;
  } catch {}
  return { status: res.status, json };
}

async function main() {
  // ── Load real accounts ──────────────────────────────────────────────────
  const [admin, merchant, driverA, driverB, employee] = await Promise.all([
    prisma.user.findUnique({ where: { username: "a.matar" } }), // ADMIN
    prisma.user.findUnique({ where: { username: "tloba" } }), // MERCHANT
    prisma.user.findUnique({ where: { username: "alihellani" } }), // DRIVER D0003 — 19 eligible orders
    prisma.user.findUnique({ where: { username: "aliahmad" } }), // DRIVER D0002 — 4 eligible orders
    prisma.user.findUnique({ where: { username: "nourk" } }), // EMPLOYEE, has DRIVERS_PAYOUT+DRIVERS_VIEW
  ]);
  if (!admin || !merchant || !driverA || !driverB || !employee) {
    throw new Error("Missing expected test accounts");
  }
  const profileA = await prisma.driverProfile.findUnique({
    where: { userId: driverA.id },
  });
  const profileB = await prisma.driverProfile.findUnique({
    where: { userId: driverB.id },
  });
  if (!profileA || !profileB) throw new Error("Missing driver profiles");
  console.log(
    `Profiles: A=${profileA.driverId}(${profileA.id}) B=${profileB.driverId}(${profileB.id})`,
  );

  const tokens = {
    admin: await tokenFor(admin.id, admin.role),
    merchant: await tokenFor(merchant.id, merchant.role),
    driverA: await tokenFor(driverA.id, driverA.role),
    driverB: await tokenFor(driverB.id, driverB.role),
    employee: await tokenFor(employee.id, employee.role),
  };

  // ── Temporary accounts ──────────────────────────────────────────────────
  const ts = Date.now();
  const tempUser = await prisma.user.create({
    data: {
      email: `audit-temp-${ts}@test.local`,
      username: `audit-temp-user-${ts}`,
      password: "x", // never used; tokens are signed directly
      role: "USER",
    },
  });
  const groupPayoutOnly = await prisma.permissionGroup.create({
    data: {
      name: `audit-tmp-payout-only-${ts}`,
      permissions: ["DRIVERS_PAYOUT"],
    },
  });
  const tempEmpPayoutOnly = await prisma.user.create({
    data: {
      email: `audit-emp-pay-${ts}@test.local`,
      username: `audit-emp-pay-${ts}`,
      password: "x",
      role: "EMPLOYEE",
      permissionGroupId: groupPayoutOnly.id,
    },
  });
  const tempEmpNone = await prisma.user.create({
    data: {
      email: `audit-emp-none-${ts}@test.local`,
      username: `audit-emp-none-${ts}`,
      password: "x",
      role: "EMPLOYEE",
    },
  });
  const tUser = await tokenFor(tempUser.id, tempUser.role);
  const tEmpPayout = await tokenFor(tempEmpPayoutOnly.id, tempEmpPayoutOnly.role);
  const tEmpNone = await tokenFor(tempEmpNone.id, tempEmpNone.role);

  const GET_PATH = `/api/drivers/${profileA.driverId.toLowerCase()}/payouts`;
  const POST_B = `/api/drivers/${profileB.driverId.toLowerCase()}/payouts`;
  const POST_A = `/api/drivers/${profileA.driverId.toLowerCase()}/payouts`;

  // ══ GET authorization matrix (target: driver A's profile) ═══════════════
  console.log("\n── GET /api/drivers/<A>/payouts ──");
  let r = await call("GET", GET_PATH, tokens.merchant);
  check("MERCHANT denied (403)", r.status === 403, `got ${r.status}`);

  r = await call("GET", GET_PATH, tokens.driverB);
  check(
    "DRIVER-for-another-driver denied (403)",
    r.status === 403,
    `got ${r.status}`,
  );

  r = await call("GET", GET_PATH, tUser);
  check("unrelated USER role denied (403)", r.status === 403, `got ${r.status}`);

  r = await call("GET", GET_PATH, tEmpNone);
  check(
    "EMPLOYEE without permissions denied (403)",
    r.status === 403,
    `got ${r.status}`,
  );

  r = await call("GET", GET_PATH, tEmpPayout);
  check(
    "EMPLOYEE with DRIVERS_PAYOUT only (no DRIVERS_VIEW) denied (403)",
    r.status === 403,
    `got ${r.status}`,
  );

  r = await call("GET", GET_PATH, null);
  check("anonymous denied (401)", r.status === 401, `got ${r.status}`);

  r = await call("GET", GET_PATH, tokens.employee);
  check("staff with DRIVERS_VIEW allowed (200)", r.status === 200, `got ${r.status}`);

  r = await call("GET", GET_PATH, tokens.driverA);
  check("DRIVER own profile allowed (200)", r.status === 200, `got ${r.status}`);

  r = await call("GET", GET_PATH, tokens.admin);
  check("ADMIN allowed (200)", r.status === 200, `got ${r.status}`);

  // ══ POST authorization matrix (target: driver B's profile) ══════════════
  console.log("\n── POST /api/drivers/<B>/payouts ──");
  const eligibleB = await prisma.order.findMany({
    where: {
      driverId: profileB.id,
      location: "DELIVERED",
      financialStatus: { in: ["WD", "UD"] },
      driverPayoutId: null,
    },
    select: {
      id: true,
      amountUsd: true,
      collectedUsd: true,
      merchantId: true,
      zoneId: true,
    },
    orderBy: { id: "asc" },
  });
  console.log(`driver B has ${eligibleB.length} eligible unclaimed orders`);
  if (eligibleB.length < 4) throw new Error("Need >=4 eligible orders for B");
  const idsB = eligibleB.map((o) => o.id);
  const probe = { orderIds: [idsB[0]] };

  r = await call("POST", POST_B, tokens.merchant, probe);
  check("MERCHANT denied (403)", r.status === 403, `got ${r.status}`);

  r = await call("POST", POST_B, tokens.driverA, probe);
  check(
    "DRIVER-for-another-driver denied (403)",
    r.status === 403,
    `got ${r.status}`,
  );

  r = await call("POST", POST_B, tUser, probe);
  check("unrelated USER role denied (403)", r.status === 403, `got ${r.status}`);

  r = await call("POST", POST_B, tEmpNone, probe);
  check(
    "EMPLOYEE without permissions denied (403)",
    r.status === 403,
    `got ${r.status}`,
  );

  // ── Mixed batch: 9 valid + 1 invalid must create NOTHING (driver A) ─────
  console.log("\n── Mixed batch atomicity (9 valid + 1 invalid, driver A) ──");
  const eligibleA = await prisma.order.findMany({
    where: {
      driverId: profileA.id,
      location: "DELIVERED",
      financialStatus: { in: ["WD", "UD"] },
      driverPayoutId: null,
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  console.log(`driver A has ${eligibleA.length} eligible unclaimed orders`);
  if (eligibleA.length < 10) throw new Error("Need >=10 eligible orders for A");
  const mixIds = [...eligibleA.slice(0, 9).map((o) => o.id), "no-such-order-id"];

  const before = await prisma.$transaction([
    prisma.driverPayout.count({ where: { driverId: profileA.id } }),
    prisma.order.count({
      where: {
        driverId: profileA.id,
        location: "DELIVERED",
        financialStatus: { in: ["WD", "UD"] },
        driverPayoutId: null,
      },
    }),
  ]);

  r = await call("POST", POST_A, tokens.employee, { orderIds: mixIds });
  check(
    "mixed batch rejected (400)",
    r.status === 400,
    `got ${r.status} ${JSON.stringify(r.json)}`,
  );
  check(
    "error names the rejected ID",
    Array.isArray(r.json?.rejectedOrderIds) &&
      r.json.rejectedOrderIds.includes("no-such-order-id"),
    JSON.stringify(r.json?.rejectedOrderIds),
  );

  const after = await prisma.$transaction([
    prisma.driverPayout.count({ where: { driverId: profileA.id } }),
    prisma.order.count({
      where: {
        driverId: profileA.id,
        location: "DELIVERED",
        financialStatus: { in: ["WD", "UD"] },
        driverPayoutId: null,
      },
    }),
  ]);
  check(
    "NOTHING created (payout count unchanged)",
    before[0] === after[0],
    `before=${before[0]} after=${after[0]}`,
  );
  check(
    "NOTHING claimed (eligible order count unchanged)",
    before[1] === after[1],
    `before=${before[1]} after=${after[1]}`,
  );

  // ── Non-string IDs rejected ─────────────────────────────────────────────
  r = await call("POST", POST_A, tokens.employee, { orderIds: [123, "x"] });
  check(
    "non-string orderIds rejected (400)",
    r.status === 400,
    `got ${r.status}`,
  );

  // ── Self-service with SPOOFED money: server math must win ───────────────
  console.log("\n── Driver B self-service with spoofed client totals ──");
  const beforeB = await prisma.$transaction([
    prisma.driverPayout.count({ where: { driverId: profileB.id } }),
    prisma.order.count({
      where: {
        driverId: profileB.id,
        location: "DELIVERED",
        financialStatus: { in: ["WD", "UD"] },
        driverPayoutId: null,
      },
    }),
  ]);

  r = await call("POST", POST_B, tokens.driverB, {
    orderIds: idsB,
    totalUsd: 999999,
    totalLbp: 999999,
    commissionUsd: 0,
    netUsd: 999999,
  });
  check("driver own-profile POST allowed (201)", r.status === 201, `got ${r.status} ${JSON.stringify(r.json?.error ?? "")}`);

  const created = r.json;
  const expectedGrossUsd = eligibleB.reduce(
    (s, o) => s + (o.collectedUsd > 0 ? o.collectedUsd : o.amountUsd),
    0,
  );
  check(
    "client-spoofed totals ignored (totalUsd = server gross)",
    !!created &&
      created.totalUsd !== undefined &&
      Math.abs(created.totalUsd - expectedGrossUsd) < 0.01,
    `created=${created?.totalUsd} expected=${expectedGrossUsd} spoof=999999`,
  );
  check(
    "netUsd = totalUsd - commissionUsd",
    !!created &&
      created.netUsd !== undefined &&
      created.totalUsd !== undefined &&
      created.commissionUsd !== undefined &&
      Math.abs(
        created.netUsd - (created.totalUsd - created.commissionUsd),
      ) < 0.01,
  );
  check("created payout is PENDING", created?.status === "PENDING");

  const afterB = await prisma.$transaction([
    prisma.driverPayout.count({ where: { driverId: profileB.id } }),
    prisma.order.count({
      where: {
        driverId: profileB.id,
        location: "DELIVERED",
        financialStatus: { in: ["WD", "UD"] },
        driverPayoutId: null,
      },
    }),
  ]);
  check(
    "exactly one payout created",
    afterB[0] === beforeB[0] + 1,
    `before=${beforeB[0]} after=${afterB[0]}`,
  );
  check(
    "all requested orders claimed",
    afterB[1] === beforeB[1] - idsB.length,
    `before=${beforeB[1]} after=${afterB[1]}`,
  );

  // ── Already-claimed orders are rejected ─────────────────────────────────
  r = await call("POST", POST_B, tokens.driverB, { orderIds: [idsB[0]] });
  check(
    "already-claimed order rejected (400)",
    r.status === 400,
    `got ${r.status} ${JSON.stringify(r.json?.error ?? "").slice(0, 120)}`,
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────
  console.log("\n── Cleanup ──");
  if (created?.id) {
    await prisma.$transaction([
      prisma.order.updateMany({
        where: { driverPayoutId: created.id },
        data: { driverPayoutId: null },
      }),
      prisma.driverPayout.delete({ where: { id: created.id } }),
    ]);
    console.log("deleted test payout", created.id);
  }
  await prisma.user.delete({ where: { id: tempUser.id } });
  await prisma.user.delete({ where: { id: tempEmpPayoutOnly.id } });
  await prisma.user.delete({ where: { id: tempEmpNone.id } });
  await prisma.permissionGroup.delete({ where: { id: groupPayoutOnly.id } });
  console.log("deleted temp users + permission group");

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
}

main()
  .catch((e) => {
    console.error("SCRIPT ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
