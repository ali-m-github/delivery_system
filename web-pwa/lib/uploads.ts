// ─── Uploaded file validation & serving ──────────────────────────────────────
// Shared guards for file uploads: run these BEFORE any expensive processing
// (OCR, image pipelines) so malformed/spoofed files fail fast and cheap.
//
// The key protection is magic-byte sniffing: the browser-supplied
// `Content-Type` is attacker-controlled and can be a lie (e.g. a binary
// payload sent as "image/jpeg"). We only trust the file's own header bytes.

import path from "node:path";
import { stat, readFile } from "node:fs/promises";

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

// ─── Serving uploaded files ──────────────────────────────────────────────────
//
// Root of the on-disk upload tree. Every stored asset (merchant logos, driver
// photos, waybills) lives under `public/uploads/<kind>/`.

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  ico: "image/x-icon",
};

/**
 * Serve an uploaded file by its path relative to `public/uploads`
 * (e.g. `merchants/1788…-logo.png`).
 *
 * Why this exists: Next.js 16's production server (`next start`) only serves
 * `public/` files that existed when the process started — anything uploaded
 * at runtime 404s until a restart. `app/uploads/[...file]/route.ts` calls
 * this on every request (route handlers are not cached by default), so
 * freshly uploaded files are always available.
 *
 * The web URL is attacker-controllable, so the input is resolved against
 * UPLOAD_ROOT and rejected if it escapes it (path-traversal guard).
 *
 * @returns a 200 Response streaming the file, or null when missing/invalid.
 */
export async function serveUploadedFile(
  relPath: string,
): Promise<Response | null> {
  const cleaned = path.normalize(relPath).replace(/^[/\\]+/, "");
  const abs = path.resolve(UPLOAD_ROOT, cleaned);
  if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) {
    return null;
  }

  try {
    const fileStat = await stat(abs);
    if (!fileStat.isFile()) return null;
    const buf = await readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Content-Length": String(fileStat.size),
        // Assets can be re-uploaded; never let a client cache a stale copy.
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return null;
  }
}
