import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { requireServerPermission } from "@/lib/server-permissions";
import { validateImageFile, safeFileName } from "@/lib/uploads";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// ─── Regex for 7-digit order number ─────────────────────────────────────────
// Find exactly 7 digits, ignoring attached non-digit characters
const SEVEN_DIGIT_RE = /(?<!\d)\d{7}(?!\d)/g;

// ─── Upload / OCR budget limits ─────────────────────────────────────────────
// Enforced BEFORE any expensive OCR work so a bad/oversized file fails fast.
const MAX_WAYBILL_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (OCR.space fallback needs ≤ 1 MB; sharp can still process up to 10 MB)
const MAX_WAYBILL_BATCH_COUNT = 10; // files per request
// Cap total OCR match candidates we'll probe against the DB per file, to
// bound the per-file DB fan-out on noisy OCR output.
const MAX_OCR_MATCHES_TO_TRY = 10;

interface WaybillResult {
  fileName: string;
  success: boolean;
  orderId?: string;
  waybillUrl?: string;
  method?: string;
  error?: string;
}

/** Order shape as read by the waybill lookup (id + merchant reference data). */
interface WaybillOrderRef {
  id: string;
  orderId: string;
  merchant: { merchantName: string | null; logoUrl: string | null } | null;
}

/**
 * Probe a list of OCR-extracted candidates against the order table.
 * Returns `{ order, number, matches }` on the first match, or
 * `null` otherwise. Capped at MAX_OCR_MATCHES_TO_TRY.
 */
async function findMatchingOrder(
  matches: string[],
): Promise<{ order: WaybillOrderRef; number: string } | null> {
  const capped = matches.slice(0, MAX_OCR_MATCHES_TO_TRY);
  for (const match of capped) {
    const order = await prisma.order.findUnique({
      where: { orderId: match },
      include: {
        merchant: { select: { merchantName: true, logoUrl: true } },
      },
    });
    if (order) {
      return { order, number: match };
    }
  }
  return null;
}

// ─── POST /api/orders/waybill ───────────────────────────────────────────────
export async function POST(request: Request) {
  // Waybill OCR extraction links images to live orders — staff-only action.
  const auth = await requireServerPermission(request, "ORDERS_EDIT");
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    // Accept both singular "file" (sequential client) and plural "files" (batch client)
    let files = formData.getAll("files") as File[];
    if (!files || files.length === 0) {
      files = formData.getAll("file") as File[];
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Limit the batch count BEFORE doing any work (CPU/memory DoS guard).
    if (files.length > MAX_WAYBILL_BATCH_COUNT) {
      return NextResponse.json(
        { error: `Too many files (max ${MAX_WAYBILL_BATCH_COUNT} per request)` },
        { status: 400 },
      );
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "waybills");
    await mkdir(uploadDir, { recursive: true });

    const results: WaybillResult[] = [];

    // Lazy-load the heavy OCR/image deps: only requested at OCR time, and
    // kept out of this route's initial module graph (faster dev compiles).
    const sharp = (await import("sharp")).default;
    const Tesseract = (await import("tesseract.js")).default;

    for (const file of files) {
      const fileResult: WaybillResult = {
        fileName: file.name,
        success: false,
      };

      try {
        // ── Validate BEFORE the expensive OCR pipeline ──
        // Magic-byte sniffing + size cap. A spoofed Content-Type or an
        // oversized payload fails here, not inside sharp/Tesseract.
        const validation = await validateImageFile(
          file,
          MAX_WAYBILL_FILE_SIZE,
        );
        if (!validation.ok) {
          fileResult.error = validation.error;
          results.push(fileResult);
          continue;
        }

        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // ── Brute-force rotational OCR pipeline ──
        let extractedNumber: string | null = null;
        let foundOrder: WaybillOrderRef | null = null;
        const angles = [0, 90, 180, 270];

        for (const angle of angles) {
          try {
            // 1. Physically rotate and preprocess the image
            const processedBuffer = await sharp(fileBuffer)
              .rotate(angle)
              .grayscale() // Enhance contrast for OCR
              .threshold(150) // Forces pure black/white, destroying glare
              .normalize()
              .toBuffer();

            // 2. Run OCR on the corrected orientation
            const {
              data: { text },
            } = await Tesseract.recognize(processedBuffer, "eng", {
              logger: () => {}, // suppress progress logs
            });

            // Log a bounded, non-sensitive preview (no full OCR text).
            console.log(
              `[waybill] OCR at ${angle}° produced ${text.length} chars`,
            );

            // 3. Use /g to find ALL 7-digit numbers in the text block
            const matches = text.match(SEVEN_DIGIT_RE) || [];
            console.log(`[waybill] Angle ${angle} matches: ${matches.length}`);

            // 4. Probe candidates against the DB (capped).
            const found = await findMatchingOrder(matches);
            if (found) {
              extractedNumber = found.number;
              foundOrder = found.order;
              console.log(
                `[waybill] Extraction succeeded at ${angle}° → ${extractedNumber}`,
              );
              break; // Break the rotation loop since we found a valid database entry
            }
          } catch (error) {
            console.error(`[waybill] OCR failed at angle ${angle}:`, error);
          }
        }

        // 3. FALLBACK: OCR.space API (only when the file is within its 1 MB
        // free-tier limit; otherwise we skip it rather than failing the upload).
        if (!extractedNumber) {
          if (file.size <= 1048576) {
            try {
              console.log(
                `[waybill] Tesseract failed. Falling back to OCR.space...`,
              );

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
              const matches = text.match(/(?<!\d)\d{7}(?!\d)/g) || [];
              console.log(`[waybill] OCR.space matches: ${matches.length}`);

              const found = await findMatchingOrder(matches);
              if (found) {
                extractedNumber = found.number;
                foundOrder = found.order;
              }
            } catch (error: unknown) {
              console.error(`[waybill] OCR.space API error:`, error);
              fileResult.error = "OCR fallback failed";
              results.push(fileResult);
              continue; // Do NOT abort the whole batch over one file's fallback.
            }
          } else {
            console.log(
              `[waybill] Skipping OCR.space fallback: file exceeds 1 MB free-tier limit`,
            );
          }
        }

        // 4. FINAL FAILURE CHECK
        if (!extractedNumber || !foundOrder) {
          fileResult.error =
            "Could not extract a valid, matching order number from this image.";
          results.push(fileResult);
          continue;
        }

        const orderNumber = extractedNumber;
        const order = foundOrder;
        const method = "Brute-force rotational OCR";

        // ── Save image to local storage ──
        // Use the sanitized name + the sniffed (trustworthy) extension.
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
        fileResult.method = method;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Internal processing error";
        console.error("[waybill] Processing error for", file.name, message);
        // Never echo raw exception detail to the client.
        fileResult.error = "Could not process this image";
      }

      results.push(fileResult);
    }

    // If all files failed to find a matching order, surface a clear 404.
    const allNotFound =
      results.length > 0 &&
      results.every(
        (r) => r.error === "Could not extract a valid, matching order number from this image.",
      );
    if (allNotFound) {
      return NextResponse.json(
        {
          error: "No matching Order ID found in database.",
          results,
        },
        { status: 404 },
      );
    }

    // If some succeeded, return 200 with per-file results
    return NextResponse.json({ results }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/orders/waybill] Error:", message);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
