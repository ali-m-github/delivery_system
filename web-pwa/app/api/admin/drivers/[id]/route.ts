import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/helpers/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next.js 15 requires awaiting params
    const resolvedParams = await params;
    const identifier = resolvedParams.id;

    const driver = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      include: {
        user: {
          include: {
            driverCashSellerRates: {
              include: {
                merchant: {
                  select: { id: true, merchantName: true, merchantId: true },
                },
              },
            },
          },
        },
        zoneRates: { include: { zone: true } },
        deliveries: {
          include: {
            zone: true,
            merchant: true,
            history: {
              include: { user: { select: { id: true, username: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        driverSellerRates: {
          include: {
            merchant: {
              select: { id: true, merchantName: true, merchantId: true },
            },
          },
        },
        payouts: {
          orderBy: { createdAt: "desc" },
          include: { orders: true },
        },
      },
    });

    if (!driver) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    return NextResponse.json(driver, { status: 200 });
  } catch (error) {
    console.error("Fetch Single Driver Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// PUT /api/admin/drivers/[id] — Update a driver (User + DriverProfile + ZoneRates) in a transaction
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const contentType = request.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    // --- JSON payload path (supports sellerRates) ---
    let jsonPayload: { sellerRates?: unknown } | null = null;
    if (isJson) {
      try {
        jsonPayload = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON payload" },
          { status: 400 },
        );
      }
    }

    // --- FormData path (existing behavior) ---
    const formData = !isJson ? await request.formData() : null;

    const driverId = formData
      ? (formData.get("driverId") as string | null)
      : null;
    const username = formData
      ? (formData.get("username") as string | null)
      : null;
    const firstName = formData
      ? (formData.get("firstName") as string | null)
      : null;
    const lastName = formData
      ? (formData.get("lastName") as string | null)
      : null;
    const password = formData
      ? (formData.get("password") as string | null)
      : null;
    const vehicles = formData
      ? (formData.get("vehicles") as string | null)
      : null;
    const zoneRates = formData
      ? (formData.get("zoneRates") as string | null)
      : null;
    const sellerExceptions = formData
      ? (formData.get("sellerExceptions") as string | null)
      : null;
    const photo = formData ? (formData.get("photo") as File | null) : null;

    if (!driverId || !username || !firstName || !lastName) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: driverId, username, firstName, lastName",
        },
        { status: 400 },
      );
    }

    // Parse vehicles if provided
    let parsedVehicles: unknown = undefined;
    if (vehicles) {
      try {
        parsedVehicles = JSON.parse(vehicles);
      } catch {
        return NextResponse.json(
          { error: "vehicles must be a valid JSON array" },
          { status: 400 },
        );
      }
    }

    // Parse zoneRates if provided
    let parsedZoneRates: { zoneId: string; rate: number }[] | undefined;
    if (zoneRates) {
      try {
        parsedZoneRates = JSON.parse(zoneRates) as {
          zoneId: string;
          rate: number;
        }[];
      } catch {
        return NextResponse.json(
          { error: "zoneRates must be a valid JSON array" },
          { status: 400 },
        );
      }

      if (!Array.isArray(parsedZoneRates) || parsedZoneRates.length === 0) {
        return NextResponse.json(
          { error: "zoneRates must be a non-empty array" },
          { status: 400 },
        );
      }
    }

    // Parse sellerRates from JSON payload if provided
    let parsedSellerRates:
      | { merchantId: string; rateUsd: number }[]
      | undefined;
    if (jsonPayload && Array.isArray(jsonPayload.sellerRates)) {
      parsedSellerRates = jsonPayload.sellerRates.map((rate: any) => {
        const merchantId = rate.sellerId;
        if (!merchantId || typeof merchantId !== "string") {
          throw new Error("Each sellerRate must have a valid sellerId string");
        }
        return {
          merchantId,
          rateUsd: Number(rate.rateUsd ?? rate.rate ?? 0),
        };
      });
    }

    // Parse sellerExceptions from FormData if provided (fallback when no JSON sellerRates)
    let parsedSellerExceptions:
      | { merchantId: string; rate: number }[]
      | undefined;
    if (!parsedSellerRates && sellerExceptions) {
      try {
        parsedSellerExceptions = JSON.parse(sellerExceptions) as {
          merchantId: string;
          rate: number;
        }[];
      } catch {
        return NextResponse.json(
          { error: "sellerExceptions must be a valid JSON array" },
          { status: 400 },
        );
      }

      if (!Array.isArray(parsedSellerExceptions)) {
        return NextResponse.json(
          { error: "sellerExceptions must be an array" },
          { status: 400 },
        );
      }
    }

    // Handle optional photo upload
    let photoUrl: string | null | undefined = undefined;
    if (photo && photo.size > 0) {
      const uploadDir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "drivers",
      );
      await mkdir(uploadDir, { recursive: true });
      const filename = `${Date.now()}-${photo.name}`;
      const buffer = Buffer.from(await photo.arrayBuffer());
      await writeFile(path.join(uploadDir, filename), buffer);
      photoUrl = `/uploads/drivers/${filename}`;
    }

    const driver = await prisma.$transaction(async (tx) => {
      // Step 1: Fetch the existing DriverProfile to discover the associated userId
      const existingProfile = await tx.driverProfile.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!existingProfile) {
        throw new Error("Driver not found");
      }

      // Step 2: Update the base User record
      const userUpdateData: Record<string, unknown> = {};
      if (username) userUpdateData.username = username;
      if (password && password.trim() !== "") {
        userUpdateData.password = await hashPassword(password);
      }

      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: existingProfile.userId },
          data: userUpdateData,
        });
      }

      // Step 3: Update the DriverProfile record
      const profileUpdateData: Record<string, unknown> = {};
      if (driverId) profileUpdateData.driverId = driverId;
      if (firstName) profileUpdateData.firstName = firstName;
      if (lastName) profileUpdateData.lastName = lastName;
      if (parsedVehicles !== undefined)
        profileUpdateData.vehicles = parsedVehicles;
      if (photoUrl !== undefined) profileUpdateData.photoUrl = photoUrl;

      const profile = await tx.driverProfile.update({
        where: { id },
        data: profileUpdateData,
      });

      // Step 4: Replace all zone rates if provided
      if (parsedZoneRates) {
        await tx.driverZoneRate.deleteMany({
          where: { driverId: id },
        });

        // Validate zoneIds exist before inserting to avoid FK violations
        const validZoneIds = await tx.zone.findMany({
          select: { id: true },
        });
        const validZoneIdSet = new Set(validZoneIds.map((z) => z.id));

        const validRates = parsedZoneRates.filter((zr) =>
          validZoneIdSet.has(zr.zoneId),
        );
        const invalidRates = parsedZoneRates.filter(
          (zr) => !validZoneIdSet.has(zr.zoneId),
        );

        if (invalidRates.length > 0) {
          console.warn(
            "Skipping zone rates with deleted zones:",
            invalidRates.map((zr) => zr.zoneId),
          );
        }

        if (validRates.length > 0) {
          await tx.driverZoneRate.createMany({
            data: validRates.map((zr) => ({
              driverId: profile.id,
              zoneId: zr.zoneId,
              rate: zr.rate,
            })),
          });
        }
      }

      // Step 5: Replace seller rates/exceptions if provided
      // Prioritize parsedSellerRates (JSON) over parsedSellerExceptions (FormData)
      const ratesToInsert = parsedSellerRates ?? parsedSellerExceptions;
      if (ratesToInsert !== undefined) {
        await tx.driverSellerRate.deleteMany({
          where: { driverId: id },
        });

        if (ratesToInsert.length > 0) {
          await tx.driverSellerRate.createMany({
            data: ratesToInsert.map((rate) => ({
              driverId: profile.id,
              merchantId: rate.merchantId,
              rateUsd: "rateUsd" in rate ? rate.rateUsd : rate.rate,
              rateLbp: 0,
            })),
          });
        }
      }

      // Return the fully updated driver with relations
      return tx.driverProfile.findUnique({
        where: { id: profile.id },
        include: {
          user: {
            select: { username: true, email: true },
          },
          zoneRates: {
            include: {
              zone: {
                select: { id: true, name: true },
              },
            },
          },
          driverSellerRates: {
            include: {
              merchant: {
                select: { id: true, merchantName: true, merchantId: true },
              },
            },
          },
          payouts: {
            orderBy: { createdAt: "desc" },
            include: { orders: true },
          },
        },
      });
    });

    return NextResponse.json(driver, { status: 200 });
  } catch (error) {
    console.error("PUT /api/admin/drivers Error:", error);
    const message =
      error instanceof Error && error.message === "Driver not found"
        ? "Driver not found"
        : "Failed to update driver";
    const status = message === "Driver not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/admin/drivers/[id] — Delete a driver (DriverProfile + User)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    // Find the DriverProfile to get the associated userId
    const profile = await prisma.driverProfile.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    // Delete the core user account (cascades DriverProfile via onDelete?
    // but we explicitly find and delete the user)
    await prisma.user.delete({ where: { id: profile.userId } });

    return NextResponse.json(
      { message: "Driver deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("DELETE /api/admin/drivers Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
