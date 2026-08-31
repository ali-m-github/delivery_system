import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/server-permissions";

// ──────────────────────────────────────────────
// GET /api/health
//
// Public (unauthenticated): returns only the operational state a load
// balancer / uptime monitor needs — an HTTP status + a coarse status
// string. No error messages, no environment variable names, no stack
// details: those would let an unauthenticated visitor fingerprint the
// deployment (e.g. "Missing: JWT_SECRET" is an auth misconfiguration).
//
// Authenticated ADMIN: additionally receives the detailed per-check
// results (database ok/fail with the underlying error, env checks) so
// operators can diagnose degraded states.
//
// NOTE: `getSessionUser` reads the session cookie from next/headers and
// queries the DB; on a DB outage it resolves to `null` (the health
// check itself is what reports the outage), never a thrown error.
// ──────────────────────────────────────────────

export async function GET() {
  const checks: Record<string, { status: "ok" | "fail"; message?: string }> =
    {};

  // 1. Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok" };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[health] database check failed:", message);
    checks.database = { status: "fail", message };
  }

  // 2. Environment variables
  const missingEnv: string[] = [];
  if (!process.env.DATABASE_URL) missingEnv.push("DATABASE_URL");
  if (!process.env.JWT_SECRET) missingEnv.push("JWT_SECRET");

  if (missingEnv.length === 0) {
    checks.env = { status: "ok" };
  } else {
    checks.env = {
      status: "fail",
      message: `Missing: ${missingEnv.join(", ")}`,
    };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  // Only admins see the detailed checks. `await` is safe here: this route
  // handler runs in the Node runtime where cookies() is supported.
  let admin = false;
  try {
    const user = await getSessionUser();
    admin = user?.role === "ADMIN";
  } catch {
    admin = false; // health must never 500 because of the admin check
  }

  if (!admin) {
    // Minimal public payload: enough for monitoring (HTTP status + string).
    return NextResponse.json(
      {
        status: allOk ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
      },
      { status: allOk ? 200 : 503 },
    );
  }

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 },
  );
}
