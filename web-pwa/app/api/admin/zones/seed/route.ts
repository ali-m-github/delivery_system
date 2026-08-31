import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizeAddress } from "@/lib/addressNormalizer";
import { requireServerPermission } from "@/lib/server-permissions";
import * as XLSX from "xlsx";

/**
 * POST /api/admin/zones/seed
 *
 * One-time seed endpoint for uploading a master cities.xlsx file.
 * The file must have two columns: "City" and "Zone".
 *
 * Behavior:
 * - Parses the Excel file, normalizes City strings via normalizeAddress.
 * - Resolves Zone column values to existing zone IDs (by name or direct ID).
 * - Upserts into ZoneMapping with occurrenceCount = 100 and isVerified = true.
 * - Trusts the file as the source of truth — bypasses occurrence thresholds.
 *
 * Returns JSON stats:
 * { success, upsertedCount, createdCount, updatedCount, skippedCount, errors }
 */
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
  try {
    // ── Parse FormData ──────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Upload a .xlsx, .xls, or .csv file." },
        { status: 400 },
      );
    }

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

    // ── Dynamic header detection for City and Zone columns ──────────────
    const firstRow = rows[0];
    const headerKeys = Object.keys(firstRow);
    const normalizeKey = (k: string) =>
      k.trim().toLowerCase().replace(/\s+/g, " ");

    const cityPatterns = ["city", "town", "municipality", "مدينة", "المدينة"];
    const zonePatterns = [
      "zone",
      "zoneid",
      "zone id",
      "zone_id",
      "منطقة",
      "المنطقة",
    ];

    let cityKey = "";
    let zoneKey = "";

    for (const key of headerKeys) {
      const nk = normalizeKey(key);
      if (!cityKey && cityPatterns.some((p) => nk.includes(p))) {
        cityKey = key;
      }
      if (!zoneKey && zonePatterns.some((p) => nk.includes(p))) {
        zoneKey = key;
      }
    }

    // Fallback: if no explicit match, guess first column = city, second = zone
    if (!cityKey && headerKeys.length >= 1) cityKey = headerKeys[0];
    if (!zoneKey && headerKeys.length >= 2) zoneKey = headerKeys[1];

    if (!cityKey || !zoneKey) {
      return NextResponse.json(
        {
          error:
            "Could not detect 'City' and 'Zone' columns. Expected columns: City, Zone.",
        },
        { status: 400 },
      );
    }

    // ── Resolve zone name → zoneId lookup ───────────────────────────────
    const allZones = await prisma.zone.findMany({
      select: { id: true, name: true },
    });
    const zoneNameToId = new Map(
      allZones.map((z) => [z.name.toLowerCase(), z.id]),
    );

    // ── Aggregate rows by normalized city ───────────────────────────────
    // Map: normalizedAddress → { rawAddress, zoneId }
    const seedMap = new Map<string, { rawAddress: string; zoneId: string }>();
    const skippedRows: {
      row: number;
      city: string;
      zone: string;
      reason: string;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawCity = String(row[cityKey] ?? "").trim();
      const rawZone = String(row[zoneKey] ?? "").trim();

      if (rawCity.length === 0 || rawZone.length === 0) {
        skippedRows.push({
          row: i + 1,
          city: rawCity,
          zone: rawZone,
          reason: "Missing city or zone value",
        });
        continue;
      }

      // Resolve zone: try name lookup first, fall back to direct zoneId
      let zoneId = zoneNameToId.get(rawZone.toLowerCase()) ?? "";
      if (zoneId.length === 0) {
        zoneId = rawZone;
      }

      const normalized = normalizeAddress(rawCity);
      if (normalized.length === 0) {
        skippedRows.push({
          row: i + 1,
          city: rawCity,
          zone: rawZone,
          reason: "City normalized to empty string",
        });
        continue;
      }

      // If duplicate city in file, keep first occurrence's zone
      if (!seedMap.has(normalized)) {
        seedMap.set(normalized, { rawAddress: rawCity, zoneId });
      }
    }

    if (seedMap.size === 0) {
      return NextResponse.json(
        {
          error: "No valid rows to seed.",
          skippedCount: skippedRows.length,
          skippedRows,
        },
        { status: 400 },
      );
    }

    // ── Fetch existing ZoneMapping records for these normalized addresses ──
    const normalizedAddresses = Array.from(seedMap.keys());
    const existingMappings = await prisma.zoneMapping.findMany({
      where: { normalizedAddress: { in: normalizedAddresses } },
    });
    const existingMap = new Map(
      existingMappings.map((m) => [m.normalizedAddress, m]),
    );

    // ── Bulk upsert: create new, update existing ────────────────────────
    let createdCount = 0;
    let updatedCount = 0;

    for (const [normalized, agg] of seedMap) {
      const prevMapping = existingMap.get(normalized);

      if (prevMapping) {
        // Update existing: overwrite rawAddress, zoneId, force isVerified & occurrenceCount
        await prisma.zoneMapping.update({
          where: { id: prevMapping.id },
          data: {
            rawAddress: agg.rawAddress,
            zoneId: agg.zoneId,
            occurrenceCount: 100,
            isVerified: true,
          },
        });
        updatedCount++;
      } else {
        // Create new record
        await prisma.zoneMapping.create({
          data: {
            rawAddress: agg.rawAddress,
            normalizedAddress: normalized,
            zoneId: agg.zoneId,
            occurrenceCount: 100,
            isVerified: true,
          },
        });
        createdCount++;
      }
    }

    const totalVerifiedCount = await prisma.zoneMapping.count({
      where: { isVerified: true },
    });

    return NextResponse.json(
      {
        success: true,
        upsertedCount: seedMap.size,
        createdCount,
        updatedCount,
        totalVerifiedCount,
        skippedCount: skippedRows.length,
        ...(skippedRows.length > 0 && {
          skippedRows: skippedRows.slice(0, 20),
        }),
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[POST /api/admin/zones/seed] Error:", error);
    return NextResponse.json(
      {
        error: "Seeding failed",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
