import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/helpers/auth";
import { rateLimitResponse } from "@/lib/rate-limit";

// ── Abuse protection ─────────────────────────────────────────────────────
// Signup is public and creates accounts (a resource), so it gets a strict
// per-client rate limit. 5 per 24h per IP is generous for legitimate
// merchant onboarding and blocks account-creation spam. If legitimate
// registration spikes are expected, front this with an allowlist/invite
// gate (infrastructure support) rather than raising the limit.
// ──────────────────────────────────────────────────────────────────────────

// Field bounds (defense in depth; the DB enforces its own limits too).
const USERNAME_RE = /^[a-zA-Z0-9._-]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  // Per-client throttle before any parsing/DB work.
  const throttled = rateLimitResponse("auth-signup", request, {
    limit: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (throttled) return throttled;

  try {
    const body = await request.json();
    const { username, firstName, lastName, email, password } = body;

    // 1. Validate all required fields
    if (!username || !firstName || !lastName || !email || !password) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: username, firstName, lastName, email, password",
        },
        { status: 400 },
      );
    }

    // Reject non-string payloads early (avoids regex/length crashes and
    // keeps all validation errors uniform).
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.length > 0 ? v : null;
    const u = str(username);
    const fn = str(firstName);
    const ln = str(lastName);
    const em = str(email);
    const pw = typeof password === "string" ? password : null;
    if (!u || !fn || !ln || !em || !pw) {
      return NextResponse.json({ error: "Invalid field types" }, { status: 400 });
    }

    // Basic email format validation
    if (!EMAIL_RE.test(em) || em.length > 254) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Basic password strength (upper bound avoids bcrypt's 72-byte limit
    // being silently truncated, and stops huge password payloads).
    if (pw.length < 6 || pw.length > 128) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    // Username shape: short, alphanumeric-safe (keeps stored values clean
    // and stops path/injection-ish junk in an identity field).
    if (!USERNAME_RE.test(u)) {
      return NextResponse.json(
        { error: "Invalid username" },
        { status: 400 },
      );
    }

    // Name length bounds (DB columns are varchar; bound explicitly).
    if (fn.length > 100 || ln.length > 100) {
      return NextResponse.json(
        { error: "Name too long" },
        { status: 400 },
      );
    }

    // 2. Check if email or username already exists
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: em }, { username: u }] },
      select: { email: true },
    });

    if (existingUser) {
      // Single generic message — don't reveal which field already exists.
      return NextResponse.json(
        { error: "Account already registered" },
        { status: 409 },
      );
    }

    // 3. Hash the password
    const hashedPassword = await hashPassword(pw);

    // 4. Create user with MERCHANT role (no merchant profile yet — admin links later)
    await prisma.user.create({
      data: {
        email: em,
        username: u,
        password: hashedPassword,
        role: "MERCHANT",
      },
    });

    return NextResponse.json(
      {
        message: "Merchant account created successfully. Await admin linking.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Signup Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
