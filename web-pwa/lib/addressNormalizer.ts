// ─── Address Normalization & Fuzzy Matching Utilities ──────────────────────────
// Used by the Zone Training Engine and Auto-Assign system.

/**
 * Arabic character normalization map.
 * Alef variants → bare alef (ا), Yaa variants → bare yaa (ي),
 * Taa Marboota → Haa (ة → ه)
 */
const ARABIC_NORM_MAP: Record<string, string> = {
  "\u0623": "\u0627", // أ → ا
  "\u0625": "\u0627", // إ → ا
  "\u0622": "\u0627", // آ → ا
  "\u0649": "\u064A", // ى → ي
  "\u0629": "\u0647", // ة → ه
};

/**
 * Normalize an address string for consistent comparison.
 *
 * Steps:
 * 1. Trim leading/trailing whitespace
 * 2. Convert to lowercase
 * 3. Apply Arabic character normalization
 * 4. Remove punctuation and symbols (keep letters, digits, whitespace)
 * 5. Collapse multiple whitespace into single space
 */
export function normalizeAddress(address: string): string {
  let normalized = address.trim().toLowerCase();

  // Apply Arabic normalization
  normalized = normalized
    .split("")
    .map((ch) => ARABIC_NORM_MAP[ch] ?? ch)
    .join("");

  // Remove punctuation and symbols; keep alphanumeric, whitespace, and Arabic chars
  normalized = normalized.replace(/[^\w\s\u0600-\u06FF]/g, " ");

  // Collapse multiple spaces into one
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

/**
 * Compute Levenshtein (edit) distance between two strings.
 * Uses the classic dynamic programming approach with O(n) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Ensure `a` is the shorter string to minimize memory
  if (aLen > bLen) return levenshteinDistance(b, a);

  // Single-row DP
  let prevRow = Array.from({ length: aLen + 1 }, (_, i) => i);
  let currRow = new Array<number>(aLen + 1);

  for (let j = 1; j <= bLen; j++) {
    currRow[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i] + 1, // deletion
        currRow[i - 1] + 1, // insertion
        prevRow[i - 1] + cost, // substitution
      );
    }
    // Swap rows
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[aLen];
}

/**
 * Compute normalized similarity score between two strings.
 * Returns a value between 0 (completely different) and 1 (identical).
 *
 * Uses 1 - (Levenshtein distance / max length) formula.
 */
export function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1; // both empty
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}
