import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizeAddress } from "@/lib/addressNormalizer";
import { requireServerPermission } from "@/lib/server-permissions";

// We use the xlsx library already in the project for parsing Excel/CSV
import * as XLSX from "xlsx";

const VERIFICATION_THRESHOLD = 5;

/**
 * POST /api/admin/zones/train
 *
 * Accepts an uploaded Excel/CSV file (FormData field: "file").
 * Each row must contain an "address" column and either "zoneId" or "zone" column.
 *
 * Accumulative upsert logic:
 * - Groups and counts occurrences per normalized address within the file.
 * - If normalizedAddress already exists in ZoneMapping, increments its occurrenceCount
 *   and updates rawAddress + zoneId if not yet verified.
 * - If it does NOT exist, creates a new record.
 * - If total occurrenceCount >= 10, auto-sets isVerified = true.
 *
 * Returns JSON stats:
 * { newAddressesAdded, existingAddressesUpdated, newlyVerifiedCount, totalVerifiedCount }
 */
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
  try {
    // ── Debug: verify prisma client state ───────────────────────────────
    console.log("[POST /api/admin/zones/train] prisma:", typeof prisma);
    console.log(
      "[POST /api/admin/zones/train] prisma.zone:",
      typeof prisma?.zone,
    );
    console.log(
      "[POST /api/admin/zones/train] prisma.zoneMapping:",
      typeof prisma?.zoneMapping,
    );
    // ── Parse FormData ──────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Upload a .xlsx, .xls, or .csv file." },
        { status: 400 },
      );
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    if (
      !fileName.endsWith(".xlsx") &&
      !fileName.endsWith(".xls") &&
      !fileName.endsWith(".csv")
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid file type. Only .xlsx, .xls, and .csv files are supported.",
        },
        { status: 400 },
      );
    }

    // ── Read file buffer and parse with xlsx ────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json(
        { error: "The uploaded file contains no sheets." },
        { status: 400 },
      );
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No data rows found in the uploaded file." },
        { status: 400 },
      );
    }

    // ── Dynamic header detection ────────────────────────────────────────
    // Scan the keys of the first row to find address and zone columns,
    // regardless of capitalization, spaces, or wording.
    const firstRow = rows[0];
    const headerKeys = Object.keys(firstRow);
    const normalizeKey = (k: string) =>
      k.trim().toLowerCase().replace(/\s+/g, " ");

    // Address column patterns
    const addressPatterns = [
      "address",
      "location",
      "delivery address",
      "addr",
      "عنوان",
      "العنوان",
    ];
    let addressKey = "";
    for (const key of headerKeys) {
      const nk = normalizeKey(key);
      if (addressPatterns.includes(nk)) {
        addressKey = key;
        break;
      }
    }

    // Zone column patterns — match zoneId, zone name, or direct numeric zone
    const zonePatterns = [
      "zone",
      "zoneid",
      "zone id",
      "zone_id",
      "منطقة",
      "المنطقة",
    ];
    let zoneKey = "";
    for (const key of headerKeys) {
      const nk = normalizeKey(key);
      if (zonePatterns.includes(nk)) {
        zoneKey = key;
        break;
      }
    }

    // ── Resolve zone name → zoneId lookup ───────────────────────────────
    const allZones = await prisma.zone.findMany({
      select: { id: true, name: true },
    });
    const zoneNameToId = new Map(
      allZones.map((z) => [z.name.toLowerCase(), z.id]),
    );

    // ── Group and count by normalized address ───────────────────────────
    // Map: normalizedAddress → { rawAddress, zoneId, count }
    const fileAggregation = new Map<
      string,
      { rawAddress: string; zoneId: string; count: number }
    >();

    let skippedRows = 0;

    for (const row of rows) {
      // Use String() conversion + strict length check to avoid
      // false negatives on valid values like "0" (falsy in JS).
      const rawAddrStr = String(row[addressKey] ?? "").trim();
      const rawZoneStr = String(row[zoneKey] ?? "").trim();

      // Skip individual rows gracefully — missing address or zone
      if (rawAddrStr.length === 0 || rawZoneStr.length === 0) {
        skippedRows++;
        continue;
      }

      // Resolve zone: try name lookup first, fall back to direct zoneId
      let zoneId = zoneNameToId.get(rawZoneStr.toLowerCase()) ?? "";
      if (zoneId.length === 0) {
        // Not a zone name — treat the raw value as a direct zoneId
        // (allows "0", "6", "14B", UUIDs, etc.)
        zoneId = rawZoneStr;
      }

      const normalized = normalizeAddress(rawAddrStr);
      if (normalized.length === 0) {
        skippedRows++;
        continue;
      }

      const existing = fileAggregation.get(normalized);
      if (existing) {
        existing.count++;
      } else {
        fileAggregation.set(normalized, {
          rawAddress: rawAddrStr,
          zoneId,
          count: 1,
        });
      }
    }

    if (fileAggregation.size === 0) {
      return NextResponse.json(
        {
          error:
            "No valid rows found with both address and zone information." +
            (skippedRows > 0
              ? ` ${skippedRows} row(s) were skipped due to missing data.`
              : ""),
        },
        { status: 400 },
      );
    }

    // ── Fetch existing ZoneMapping records for these normalized addresses ──
    const normalizedAddresses = Array.from(fileAggregation.keys());
    const existingMappings = await prisma.zoneMapping.findMany({
      where: { normalizedAddress: { in: normalizedAddresses } },
    });
    const existingMap = new Map(
      existingMappings.map((m) => [m.normalizedAddress, m]),
    );

    // ── Accumulative upsert ─────────────────────────────────────────────
    let newAddressesAdded = 0;
    let existingAddressesUpdated = 0;
    let newlyVerifiedCount = 0;

    for (const [normalized, agg] of fileAggregation) {
      const prevMapping = existingMap.get(normalized);

      if (prevMapping) {
        // Existing record — increment count
        const newTotal = prevMapping.occurrenceCount + agg.count;
        const becomesVerified =
          !prevMapping.isVerified && newTotal >= VERIFICATION_THRESHOLD;

        await prisma.zoneMapping.update({
          where: { id: prevMapping.id },
          data: {
            rawAddress: prevMapping.isVerified
              ? prevMapping.rawAddress
              : agg.rawAddress,
            zoneId: prevMapping.isVerified ? prevMapping.zoneId : agg.zoneId,
            occurrenceCount: newTotal,
            isVerified: prevMapping.isVerified || becomesVerified,
          },
        });

        existingAddressesUpdated++;
        if (becomesVerified) newlyVerifiedCount++;
      } else {
        // New record
        const isVerified = agg.count >= VERIFICATION_THRESHOLD;

        await prisma.zoneMapping.create({
          data: {
            rawAddress: agg.rawAddress,
            normalizedAddress: normalized,
            zoneId: agg.zoneId,
            occurrenceCount: agg.count,
            isVerified,
          },
        });

        newAddressesAdded++;
        if (isVerified) newlyVerifiedCount++;
      }
    }

    // ── Count total verified mappings ───────────────────────────────────
    const totalVerifiedCount = await prisma.zoneMapping.count({
      where: { isVerified: true },
    });

    return NextResponse.json(
      {
        success: true,
        newAddressesAdded,
        existingAddressesUpdated,
        newlyVerifiedCount,
        totalVerifiedCount,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[POST /api/admin/zones/train] Error:", error);
    return NextResponse.json(
      { error: "Training failed", details: error.message || String(error) },
      { status: 500 },
    );
  }
}
