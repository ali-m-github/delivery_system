import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import jsQR from "jsqr";
import Tesseract from "tesseract.js";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

// ─── Regex for 7-digit order number ─────────────────────────────────────────
const SEVEN_DIGIT_RE = /\b\d{7}\b/;

// ─── Pass 1: Barcode scanning via sharp + jsQR ──────────────────────────────
async function scanBarcode(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const clamped = new Uint8ClampedArray(data);
    const result = jsQR(clamped, info.width, info.height);

    if (result?.data) {
      console.log("[waybill] Barcode detected:", result.data);
      return result.data.trim();
    }
    return null;
  } catch (err: any) {
    console.warn("[waybill] Barcode scan error:", err.message);
    return null;
  }
}

// ─── Pass 2: OCR via tesseract.js + regex ───────────────────────────────────
async function scanOcr(buffer: Buffer): Promise<string | null> {
  try {
    const {
      data: { text },
    } = await Tesseract.recognize(buffer, "eng", {
      logger: () => {}, // suppress progress logs
    });

    console.log("[waybill] OCR text:", text.substring(0, 200));
    const match = text.match(SEVEN_DIGIT_RE);
    if (match) {
      console.log("[waybill] OCR matched:", match[0]);
      return match[0];
    }
    return null;
  } catch (err: any) {
    console.warn("[waybill] OCR error:", err.message);
    return null;
  }
}

// ─── Extract order number: barcode first, then OCR ──────────────────────────
async function extractOrderNumber(buffer: Buffer): Promise<string | null> {
  // Pass 1: Barcode
  const barcodeResult = await scanBarcode(buffer);
  if (barcodeResult) {
    // Validate it looks like a 7-digit number
    const match = barcodeResult.match(SEVEN_DIGIT_RE);
    if (match) return match[0];
    // If barcode returned something but not 7 digits, try it as-is (could be a
    // different format matching orderId)
    return barcodeResult;
  }

  // Pass 2: OCR
  const ocrResult = await scanOcr(buffer);
  return ocrResult;
}

// ─── POST /api/orders/waybill ───────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "waybills");
    await mkdir(uploadDir, { recursive: true });

    const results: Array<{
      fileName: string;
      success: boolean;
      orderId?: string;
      waybillUrl?: string;
      error?: string;
    }> = [];

    for (const file of files) {
      const fileResult: (typeof results)[number] = {
        fileName: file.name,
        success: false,
      };

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // ── Two-pass extraction ──
        const extractedNumber = await extractOrderNumber(buffer);

        if (!extractedNumber) {
          fileResult.error =
            "Could not extract an order number from this image.";
          results.push(fileResult);
          continue;
        }

        // ── Query database ──
        const order = await prisma.order.findUnique({
          where: { orderId: extractedNumber },
        });

        if (!order) {
          fileResult.error = "Error: No matching Order ID found in database.";
          results.push(fileResult);
          continue;
        }

        // ── Save image to local storage ──
        const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const filePath = path.join(uploadDir, filename);
        await writeFile(filePath, buffer);

        const waybillUrl = `/uploads/waybills/${filename}`;

        // ── Update order record ──
        await prisma.order.update({
          where: { id: order.id },
          data: { waybillUrl },
        });

        fileResult.success = true;
        fileResult.orderId = extractedNumber;
        fileResult.waybillUrl = waybillUrl;
      } catch (err: any) {
        console.error("[waybill] Processing error for", file.name, err.message);
        fileResult.error = err.message || "Internal processing error";
      }

      results.push(fileResult);
    }

    // If all files failed due to "no matching order", return 404
    const allNotFound = results.every(
      (r) => r.error === "Error: No matching Order ID found in database.",
    );
    if (allNotFound && results.length > 0) {
      return NextResponse.json(
        {
          error: "Error: No matching Order ID found in database.",
          results,
        },
        { status: 404 },
      );
    }

    // If some succeeded, return 200 with per-file results
    return NextResponse.json({ results }, { status: 200 });
  } catch (error: any) {
    console.error("[POST /api/orders/waybill] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
