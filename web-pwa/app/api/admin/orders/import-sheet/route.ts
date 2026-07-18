import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import Papa from "papaparse";

const prisma = new PrismaClient();

// ─── POST /api/admin/orders/import-sheet ────────────────────────────────────────
// Imports orders from a public Google Sheet CSV for a Cash Seller.
// Expects JSON body: { url, merchantId, startRow?, colMapping?, zoneId?, creatorId?, receivedDate? }
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // ── Validate required fields ──────────────────────────────────────────
    const { url, merchantId, receivedDate } = body;

    // ── Parse custom received date (optional) ─────────────────────────────
    let customDate: Date;
    if (receivedDate && typeof receivedDate === "string") {
      const parsed = new Date(receivedDate + "T00:00:00Z");
      customDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      customDate = new Date();
    }
    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'url' parameter." },
        { status: 400 },
      );
    }
    if (merchantId == null) {
      return NextResponse.json(
        { error: "Missing 'merchantId' parameter." },
        { status: 400 },
      );
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

    // Extract gid from query string or URL hash, default to "0"
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

    // Parse CSV with PapaParse
    const parseResult = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
    const parsedRows: string[][] = parseResult.data;

    // Slice from startRow to skip headers
    const slicedRows = parsedRows.slice(startRow);

    // Strict row pruning: remove empty rows and accidental header rows
    const dataRows = slicedRows.filter((row) => {
      const rawTracking = String(row[colMapping.orderId] || "").trim();
      const rawPhone = String(row[colMapping.phone] || "").trim();

      // Ignore rows where both tracking and phone are empty (blank grid lines)
      if (!rawTracking && !rawPhone) return false;

      // Ignore header rows if startRow was set too low
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

    // ── Step 3: Verify merchant & resolve required relations ────────────
    let merchant = null;

    // Check if the incoming ID is a UUID string (contains hyphens or letters)
    if (
      typeof merchantId === "string" &&
      (merchantId.includes("-") || isNaN(Number(merchantId)))
    ) {
      merchant = await prisma.merchant.findUnique({
        where: { id: merchantId }, // Search by UUID primary key
      });
    } else {
      // Otherwise, search by the integer merchantId field
      const parsedId = parseInt(String(merchantId), 10);
      merchant = await prisma.merchant.findUnique({
        where: { merchantId: parsedId },
      });
    }

    if (!merchant) {
      return NextResponse.json(
        { error: `Merchant (${merchantId}) does not exist in the database.` },
        { status: 404 },
      );
    }

    // Use the database-confirmed integer ID for creating the orders
    const targetMerchantId = merchant.merchantId;

    if (!merchant.isCashSeller) {
      console.warn(
        `[import-sheet] Merchant ${targetMerchantId} is not marked as a Cash Seller. Proceeding anyway.`,
      );
    }

    // Resolve default zone — prefer Zone 99, then explicit zoneId, then first available
    let defaultZoneId = body.zoneId;

    if (!defaultZoneId) {
      // Try to find Zone 99 by name
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

    // Resolve creator (admin user)
    const adminUser = body.creatorId
      ? await prisma.user.findUnique({ where: { id: body.creatorId } })
      : await prisma.user.findFirst({ where: { role: "ADMIN" } });

    if (!adminUser) {
      return NextResponse.json(
        {
          error:
            "No admin user found to assign as order creator. Provide creatorId.",
        },
        { status: 400 },
      );
    }

    // ── Step 4: Map & sanitize rows ─────────────────────────────────────
    const mappedOrders = dataRows.map((row) => {
      // Extract raw values using colMapping
      const rawOrderId = row[colMapping.orderId]?.trim() || "";
      const rawCustomerName = row[colMapping.customerName]?.trim() || "";
      const rawPhone = row[colMapping.phone]?.trim() || "";
      const rawAddress = row[colMapping.address]?.trim() || "";
      const rawAmountUsd = row[colMapping.amountUsd]?.trim() || "0";
      const rawPackages = row[colMapping.packages]?.trim() || "1";

      // --- Sanitize tracking ID ---
      const orderId =
        rawOrderId.length > 0
          ? rawOrderId
          : `ORD-IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // --- Sanitize amountUsd: preserve negative sign, digits, and decimals ---
      const cleanedAmount = String(rawAmountUsd).replace(/[^0-9.-]/g, "");
      const amountUsd = parseFloat(cleanedAmount);
      const finalAmountUsd = isNaN(amountUsd) ? 0 : amountUsd;

      // --- Sanitize packages ---
      const packages = parseInt(rawPackages, 10);
      const finalPackages = isNaN(packages) || packages < 1 ? 1 : packages;

      return {
        orderId,
        customerName: rawCustomerName || "Unknown",
        customerPhone: rawPhone || "N/A",
        customerAddress: rawAddress || "N/A",
        amountUsd: finalAmountUsd,
        amountLbp: 0,
        // Force collected amounts to 0 since the order is just entering the warehouse
        collectedUsd: 0,
        collectedLbp: 0,
        packages: finalPackages,
        zoneId: defaultZoneId,
        creatorId: adminUser.id,
        merchantId: merchant.id, // Merchant's cuid
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
  } catch (error: any) {
    console.error("[POST /api/admin/orders/import-sheet] Error:", error);

    // Prisma unique constraint violation
    if (error.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Some orders have duplicate tracking IDs. The import was partially applied (duplicates skipped).",
          details: error.meta,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
