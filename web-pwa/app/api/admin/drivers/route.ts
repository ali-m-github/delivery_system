import { NextResponse } from 'next/server';
import { PrismaClient, VehicleType } from '@prisma/client';
import { hashPassword } from '@/helpers/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

// GET /api/admin/drivers — Fetch all drivers with user & zoneRates
export async function GET() {
  try {
    const drivers = await prisma.driverProfile.findMany({
      select: {
        id: true,
        driverId: true,
        userId: true,
        firstName: true,
        lastName: true,
        vehicles: true,
        licenseNumber: true,
        isAvailable: true,
        photoUrl: true,
        user: {
          select: { username: true },
        },
        zoneRates: {
          include: {
            zone: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { lastName: 'asc' },
    });

    return NextResponse.json(drivers, { status: 200 });
  } catch (error) {
    console.error('GET /api/admin/drivers Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/admin/drivers — Create a driver (User + DriverProfile + ZoneRates) in a transaction
export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const driverId   = formData.get('driverId') as string | null;
    const username   = formData.get('username') as string | null;
    const password   = formData.get('password') as string | null;
    const firstName  = formData.get('firstName') as string | null;
    const lastName   = formData.get('lastName') as string | null;
    const vehicles   = formData.get('vehicles') as string | null;
    const zoneRates  = formData.get('zoneRates') as string | null;
    const photo      = formData.get('photo') as File | null;

    // ── Validate required fields ──
    if (!driverId || !username || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Missing required fields: driverId, username, password, firstName, lastName' },
        { status: 400 }
      );
    }

    if (!vehicles) {
      return NextResponse.json(
        { error: 'vehicles is required as a JSON string' },
        { status: 400 }
      );
    }

    let parsedVehicles: VehicleType[];
    try {
      parsedVehicles = JSON.parse(vehicles) as VehicleType[];
    } catch {
      return NextResponse.json(
        { error: 'vehicles must be a valid JSON array' },
        { status: 400 }
      );
    }

    if (!Array.isArray(parsedVehicles) || parsedVehicles.length === 0) {
      return NextResponse.json(
        { error: 'vehicles must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!zoneRates) {
      return NextResponse.json(
        { error: 'zoneRates is required as a JSON string' },
        { status: 400 }
      );
    }

    let parsedZoneRates: { zoneId: string; rate: number }[];
    try {
      parsedZoneRates = JSON.parse(zoneRates) as { zoneId: string; rate: number }[];
    } catch {
      return NextResponse.json(
        { error: 'zoneRates must be a valid JSON array' },
        { status: 400 }
      );
    }

    if (!Array.isArray(parsedZoneRates) || parsedZoneRates.length === 0) {
      return NextResponse.json(
        { error: 'zoneRates must be a non-empty array' },
        { status: 400 }
      );
    }

    // ── Handle optional photo upload ──
    let photoUrl: string | null = null;

    if (photo && photo.size > 0) {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'drivers');
      await mkdir(uploadDir, { recursive: true });
      const filename = `${Date.now()}-${photo.name}`;
      const buffer = Buffer.from(await photo.arrayBuffer());
      await writeFile(path.join(uploadDir, filename), buffer);
      photoUrl = `/uploads/drivers/${filename}`;
    }

    // ── Hash the password ──
    const hashedPassword = await hashPassword(password);

    // ── Derive a placeholder email since driver accounts don't require one ──
    const email = `${username}@delivery.local`;

    // ── Execute all three operations inside a transaction ──
    // If any step fails, the entire insertion is rolled back.
    const driver = await prisma.$transaction(async (tx) => {
      // Step 1: Create the base User with role 'DRIVER'
      const user = await tx.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          role: 'DRIVER',
          permissions: [],
        },
      });

      // Step 2: Create the DriverProfile linked to the new user
      const profile = await tx.driverProfile.create({
        data: {
          userId: user.id,
          driverId,
          firstName,
          lastName,
          vehicles: parsedVehicles,
          photoUrl,
        },
      });

      // Step 3: Bulk-create DriverZoneRate entries
      if (parsedZoneRates.length > 0) {
        await tx.driverZoneRate.createMany({
          data: parsedZoneRates.map((zr) => ({
            driverId: profile.id,
            zoneId: zr.zoneId,
            rate: zr.rate,
          })),
        });
      }

      // Return the fully constructed driver with relations
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
        },
      });
    });

    return NextResponse.json(driver, { status: 201 });
  } catch (error) {
    console.error('POST /api/admin/drivers Error:', error);
    return NextResponse.json({ error: 'Failed to create driver' }, { status: 500 });
  }
}
