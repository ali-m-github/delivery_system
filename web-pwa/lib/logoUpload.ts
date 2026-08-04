import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Directory (relative to the project root) where merchant logo files are stored.
 * Files under `public/` are served at the base URL (e.g. `/uploads/merchants/...`).
 */
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "merchants");

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
 */
export async function saveMerchantLogo(file: File): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  // Sanitize the original filename to avoid path traversal / weird characters.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-50);
  const filename = `${Date.now()}-${safeName || "logo"}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  return `/uploads/merchants/${filename}`;
}
