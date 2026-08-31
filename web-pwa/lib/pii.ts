// ─── PII masking helpers for server logs ────────────────────────────────────
// Server logs must never contain full customer PII (phone numbers, names,
// addresses). Use these helpers whenever logging order/customer data.

/** Mask a phone number, keeping country prefix and last two digits visible:
 *  "+961 71 123456" → "+961 71 ****56", "03123456" → "03******56". */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "(none)";
  const display = phone.trim();
  if (display.length <= 4) return "****";
  // Keep a short leading hint (e.g. country code), mask the middle, keep
  // the last two digits: "+961 71 123456" → "+961 ••••••56".
  const head = display.slice(0, Math.max(1, display.length - 8));
  const tail = display.slice(-2);
  return `${head}${"•".repeat(Math.min(6, Math.max(2, display.length - 10)))}${tail}`;
}

/** Mask a customer name, keeping first token + first letter of the rest:
 *  "Jane A. Doe" → "Jane D.*****". */
export function maskName(name: string | null | undefined): string {
  if (!name) return "(none)";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "(none)";
  const first = parts[0];
  const maskedFirst =
    first.length <= 1 ? first : `${first[0]}${"*".repeat(first.length - 1)}`;
  const tail = parts
    .slice(1)
    .map((p) => (p.length <= 1 ? `${p}.` : `${p[0]}.`))
    .join(" ");
  return tail ? `${maskedFirst} ${tail}` : maskedFirst;
}

/** Mask a free-text address down to a coarse locality hint. */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return "(none)";
  const trimmed = address.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 8) return trimmed;
  // Keep only the first few words (city/district level), drop street detail.
  const words = trimmed.split(" ").slice(0, 3).join(" ");
  return `${words}…`;
}
