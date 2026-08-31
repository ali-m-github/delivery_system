// ─── In-memory sliding-window rate limiter ──────────────────────────────────
// Abuse protection for public endpoints (login, signup, public tracking).
//
// Deployment note: state lives in each server process (Node heap). This is
// correct for the current single-instance deployment. If the app is ever run
// behind multiple server processes/instances, swap this for a shared store
// (Redis) — the `consume()` contract below is designed to stay the same.
//
// Edge-safety: no `next/headers`, no `@prisma/client`, no Node-only APIs, so
// this module can be imported from the root middleware if ever needed.

interface WindowEntry {
  key: string;
  windowStart: number;
  count: number;
}

type LimiterConfig = {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Optional cap on tracked keys (eviction safety net). */
  maxKeys?: number;
};

type ConsumeResult =
  | { allowed: true; remaining: number; retryAfterMs: number }
  | { allowed: false; retryAfterMs: number };

const limiters = new Map<string, Map<string, WindowEntry>>();

/** Best-effort client identifier. Prefers the proxied IP headers, then falls
 *  back to the direct socket address, then to a constant bucket. A constant
 *  bucket (instead of per-request uniqueness) is deliberate: it means a
 *  missing IP still gets rate-limited (just grouped), never unlimited. */
export function getClientKey(request: Request): string {
  const forwardFor = request.headers.get("x-forwarded-for");
  if (forwardFor) {
    const first = forwardFor.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return `ip:${realIp.trim()}`;

  // Node server request: the direct peer address (only present when the
  // server is hit without a proxy). Typed loosely to stay edge-safe.
  const socket = (
    request as Request & {
      socket?: { remoteAddress?: string | null };
    }
  ).socket?.remoteAddress;
  if (socket) return `ip:${socket}`;

  return "ip:unknown";
}

function getLimiter(name: string): Map<string, WindowEntry> {
  let store = limiters.get(name);
  if (!store) {
    store = new Map();
    limiters.set(name, store);
  }
  return store;
}

/**
 * Consume one request from the named limiter for the given client key.
 *
 * @returns `allowed: true` with remaining budget, or `allowed: false` with
 *          how long the client must wait before the window frees a slot.
 */
export function consume(
  name: string,
  key: string,
  cfg: LimiterConfig,
): ConsumeResult {
  const store = getLimiter(name);
  const now = Date.now();

  const entry = store.get(key);
  if (!entry || now - entry.windowStart >= cfg.windowMs) {
    store.set(key, { key, windowStart: now, count: 1 });
    // Opportunistic eviction when the store grows too large: drop the
    // oldest windows (Map iteration order = insertion order).
    const maxKeys = cfg.maxKeys ?? 10_000;
    if (store.size > maxKeys) {
      const overflow = store.size - maxKeys;
      let i = 0;
      for (const k of store.keys()) {
        if (i >= overflow) break;
        store.delete(k);
        i++;
      }
    }
    return {
      allowed: true,
      remaining: cfg.limit - 1,
      retryAfterMs: 0,
    };
  }

  if (entry.count >= cfg.limit) {
    const retryAfterMs = Math.max(
      0,
      entry.windowStart + cfg.windowMs - now,
    );
    return { allowed: false, retryAfterMs };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: cfg.limit - entry.count,
    retryAfterMs: 0,
  };
}

/**
 * Convenience wrapper for API routes: returns `null` when the request is
 * allowed, or a 429 `Response` with a `Retry-After` header when it is not.
 */
export function rateLimitResponse(
  name: string,
  request: Request,
  cfg: LimiterConfig,
): Response | null {
  const result = consume(name, getClientKey(request), cfg);
  if (result.allowed) return null;

  const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec),
    },
  });
}

/** Test/diagnostic helper: current tracked key count for a named limiter. */
export function limiterStats(name: string): number {
  return limiters.get(name)?.size ?? 0;
}
