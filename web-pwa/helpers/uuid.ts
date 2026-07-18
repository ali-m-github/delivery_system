/**
 * Universal HTTP-Compatible UUID v4 Generator
 *
 * Provides a safe fallback for environments where crypto.randomUUID() is
 * unavailable (e.g., HTTP instead of HTTPS, older browsers, or SSR contexts).
 *
 * Priority:
 *   1. window.crypto.randomUUID()  (browser secure context)
 *   2. Math.random()-based RFC 4122 v4 UUID
 */

export function getSafeUUID(): string {
  // Browser: prefer the native crypto.randomUUID when available
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  // Node.js: prefer the native crypto.randomUUID when available
  if (typeof globalThis !== "undefined" && (globalThis as any).crypto) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require("crypto");
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {
      // Fallback below
    }
  }

  // Fallback: RFC 4122 Section 4.4 — Random-based UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
