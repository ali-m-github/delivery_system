"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/server-permissions";

export async function addSellerException(
  driverId: string,
  merchantId: string,
  rate: number,
) {
  // Server-side authorization: driver rate changes mirror the already-guarded
  // admin/drivers/[id]/rates routes (ACTION_DRIVER_RATE_EDIT).
  await requireActionPermission("ACTION_DRIVER_RATE_EDIT");

  // Resolve human-readable driverId (e.g., "d001") to internal DriverProfile.id (CUID)
  const profile = await prisma.driverProfile.findFirst({
    where: { driverId: { equals: driverId, mode: "insensitive" } },
    select: { id: true },
  });

  if (!profile) {
    throw new Error(`Driver not found: ${driverId}`);
  }

  await prisma.driverSellerRate.upsert({
    where: { driverId_merchantId: { driverId: profile.id, merchantId } },
    update: { rateUsd: rate },
    create: { driverId: profile.id, merchantId, rateUsd: rate, rateLbp: 0 },
  });
  revalidatePath(`/drivers/${driverId}`);
}
