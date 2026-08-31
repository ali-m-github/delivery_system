// ─── Canonical session-JWT primitives ─────────────────────────────────────────
// Single source of truth for signing, verifying and extracting the `session`
// cookie. Every route handler, server component, server action and the root
// middleware MUST go through this module — never call `jose` directly and
// never read `process.env.JWT_SECRET` inline (see `getJwtSecret()`).
//
// This module is intentionally EDGE-SAFE (no `next/headers`, no
// `@prisma/client`, no Node-only APIs) so it can be imported from the
// root `middleware.ts`, which runs on the Edge runtime.
import { SignJWT, jwtVerify } from "jose";

/** Name of the session cookie. Centralized so it can never drift. */
export const SESSION_COOKIE = "session";

/**
 * How long a signed session lasts. The token's `exp` claim and the cookie's
 * `maxAge` MUST both derive from this single constant so they cannot drift
 * apart (a longer-lived cookie than its token only produces confusing 401s,
 * and a shorter-lived cookie orphans a still-valid token).
 */
export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** `exp` value (seconds since epoch) for a token issued "now". */
function sessionExpiresAt(now = Date.now()): number {
  return Math.floor(now / 1000) + SESSION_TTL_SECONDS;
}

/**
 * The ONE and only place the JWT secret is read.
 *
 * It is read lazily on every call (not captured at module-import time) so a
 * late-loading environment variable is honored. When `JWT_SECRET` is missing
 * in production it throws instead of falling back to any hardcoded value —
 * a hardcoded production fallback is a known auth-bypass vector and is
 * deliberately NOT present in this codebase.
 *
 * In development the caller is told to set `JWT_SECRET` and the secret is
 * derived from an explicit development salt; dev sessions therefore do not
 * interoperate with production sessions.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.length > 0) {
    return new TextEncoder().encode(secret);
  }

  if (process.env.NODE_ENV === "production") {
    // Fail closed: refuse to sign or verify anything.
    throw new Error("JWT_SECRET is not set in the environment");
  }

  // Development only. Deliberately not a plausible secret, and documented as
  // such; production fails instead of using it.
  return new TextEncoder().encode("web-pwa:development-only-session-salt");
}

/**
 * Canonical session token payload shape. The login route signs this exact
 * object; every verification site receives exactly this back. `id` (not
 * `userId`) is the user identifier — all consumers must read `payload.id`.
 */
export interface SessionPayload {
  /** User id (CUID). */
  id: string;
  /** Role at sign-in time. Use ONLY for convenience/redirects — authorization
   *  decisions must re-read the role from the database (see
   *  lib/server-permissions.ts), because a 24-hour token may carry a stale
   *  role after an admin change. */
  role: string;
  /** Standard JWT claims added at sign time (seconds since epoch). */
  iat?: number;
  exp?: number;
}

/**
 * Signs a session token. Canonical payload shape, HS256, fixed 24h lifetime.
 * Do not pass extra claims — the shape is intentionally minimal.
 */
export async function createSessionToken(
  payload: Pick<SessionPayload, "id" | "role">,
): Promise<string> {
  const now = Date.now();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(sessionExpiresAt(now))
    .sign(getJwtSecret());
}

/**
 * Verifies a session token (signature + expiry) and returns its payload.
 * Returns `null` for any failure (bad signature, expired, malformed, or a
 * missing/misshaped payload) so callers can uniformly treat "null" as
 * "not authenticated".
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const id = payload.id;
    const role = payload.role;
    if (typeof id !== "string" || id.length === 0) return null;
    if (typeof role !== "string" || role.length === 0) return null;
    return { id, role, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * Reads the `session` cookie from an incoming Request.
 * Works for raw `Request` (route handlers, server actions) and for
 * `NextRequest` (middleware), since both expose `headers`.
 */
export function getSessionToken(request: {
  headers: { get(name: string): string | null };
}): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Cookie options for the session cookie. `maxAge` mirrors the token's own
 * `exp` (both = SESSION_TTL_SECONDS) so the cookie and the token expire
 * together. `secure` is forced on in production (NODE_ENV === "production")
 * and whenever the request arrived over HTTPS, so the cookie is never sent
 * in cleartext on a secure origin.
 */
export function getSessionCookieOptions(requestedSecure: boolean): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: requestedSecure || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
