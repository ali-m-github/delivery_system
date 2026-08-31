import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerRole } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// ─── PATCH /api/merchant/orders/import-sheet/config ───────────────────────────
// Saves/overwrites the merchant's Google Sheets import template (startRow +
// colMapping) so the seller can re-import with the same column mapping later.
// The target merchant is resolved from the session — never trusted from the body.
export async function PATCH(request: Request) {
  try {
    // ── Authenticate via session cookie ──────────────────────────────────
    // The role is re-read from the database (not the stale 24-hour token
    // claim) so a role change takes effect immediately.
    const auth = await requireServerRole(request, "MERCHANT");
    if (auth instanceof Response) return auth;
    const user = auth.user;

    const merchant = await prisma.merchant.findUnique({
      where: { userId: user.id },
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
    console.error(
      "[PATCH /api/merchant/orders/import-sheet/config] Error:",
      error,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
