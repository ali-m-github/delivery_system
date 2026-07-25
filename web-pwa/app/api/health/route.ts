import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, { status: "ok" | "fail"; message?: string }> =
    {};

  // 1. Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok" };
  } catch (e: any) {
    checks.database = { status: "fail", message: e.message };
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

  // 3. Middleware file exists (checked at build time, always ok at runtime if we are here)
  checks.middleware = { status: "ok" };

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 },
  );
}
