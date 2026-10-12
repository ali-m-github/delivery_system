// ─── Waybill OCR extraction pipeline ─────────────────────────────────────────
//
// Turns a waybill photo into the order it belongs to, then attaches the image
// to that order. This is the single implementation behind:
//   • POST /api/orders/waybill  (the "Upload Waybill" button)
//   • scripts/import-waybills-from-folder.ts (bulk import from a server folder)
//
// Keeping one copy matters: the button and the bulk importer must agree on
// preprocessing, rotation order, DB matching and failure classification, or a
// file would succeed through one path and fail through the other.
//
// Pipeline, in order:
//   1. Validate magic bytes + size (fail fast, before any CPU work).
//   2. Decode the QR code printed on the waybill. It carries the order ID
//      verbatim, so this settles the large majority of files in milliseconds.
//   3. Rotational OCR with sharp preprocessing — 0° first (most photos are
//      upright), then 90/180/270 concurrently across the shared worker pool.
//   4. Probe the extracted candidates against Order.orderId.
//   5. OCR.space fallback, only if local OCR found nothing usable.
//   6. Persist the image under public/uploads/waybills and set order.waybillUrl.

// Relative (not "@/…") imports on purpose: this module is loaded both by the
// Next.js route and by a ts-node script, and plain ts-node does not resolve
// the tsconfig path alias.
import prisma from "./prisma";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { validateImageFile, safeFileName } from "./uploads";
import { getOcrScheduler } from "./ocr";

// ─── Candidate extraction ───────────────────────────────────────────────────
// Order IDs in this system are NOT all 7 digits. Real values in the orders
// table include 6, 7, 8 and 9-digit numbers, hyphenated pairs like
// "5219-2299", and an "R" suffix on returned-to-sender orders (see
// lib/order-id.ts). A fixed-width `\d{7}` therefore silently discards a large
// share of valid IDs — which is why a bulk upload can report hundreds of
// "failures" that are really a matching bug, not bad photos.
//
// So: pull every plausible token out of the text, then let the database decide
// which one is real (see findOrderByIdentifier). The lookbehind/lookahead keep
// a longer digit run from being chopped into a shorter one.
// The alternation is ordered longest-first so a hyphenated ID is not split into
// its two halves, and the optional trailing letter covers the RTS suffix.
export const CANDIDATE_RE =
  /(?<![\dA-Za-z])(?:\d{4,}(?:-\d{2,})?[A-Za-z]?|\d{1,4}-\d{4,}[A-Za-z]?)(?![\dA-Za-z])/g;

/** Pull order-ID-shaped candidates out of OCR text, longest first. */
export function extractCandidates(text: string): string[] {
  const found = text.match(CANDIDATE_RE) ?? [];
  // Longest first: an 8-digit ID should be probed before a substring of it.
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

// Rotations attempted per image, in order. 0° first: most waybill photos are
// already upright, so the common case exits after a single OCR pass.
export const OCR_ROTATIONS = [0, 90, 180, 270] as const;

// ─── Upload / OCR budget limits ─────────────────────────────────────────────
// Enforced BEFORE any expensive OCR work so a bad/oversized file fails fast.
export const MAX_WAYBILL_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (OCR.space fallback needs ≤ 1 MB; sharp can still process up to 10 MB)
// Cap total OCR match candidates we'll probe against the DB per file, to
// bound the per-file DB fan-out on noisy OCR output.
const MAX_OCR_MATCHES_TO_TRY = 10;
// How many candidate numbers we echo back for the failure report.
const MAX_REPORTED_CANDIDATES = 6;

/** Where waybill images are stored, relative to the project root. */
export const WAYBILL_UPLOAD_DIR = path.join(
  "public",
  "uploads",
  "waybills",
);

/**
 * Machine-readable reason for a failed extraction, so callers can group and
 * explain failures instead of showing one opaque string.
 */
export type WaybillFailureCode =
  | "invalid_file" // failed magic-byte / size validation
  | "ocr_error" // the engine itself threw on every attempt
  | "no_text" // OCR ran but read nothing at all (blurry / cropped / QR-only)
  | "no_digits" // text was read but contained no order-ID-shaped token
  | "not_in_db" // tokens were read but none match an existing order
  | "fallback_error" // OCR.space call itself failed
  | "fallback_rate_limited"; // OCR.space quota exhausted (free tier: 180 req/hour)

export interface WaybillResult {
  fileName: string;
  success: boolean;
  orderId?: string;
  waybillUrl?: string;
  method?: string;
  error?: string;
  /** Structured failure reason (present only when `success` is false). */
  code?: WaybillFailureCode;
  /** Identifiers the OCR/QR actually read — the key to debugging a miss. */
  candidates?: string[];
  /** OCR passes actually executed (rotations + fallback). */
  attempts?: number;
  /** Wall-clock ms spent on this file, for spotting slow images. */
  elapsedMs?: number;
  /** Set when `dryRun` was requested: extraction worked, nothing was written. */
  dryRun?: boolean;
}

/** Order shape as read by the waybill lookup (id + merchant reference data). */
interface WaybillOrderRef {
  id: string;
  orderId: string;
  merchant: { merchantName: string | null; logoUrl: string | null } | null;
}

// ─── OCR.space quota guard ───────────────────────────────────────────────────
// The free tier allows only 180 requests per hour. Once one call comes back
// rate-limited, every further call in that window is guaranteed to fail too —
// so we stop calling and record the deadline. Without this, a 700-file batch
// would spend hundreds of round-trips on calls that can only return 429.
let ocrSpaceDisabledUntil = 0;
let ocrSpaceRetryAfterMs = 0;

/** True while OCR.space is known to be unavailable (quota exhausted). */
function ocrSpaceRateLimited(): boolean {
  return Date.now() < ocrSpaceDisabledUntil;
}

/** ISO deadline for the current OCR.space blackout, or null when available. */
export function ocrSpaceBlackoutUntil(): string | null {
  return ocrSpaceRateLimited()
    ? new Date(ocrSpaceDisabledUntil).toISOString()
    : null;
}

/**
 * Decode the QR code printed on the waybill, if one is readable.
 *
 * This is the most reliable extraction path available: the QR encodes the order
 * ID verbatim, whereas the printed number is small, frequently rotated, and sits
 * beside Arabic text that Tesseract reads badly. Decoding costs tens of
 * milliseconds; the OCR fallback costs seconds and, when it fails, a
 * rate-limited third-party call.
 *
 * Returns the raw payload (not validated), or null when nothing decodes.
 * Attempts a small ladder of rescales and rotations: WhatsApp exports can shrink
 * a QR below jsQR's minimum module size, and photos are shot at arbitrary
 * angles. Measured on a 783-image batch, 1x/2x alone decoded 51% of files;
 * adding the rotations raised that to 55%.
 */
async function decodeWaybillQr(fileBuffer: Buffer): Promise<string | null> {
  const sharp = (await import("sharp")).default;
  const jsQR = (await import("jsqr")).default;

  const meta = await sharp(fileBuffer, { failOn: "none" }).metadata();
  const baseWidth = meta.width ?? 0;
  if (baseWidth === 0) return null;

  // Cheap and most likely first. Upscaling only helps small images; on a large
  // photo it just costs memory, so it is skipped past a certain width.
  const rotations = OCR_ROTATIONS.slice(1).map((rotate) => ({
    scale: 1 as number,
    rotate: rotate as number,
  }));
  const attempts: Array<{ scale: number; rotate: number }> =
    baseWidth >= 1600
      ? [{ scale: 1, rotate: 0 }, ...rotations]
      : [{ scale: 1, rotate: 0 }, { scale: 2, rotate: 0 }, ...rotations];

  for (const attempt of attempts) {
    try {
      const { data, info } = await sharp(fileBuffer, { failOn: "none" })
        .resize({ width: baseWidth * attempt.scale })
        .rotate(attempt.rotate)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // jsQR requires RGBA; expand the single-channel output.
      const rgba = new Uint8ClampedArray(info.width * info.height * 4);
      for (let i = 0; i < info.width * info.height; i++) {
        const v = data[i];
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }

      const code = jsQR(rgba, info.width, info.height, {
        inversionAttempts: "attemptBoth",
      });
      if (code?.data) {
        // Bounded preview: the payload is an order reference, not free text.
        console.log(
          `[waybill] QR decoded (${attempt.scale}x ${attempt.rotate}°) → ${code.data.slice(0, 40)}`,
        );
        return code.data;
      }
    } catch (error) {
      console.error(
        `[waybill] QR decode failed (${attempt.scale}x ${attempt.rotate}°):`,
        error,
      );
    }
  }
  return null;
}

/**
 * Resolve a QR payload straight to an order.
 *
 * The QR payload IS the order ID, so this is an exact lookup — no regex and no
 * candidate ranking, which is exactly why it beats OCR on reliability.
 */
async function findOrderByIdentifier(
  identifier: string,
): Promise<WaybillOrderRef | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const row = await prisma.order.findUnique({
    where: { orderId: trimmed },
    include: {
      merchant: { select: { merchantName: true, logoUrl: true } },
    },
  });
  return row ?? null;
}

/**
 * Probe a list of OCR-extracted candidates against the order table.
 * Returns `{ order, number }` on the first match, or `null` otherwise.
 * Capped at MAX_OCR_MATCHES_TO_TRY.
 *
 * One `findMany` instead of up to ten sequential `findUnique` calls: on a
 * noisy image the DB round-trips were a measurable part of the per-file cost,
 * and a single query keeps the ordering deterministic by probing in the
 * caller's candidate order afterwards.
 */
async function findMatchingOrder(
  matches: string[],
): Promise<{ order: WaybillOrderRef; number: string } | null> {
  const capped = Array.from(new Set(matches)).slice(0, MAX_OCR_MATCHES_TO_TRY);
  if (capped.length === 0) return null;

  const rows = await prisma.order.findMany({
    where: { orderId: { in: capped } },
    include: {
      merchant: { select: { merchantName: true, logoUrl: true } },
    },
  });
  if (rows.length === 0) return null;

  // Preserve the OCR's own candidate order rather than the DB's return order.
  const byId = new Map(rows.map((row) => [row.orderId, row]));
  const winner = capped.map((id) => byId.get(id)).find(Boolean);
  if (!winner) return null;
  return { order: winner, number: winner.orderId };
}

export interface ProcessWaybillOptions {
  /** Absolute path of the directory the image will be written to. */
  uploadDir: string;
  /**
   * Run the full extraction but write nothing: no image file, no DB update.
   * Lets a bulk import be previewed before it touches live orders.
   */
  dryRun?: boolean;
}

/**
 * Extract the order number from one waybill image and attach the image to it.
 *
 * Never throws for per-file reasons — every failure is reported in the returned
 * `WaybillResult` with a `code`, so a batch can continue past one bad image.
 */
export async function processWaybillFile(
  file: File,
  options: ProcessWaybillOptions,
): Promise<WaybillResult> {
  const { uploadDir, dryRun = false } = options;

  const fileResult: WaybillResult = {
    fileName: file.name,
    success: false,
  };

  try {
    // ── Validate BEFORE the expensive OCR pipeline ──
    // Magic-byte sniffing + size cap. A spoofed Content-Type or an
    // oversized payload fails here, not inside sharp/Tesseract.
    const validation = await validateImageFile(file, MAX_WAYBILL_FILE_SIZE);
    if (!validation.ok) {
      fileResult.code = "invalid_file";
      fileResult.error = validation.error;
      return fileResult;
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const startedAt = Date.now();

    let extractedNumber: string | null = null;
    let foundOrder: WaybillOrderRef | null = null;
    let method: string | null = null;
    // Diagnostics shared by every extraction stage, for the failure report.
    const candidates = new Set<string>();
    let attempts = 0;
    let engineErrors = 0;
    let sawText = false;
    let fallbackError: string | null = null;
    let fallbackCode: WaybillFailureCode | null = null;

    // ── FAST PATH: the QR code printed on the waybill ──
    // Decode before reaching for OCR. The QR payload is the order ID itself, so
    // this settles most files in milliseconds and skips four OCR passes plus a
    // rate-limited API call.
    const qrPayload = await decodeWaybillQr(fileBuffer);
    if (qrPayload) {
      candidates.add(qrPayload.trim());
      const order = await findOrderByIdentifier(qrPayload);
      if (order) {
        extractedNumber = order.orderId;
        foundOrder = order;
        method = "QR code";
        console.log(`[waybill] QR match ${file.name} → ${order.orderId}`);
      }
    }

    // ── Brute-force rotational OCR pipeline (only if the QR did not resolve) ──
    if (!extractedNumber) {
    // Lazy-load the heavy deps: only needed at OCR time, and kept out of the
    // importing module's initial graph (faster dev compiles).
    const sharp = (await import("sharp")).default;

    // Reused Tesseract engines (see lib/ocr.ts). `Tesseract.recognize()` boots
    // a worker + WASM core + language model on EVERY call and discards them, so
    // a batch paid that startup cost once per rotation. The scheduler keeps the
    // engines warm and queues jobs across them.
    const ocr = await getOcrScheduler();

    // OCR one rotation and probe it. Shared by the fast path below and the
    // parallel sweep, so both accumulate identical diagnostics.
    const tryAngle = async (
      angle: number,
    ): Promise<{ order: WaybillOrderRef; number: string } | null> => {
      try {
        // 1. Physically rotate and preprocess the image
        const processedBuffer = await sharp(fileBuffer)
          .rotate(angle)
          .grayscale() // Enhance contrast for OCR
          .threshold(150) // Forces pure black/white, destroying glare
          .normalize()
          .toBuffer();

        // 2. Run OCR on the corrected orientation, on a warm engine.
        // The scheduler appends its own jobId, so the output format must be
        // passed explicitly (the third positional arg) to get `data.text`.
        attempts++;
        const {
          data: { text },
        } = await ocr.addJob("recognize", processedBuffer, {}, { text: true });

        // Log a bounded, non-sensitive preview (no full OCR text).
        console.log(`[waybill] OCR at ${angle}° produced ${text.length} chars`);
        if (text.trim().length > 0) sawText = true;

        // 3. Pull every order-ID-shaped token out of the text block.
        const matches = extractCandidates(text);
        for (const m of matches) candidates.add(m);
        console.log(`[waybill] Angle ${angle} matches: ${matches.length}`);

        // 4. Probe candidates against the DB (capped).
        return await findMatchingOrder(matches);
      } catch (error) {
        engineErrors++;
        console.error(`[waybill] OCR failed at angle ${angle}:`, error);
        return null;
      }
    };

      // Fast path: 0° alone. Most waybill photos are already upright, and
      // bailing here skips three whole OCR passes.
      const upright = await tryAngle(OCR_ROTATIONS[0]);
      if (upright) {
        extractedNumber = upright.number;
        foundOrder = upright.order;
        method = "Rotational OCR (0°)";
      } else {
        // Slow path: sweep the remaining rotations concurrently. The pool has
        // more than one engine, so these run in parallel rather than back to
        // back — measured ~13% faster per file with identical results.
        const sweep = await Promise.all(
          OCR_ROTATIONS.slice(1).map(async (angle) => {
            const found = await tryAngle(angle);
            return found ? { angle, ...found } : null;
          }),
        );
        const hit = sweep.find(Boolean);
        if (hit) {
          extractedNumber = hit.number;
          foundOrder = hit.order;
          method = `Rotational OCR (${hit.angle}°)`;
          console.log(
            `[waybill] Extraction succeeded at ${hit.angle}° → ${hit.number}`,
          );
        }
      }
    }

    // ── FALLBACK: OCR.space API (only when the file is within its 1 MB
    // free-tier limit; otherwise we skip it rather than failing the upload).
    if (!extractedNumber) {
      if (file.size > 1048576) {
        console.log(
          `[waybill] Skipping OCR.space fallback: file exceeds 1 MB free-tier limit`,
        );
      } else if (ocrSpaceRateLimited()) {
        // Quota already burned by an earlier file in this same batch.
        fallbackCode = "fallback_rate_limited";
        console.log(
          `[waybill] Skipping OCR.space fallback: rate-limited, retry in ${Math.ceil(
            (ocrSpaceDisabledUntil - Date.now()) / 1000,
          )}s`,
        );
      } else {
        try {
          console.log(`[waybill] Tesseract failed. Falling back to OCR.space...`);
          attempts++;

          const base64Image = `data:${validation.mime};base64,${fileBuffer.toString("base64")}`;

          const form = new FormData();
          form.append("base64Image", base64Image);
          form.append("OCREngine", "2");

          const response = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: {
              apikey: process.env.OCR_SPACE_API_KEY || "",
            },
            body: form,
          });

          // A 429 (quota) is not a parse error and must not be mistaken for
          // "the image had no text" — it means the fallback never ran.
          if (response.status === 429) {
            const errBody = await response.json().catch(() => null);
            const retryAfterSec = Number(errBody?.retryAfter) || 3600;
            ocrSpaceRetryAfterMs = retryAfterSec * 1000;
            ocrSpaceDisabledUntil = Date.now() + ocrSpaceRetryAfterMs;
            fallbackCode = "fallback_rate_limited";
            console.warn(
              `[waybill] OCR.space rate limited; disabling fallback for ${retryAfterSec}s`,
            );
          } else {
            const result = await response.json();

            if (result.IsErroredOnProcessing) {
              // Log the vendor error server-side; don't echo it to the client.
              console.error(
                `[waybill] OCR.space processing error:`,
                result.ErrorMessage,
              );
              throw new Error("OCR.space processing error");
            }

            const text = result.ParsedResults?.[0]?.ParsedText || "";
            if (text.trim().length > 0) sawText = true;
            const matches = extractCandidates(text);
            for (const m of matches) candidates.add(m);
            console.log(`[waybill] OCR.space matches: ${matches.length}`);

            const found = await findMatchingOrder(matches);
            if (found) {
              extractedNumber = found.number;
              foundOrder = found.order;
              method = "OCR.space fallback";
            }
          }
        } catch (error: unknown) {
          console.error(`[waybill] OCR.space API error:`, error);
          fallbackCode = "fallback_error";
          fallbackError =
            error instanceof Error ? error.message : "unknown error";
        }
      }
    }

    // ── FAILURE REPORT — say WHY, not just "it failed".
    if (!extractedNumber || !foundOrder) {
      const candidateList = Array.from(candidates).slice(
        0,
        MAX_REPORTED_CANDIDATES,
      );
      fileResult.candidates = candidateList;
      fileResult.attempts = attempts;
      fileResult.elapsedMs = Date.now() - startedAt;

      // Most-actionable-reason first. Digits that were actually read beat
      // any engine/quota note, because the operator can act on them.
      if (candidates.size > 0) {
        fileResult.code = "not_in_db";
        fileResult.error = `Read ${candidates.size} number${
          candidates.size === 1 ? "" : "s"
        } (${candidateList.join(", ")}) — none match an existing order`;
      } else if (fallbackCode === "fallback_rate_limited") {
        // Nothing readable locally AND the external fallback is out of
        // quota: that is the blocker, not the photo.
        fileResult.code = "fallback_rate_limited";
        fileResult.error = `Local OCR could not read this image and the OCR.space fallback is out of quota (free tier: 180 requests/hour) — retry in ~${Math.max(
          1,
          Math.round((ocrSpaceDisabledUntil - Date.now()) / 60000),
        )} min`;
      } else if (attempts === 0 || (engineErrors === attempts && !sawText)) {
        fileResult.code = "ocr_error";
        fileResult.error = "OCR engine could not process this image";
      } else {
        fileResult.code = sawText ? "no_digits" : "no_text";
        fileResult.error = sawText
          ? "Read text, but no order number was present in it"
          : "No readable text found (too blurry, cropped, or QR-only)";
      }

      // A fallback that itself errored is worth surfacing alongside the
      // extraction reason, but it does not change the classification.
      if (fallbackCode === "fallback_error" && fileResult.code === "ocr_error") {
        fileResult.code = "fallback_error";
        fileResult.error = `Local OCR failed and the OCR.space fallback errored (${fallbackError})`;
      }

      console.log(
        `[waybill] FAILED ${file.name} → ${fileResult.code} in ${fileResult.elapsedMs}ms`,
      );
      return fileResult;
    }

    const orderNumber = extractedNumber;
    const order = foundOrder;

    if (dryRun) {
      // Preview mode: report what WOULD happen, without touching disk or DB.
      fileResult.success = true;
      fileResult.dryRun = true;
      fileResult.orderId = orderNumber;
      fileResult.method = method ?? "Rotational OCR";
      fileResult.attempts = attempts;
      fileResult.elapsedMs = Date.now() - startedAt;
      console.log(
        `[waybill] DRY-RUN ${file.name} → ${orderNumber} via ${fileResult.method}`,
      );
      return fileResult;
    }

    // ── Save image to local storage ──
    // Use the sanitized name + the sniffed (trustworthy) extension.
    await mkdir(uploadDir, { recursive: true });
    const filename = `${Date.now()}-${safeFileName(file.name, 50)}.${validation.ext}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, fileBuffer);

    const waybillUrl = `/uploads/waybills/${filename}`;

    // ── Update order record ──
    await prisma.order.update({
      where: { id: order.id },
      data: { waybillUrl },
    });

    fileResult.success = true;
    fileResult.orderId = orderNumber;
    fileResult.waybillUrl = waybillUrl;
    fileResult.method = method ?? "Rotational OCR";
    fileResult.attempts = attempts;
    fileResult.elapsedMs = Date.now() - startedAt;
    console.log(
      `[waybill] OK ${file.name} → ${orderNumber} via ${fileResult.method} in ${fileResult.elapsedMs}ms`,
    );
    return fileResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal processing error";
    console.error("[waybill] Processing error for", file.name, message);
    // Never echo raw exception detail to the caller.
    fileResult.code = "ocr_error";
    fileResult.error = "Could not process this image";
    return fileResult;
  }
}

/** Seconds until the OCR.space quota window resets (0 when not rate-limited). */
export function ocrSpaceRetryAfterSeconds(): number {
  return ocrSpaceRateLimited()
    ? Math.max(1, Math.round(ocrSpaceRetryAfterMs / 1000))
    : 0;
}
