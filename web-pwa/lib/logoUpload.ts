import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateImageFile, safeFileName } from "@/lib/uploads";

/**
 * Directory (relative to the project root) where merchant logo files are stored.
 * Files under `public/` are served at the base URL (e.g. `/uploads/merchants/...`).
 */
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "merchants");

/** Hard cap on a single uploaded logo. */
export const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Type guard: true when the FormData value is a non-empty File object.
 * NOTE: The global `File` type is available in Next.js Route Handlers (Node runtime).
 */
export function isImageFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

/**
 * Persist an uploaded logo to `public/uploads/merchants/` (creating the
 * directory if needed) and return the web-accessible relative path.
 *
 * The file is validated BEFORE it is written: size cap (5 MB) and magic-byte
 * sniffing (JPEG/PNG/WebP) so a spoofed `Content-Type` or oversized payload
 * cannot reach disk. Invalid files reject with a client-safe message.
 */
export async function saveMerchantLogo(file: File): Promise<string> {
  const validation = await validateImageFile(file, MAX_LOGO_SIZE);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  // Sanitize the original filename to avoid path traversal / weird characters,
  // and force the extension to match the sniffed (trustworthy) type.
  const safeName = safeFileName(file.name, 50);
  const filename = `${Date.now()}-${safeName}.${validation.ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  return `/uploads/merchants/${filename}`;
}
