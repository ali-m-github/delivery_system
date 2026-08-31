import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  createSessionToken,
  getSessionCookieOptions,
} from "@/lib/jwt";
import { rateLimitResponse } from "@/lib/rate-limit";

// Timing-equalization hash (cost 10, same as the canonical hash cost).
// Computed whenever a credential check fails so the response time does not
// reveal whether the identifier exists — user enumeration countermeasure.
const DUMMY_HASH =
  "$2b$10$D9twrBgzMrln.XEPg8Fog./Yt5Dg8kVV0DvKl.gOynQR7HAWuADAy";

export async function POST(request: Request) {
  // ── Abuse protection: per-client rate limit on credential checks ──
  // 20 attempts / 15 min per IP is generous for legitimate users and
  // blocks brute-force password guessing. (Tighten/loosen as needed; for
  // high-threat deployments front this with a WAF and consider a
  // progressive lockout — both require infrastructure support.)
  const throttled = rateLimitResponse("auth-login", request, {
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (throttled) return throttled;

  try {
    const body = await request.json();
    // Fallback to extracting 'email' if the frontend hasn't updated yet, but map it to 'identifier'
    const identifier = body.identifier || body.email;
    const password = typeof body.password === "string" ? body.password : "";

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
      select: { id: true, password: true, role: true },
    });

    // Always run a bcrypt comparison — even when the user is missing or the
    // identifier type is unusable — so both paths cost ~the same time.
    const passwordOk = user
      ? await bcrypt.compare(password, user.password)
      : await bcrypt.compare(password, DUMMY_HASH);

    if (!user || !passwordOk) {
      // Single generic failure; never say which field was wrong.
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    const token = await createSessionToken({ id: user.id, role: user.role });

    (await cookies()).set(
      SESSION_COOKIE,
      token,
      getSessionCookieOptions(request.url.startsWith("https://")),
    );

    return NextResponse.json(
      { success: true, role: user.role },
      { status: 200 },
    );
  } catch (error) {
    console.error("Login Error:", error);
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }
}
