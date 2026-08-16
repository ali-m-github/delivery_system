import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── PATCH /api/merchant/orders/import-sheet/config ───────────────────────────
// Saves/overwrites the merchant's Google Sheets import template (startRow +
// colMapping) so the seller can re-import with the same column mapping later.
// The target merchant is resolved from the session — never trusted from the body.
export async function PATCH(request: Request) {
  try {
    // ── Authenticate via session cookie ──────────────────────────────────
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    let payload: { id: string; role: string };
    try {
      const verified = await jwtVerify(token, secret);
      payload = verified.payload as { id: string; role: string };
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    if (payload.role !== "MERCHANT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { userId: payload.id },
      select: { id: true },
    });

    if (!merchant) {
      return NextResponse.json(
        { error: "No merchant profile linked to your account" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const sheetImportConfig = body.sheetImportConfig;

    if (!sheetImportConfig || typeof sheetImportConfig !== "object") {
      return NextResponse.json(
        { error: "Missing 'sheetImportConfig' parameter." },
        { status: 400 },
      );
    }

    // Only persist the fields the merchant is allowed to control.
    const safeConfig = {
      startRow:
        typeof sheetImportConfig.startRow === "number"
          ? sheetImportConfig.startRow
          : 1,
      colMapping:
        sheetImportConfig.colMapping &&
        typeof sheetImportConfig.colMapping === "object"
          ? sheetImportConfig.colMapping
          : undefined,
    };

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { sheetImportConfig: safeConfig },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error(
      "[PATCH /api/merchant/orders/import-sheet/config] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message || String(error) },
      { status: 500 },
    );
  }
}
