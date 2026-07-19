import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

// ─── Regex for 7-digit order number ─────────────────────────────────────────
// Find exactly 7 digits, ignoring attached non-digit characters
const SEVEN_DIGIT_RE = /(?<!\d)\d{7}(?!\d)/g;

// ─── POST /api/orders/waybill ───────────────────────────────────────────────
export async function POST(request: Request) {
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

    const uploadDir = path.join(process.cwd(), "public", "uploads", "waybills");
    await mkdir(uploadDir, { recursive: true });

    const results: Array<{
      fileName: string;
      success: boolean;
      orderId?: string;
      waybillUrl?: string;
      method?: string;
      error?: string;
    }> = [];

    for (const file of files) {
      const fileResult: (typeof results)[number] = {
        fileName: file.name,
        success: false,
      };

      try {
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // ── Brute-force rotational OCR pipeline ──
        let extractedNumber: string | null = null;
        let foundOrder: any = null;
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

            console.log(`[waybill] OCR at ${angle}°:`, text.substring(0, 200));

            // 3. Use /g to find ALL 7-digit numbers in the text block
            const matches = text.match(SEVEN_DIGIT_RE) || [];
            console.log(`[waybill] Angle ${angle} Matches:`, matches);

            // 4. Test every single match against the database
            for (const match of matches) {
              const order = await prisma.order.findUnique({
                where: { orderId: match },
              });

              // 5. Only lock in the number if the database confirms it exists
              if (order) {
                extractedNumber = match;
                foundOrder = order;
                console.log(
                  `[waybill] Extraction succeeded at ${angle}° → ${extractedNumber}`,
                );
                break; // Break the matches loop
              }
            }

            if (extractedNumber) {
              break; // Break the rotation loop since we found a valid database entry
            }
          } catch (error) {
            console.error(`[waybill] OCR failed at angle ${angle}:`, error);
          }
        }

        // 3. FALLBACK: OCR.space API
        if (!extractedNumber) {
          try {
            console.log(
              `[waybill] Tesseract failed. Falling back to OCR.space...`,
            );

            // Ensure the file meets the free tier 1 MB limit
            if (file.size > 1048576) {
              throw new Error(
                "File exceeds 1 MB limit for OCR.space free tier.",
              );
            }

            const base64Data = fileBuffer.toString("base64");
            const base64Image = `data:image/jpeg;base64,${base64Data}`;

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
              throw new Error(result.ErrorMessage[0]);
            }

            const text = result.ParsedResults?.[0]?.ParsedText || "";
            const matches = text.match(/(?<!\d)\d{7}(?!\d)/g) || [];
            console.log(`[waybill] OCR.space Matches:`, matches);

            for (const match of matches) {
              const orderExists = await prisma.order.findUnique({
                where: { orderId: match },
              });

              if (orderExists) {
                extractedNumber = match;
                foundOrder = orderExists;
                break;
              }
            }
          } catch (error: any) {
            console.error(`[waybill] OCR.space API error:`, error);
            return new Response(`OCR.space API Error: ${error.message}`, {
              status: 500,
            });
          }
        }

        // 4. FINAL FAILURE CHECK
        if (!extractedNumber) {
          return new Response(
            "Could not extract a valid, matching order number from this image.",
            { status: 400 },
          );
        }

        const orderNumber = extractedNumber;
        const order = foundOrder;
        const method = "Brute-force rotational OCR";

        // ── Save image to local storage ──
        const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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
