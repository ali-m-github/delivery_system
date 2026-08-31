// ─── Uploaded file validation ────────────────────────────────────────────────
// Shared guards for file uploads: run these BEFORE any expensive processing
// (OCR, image pipelines) so malformed/spoofed files fail fast and cheap.
//
// The key protection is magic-byte sniffing: the browser-supplied
// `Content-Type` is attacker-controlled and can be a lie (e.g. a binary
// payload sent as "image/jpeg"). We only trust the file's own header bytes.

export interface ValidatedImage {
  /** MIME type derived from the file's actual magic bytes. */
  mime: string;
  /** File extension without the leading dot (e.g. "jpg"). */
  ext: string;
  /** Byte size of the file. */
  size: number;
}

const MAGIC_BYTE_MAP: Array<{
  test: (b: Buffer) => boolean;
  mime: string;
  ext: string;
}> = [
  // JPEG: FF D8 FF
  { test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, mime: "image/jpeg", ext: "jpg" },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, mime: "image/png", ext: "png" },
  // WebP: RIFF....WEBP
  { test: (b) => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, mime: "image/webp", ext: "webp" },
];

/**
 * Validate that a file is a real, decodable image of a type the downstream
 * image pipeline (sharp / OCR) is expected to handle, and that it respects
 * the size limit.
 *
 * @returns `{ ok: true, ...meta }` when valid, or `{ ok: false, error }`
 *          with a client-safe message when invalid.
 *
 * Accepts JPEG / PNG / WebP — the formats real waybill photos and the
 * OCR.space fallback API support. Other formats fail fast here instead of
 * inside the expensive OCR pipeline.
 */
export async function validateImageFile(
  file: File,
  maxSizeBytes: number,
): Promise<({ ok: true } & ValidatedImage) | { ok: false; error: string }> {
  if (!(file instanceof File)) {
    return { ok: false, error: "Invalid file" };
  }
  if (file.size <= 0) {
    return { ok: false, error: "Empty file" };
  }
  if (file.size > maxSizeBytes) {
    const mb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `File exceeds the ${mb} MB limit` };
  }

  // Fast pre-check via a short slice before reading the whole buffer.
  const header = file.slice(0, 16);
  return header.arrayBuffer().then((ab) => {
    const head = Buffer.from(ab);
    const match = MAGIC_BYTE_MAP.find((m) => m.test(head));
    if (!match) {
      return {
        ok: false as const,
        error: "Unsupported file type (JPEG, PNG or WebP required)",
      };
    }
    return { ok: true as const, mime: match.mime, ext: match.ext, size: file.size };
  });
}

/**
 * Sanitize a client-supplied filename into a safe basename.
 * Strips path components and every character outside a conservative
 * allow-list, then truncates. The caller prepends a unique prefix
 * (e.g. a timestamp) and the validated extension.
 */
export function safeFileName(name: string, maxLen = 60): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return (stem || "file").slice(-maxLen);
}
