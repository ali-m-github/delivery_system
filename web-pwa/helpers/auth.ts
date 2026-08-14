import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback_secret_for_development_only",
);

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(
  password: string,
  hashed: string,
): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

export async function createSessionToken(payload: {
  userId: string;
  role: string;
}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    // The login route signs { id, role }, so expose `id` (not `userId`).
    return payload as { id: string; role: string };
  } catch (error) {
    return null;
  }
}

// Extracts the authenticated user's id from the `session` cookie on a raw
// Request. Used by routes that create records but don't gate on a permission
// (e.g. payout creation) so they can attribute the record to the actor.
export async function getSessionUserId(
  request: Request,
): Promise<string | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;
  const payload = await verifySessionToken(decodeURIComponent(match[1]));
  return payload?.id ?? null;
}
