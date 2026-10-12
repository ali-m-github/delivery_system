import { NextResponse } from "next/server";
import path from "path";
import { requireServerPermission } from "@/lib/server-permissions";
import { getOcrPoolStats } from "@/lib/ocr";
import {
  processWaybillFile,
  WAYBILL_UPLOAD_DIR,
  ocrSpaceBlackoutUntil,
  ocrSpaceRetryAfterSeconds,
  type WaybillResult,
} from "@/lib/waybill-ocr";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// Files per request. The client sends one at a time; this bounds the batch a
// single request can carry (CPU/memory DoS guard).
const MAX_WAYBILL_BATCH_COUNT = 10;

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

    const uploadDir = path.join(process.cwd(), WAYBILL_UPLOAD_DIR);

    const results: WaybillResult[] = [];
    for (const file of files) {
      // The extraction pipeline lives in lib/waybill-ocr.ts so the bulk folder
      // importer (scripts/import-waybills-from-folder.ts) runs identical logic.
      results.push(await processWaybillFile(file, { uploadDir }));
    }

    // If every file failed to match an order, surface a clear 404 — but keep
    // the per-file diagnostics, since that is what makes the failure fixable.
    const allNotFound =
      results.length > 0 &&
      results.every((r) => r.code === "not_in_db" || r.code === "no_digits" || r.code === "no_text");
    if (allNotFound) {
      return NextResponse.json(
        {
          error: "No matching Order ID found in database.",
          results,
        },
        { status: 404 },
      );
    }

    // Every failure was caused by the external fallback's quota, not by the
    // images: a 429 with a Retry-After is the honest signal, and re-uploading
    // later is the only fix.
    const allQuota =
      results.length > 0 && results.every((r) => r.code === "fallback_rate_limited");
    if (allQuota) {
      return NextResponse.json(
        {
          error: "OCR fallback quota exhausted. Re-upload these files later.",
          retryAfterSeconds: ocrSpaceRetryAfterSeconds(),
          results,
        },
        { status: 429 },
      );
    }

    // If some succeeded, return 200 with per-file results
    return NextResponse.json(
      {
        results,
        // Lets the client warn about a burned quota even on a partial success.
        ocrSpaceRateLimitedUntil: ocrSpaceBlackoutUntil(),
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/orders/waybill] Error:", message);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// ─── GET /api/orders/waybill ────────────────────────────────────────────────
// Lightweight OCR-engine diagnostics, so a long batch can be checked from the
// browser without reading server logs: are the Tesseract workers warm, is
// anything queued behind them, and is the OCR.space quota burned?
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "ORDERS_VIEW");
  if (auth instanceof Response) return auth;

  try {
    const pool = await getOcrPoolStats();
    return NextResponse.json({
      status: "ok",
      ocrPool: pool,
      ocrSpaceConfigured: Boolean(process.env.OCR_SPACE_API_KEY),
      // Non-null while the free-tier quota is exhausted: tells you why the
      // fallback stopped running without digging through logs.
      ocrSpaceRateLimitedUntil: ocrSpaceBlackoutUntil(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /api/orders/waybill] Error:", message);
    return NextResponse.json(
      { status: "error", error: "Could not read OCR pool state" },
      { status: 500 },
    );
  }
}
