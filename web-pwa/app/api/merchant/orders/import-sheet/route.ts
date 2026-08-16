import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { PrismaClient } from "@prisma/client";
import Papa from "papaparse";

const prisma = new PrismaClient();

// ─── POST /api/merchant/orders/import-sheet ───────────────────────────────────
// Merchant-scoped Google Sheets CSV import. Unlike the admin endpoint, the
// merchant is resolved from the logged-in session (never trusted from the
// body), so a seller can only import orders into their OWN ledger.
// Expects JSON body: { url, merchantId, startRow?, colMapping?, receivedDate? }
export async function POST(request: Request) {
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

    // ── Resolve merchant profile from the session (never from the body) ──
    const merchant = await prisma.merchant.findUnique({
      where: { userId: payload.id },
    });

    if (!merchant) {
      return NextResponse.json(
        { error: "No merchant profile linked to your account" },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Cross-check: if the client sent a merchantId it must match the session
    // seller. This is defense-in-depth against a forged/duplicated request.
    if (body.merchantId != null) {
      const parsedId = parseInt(String(body.merchantId), 10);
      if (!isNaN(parsedId) && parsedId !== merchant.merchantId) {
        return NextResponse.json(
          {
            error:
              "Forbidden: you can only import orders for your own seller account.",
          },
          { status: 403 },
        );
      }
    }

    // ── Validate required fields ─────────────────────────────────────────
    const { url, receivedDate } = body;
    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'url' parameter." },
        { status: 400 },
      );
    }

    let customDate: Date;
    if (receivedDate && typeof receivedDate === "string") {
      const parsed = new Date(receivedDate + "T00:00:00Z");
      customDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      customDate = new Date();
    }

    const startRow: number =
      typeof body.startRow === "number" ? body.startRow : 1;

    const colMapping: Record<string, number> = body.colMapping || {
      orderId: 0,
      customerName: 1,
      phone: 2,
      address: 3,
      amountUsd: 4,
      packages: 5,
    };

    // ── Step 1: Parse Google Sheets URL ──────────────────────────────────
    const spreadsheetIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!spreadsheetIdMatch) {
      return NextResponse.json(
        {
          error: "Invalid Google Sheets URL. Could not extract spreadsheet ID.",
        },
        { status: 400 },
      );
    }
    const spreadsheetId = spreadsheetIdMatch[1];

    let gid = "0";
    const gidQueryMatch = url.match(/[?&]gid=(\d+)/);
    const gidHashMatch = url.match(/#gid=(\d+)/);
    if (gidQueryMatch) {
      gid = gidQueryMatch[1];
    } else if (gidHashMatch) {
      gid = gidHashMatch[1];
    }

    // ── Step 2: Fetch CSV from Google Sheets ─────────────────────────────
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    const csvResponse = await fetch(csvUrl);

    if (!csvResponse.ok) {
      return NextResponse.json(
        {
          error:
            "Unable to access spreadsheet. Please ensure the Google Sheet permission is set to 'Anyone with the link can view'.",
        },
        { status: 400 },
      );
    }

    const csvText = await csvResponse.text();
    const parseResult = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
    const parsedRows: string[][] = parseResult.data;

    const slicedRows = parsedRows.slice(startRow);

    const dataRows = slicedRows.filter((row) => {
      const rawTracking = String(row[colMapping.orderId] || "").trim();
      const rawPhone = String(row[colMapping.phone] || "").trim();

      if (!rawTracking && !rawPhone) return false;

      if (
        rawTracking.toLowerCase() === "tracking" ||
        rawPhone.toLowerCase() === "mobile"
      )
        return false;

      return true;
    });

    if (dataRows.length === 0) {
      return NextResponse.json(
        { error: "No data rows found after applying startRow offset." },
        { status: 400 },
      );
    }

    // ── Step 3: Resolve default zone (Zone 99, else explicit, else first) ─
    let defaultZoneId = body.zoneId;
    if (!defaultZoneId) {
      const zone99 = await prisma.zone.findFirst({
        where: { name: { contains: "99" } },
      });
      defaultZoneId = zone99?.id || (await prisma.zone.findFirst())?.id;
    }

    if (!defaultZoneId) {
      return NextResponse.json(
        {
          error:
            "No zone found in the system. Please create a zone first or provide zoneId.",
        },
        { status: 400 },
      );
    }

    // ── Step 4: Map & sanitize rows ─────────────────────────────────────
    const mappedOrders = dataRows.map((row) => {
      const rawOrderId = row[colMapping.orderId]?.trim() || "";
      const rawCustomerName = row[colMapping.customerName]?.trim() || "";
      const rawPhone = row[colMapping.phone]?.trim() || "";
      const rawAddress = row[colMapping.address]?.trim() || "";
      const rawAmountUsd = row[colMapping.amountUsd]?.trim() || "0";
      const rawPackages = row[colMapping.packages]?.trim() || "1";

      const orderId =
        rawOrderId.length > 0
          ? rawOrderId
          : `ORD-IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const cleanedAmount = String(rawAmountUsd).replace(/[^0-9.-]/g, "");
      const amountUsd = parseFloat(cleanedAmount);
      const finalAmountUsd = isNaN(amountUsd) ? 0 : amountUsd;

      const packages = parseInt(rawPackages, 10);
      const finalPackages = isNaN(packages) || packages < 1 ? 1 : packages;

      return {
        orderId,
        customerName: rawCustomerName || "Unknown",
        customerPhone: rawPhone || "N/A",
        customerAddress: rawAddress || "N/A",
        amountUsd: finalAmountUsd,
        amountLbp: 0,
        collectedUsd: 0,
        collectedLbp: 0,
        packages: finalPackages,
        zoneId: defaultZoneId,
        creatorId: payload.id, // the merchant's own user account
        merchantId: merchant.id, // the merchant's cuid (session-scoped)
        createdAt: customDate,
      };
    });

    // ── Step 5: Bulk insert with deduplication ──────────────────────────
    const result = await prisma.order.createMany({
      data: mappedOrders,
      skipDuplicates: true,
    });

    // ── Step 6: Return summary ──────────────────────────────────────────
    return NextResponse.json(
      {
        success: true,
        totalRowsParsed: dataRows.length,
        successfullyInserted: result.count,
        skippedDuplicates: dataRows.length - result.count,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const err = error as { code?: string; meta?: unknown; message?: string };
    console.error("[POST /api/merchant/orders/import-sheet] Error:", error);

    if (err.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Some orders have duplicate tracking IDs. The import was partially applied (duplicates skipped).",
          details: err.meta,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: err.message || String(error),
      },
      { status: 500 },
    );
  }
}
