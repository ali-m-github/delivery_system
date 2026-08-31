import bcrypt from "bcryptjs";

// ─── Canonical session-JWT helpers ────────────────────────────────────────────
// All signing / verification / cookie-extraction logic now lives in
// `@/lib/jwt` (the single canonical module). It is re-exported here so the
// many existing `@/helpers/auth` import sites keep working with one
// implementation behind them. `createSessionToken` is no longer dead/inconsistent:
// it signs the exact `{ id, role }` shape that login and every verifier use.
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  getJwtSecret,
  createSessionToken,
  verifySessionToken,
  getSessionToken,
  getSessionCookieOptions,
  type SessionPayload,
} from "@/lib/jwt";

// The old `getSessionUserId(request)` helper (verify the `session` cookie on a
// raw Request and return the user id) is preserved for the payout-creation
// attribution call site.
import { getSessionToken as readSessionToken, verifySessionToken } from "@/lib/jwt";
export async function getSessionUserId(
  request: Request,
): Promise<string | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload?.id ?? null;
}

// ─── Password hashing ──────────────────────────────────────────────────────────
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
