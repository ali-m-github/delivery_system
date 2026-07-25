"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function addSellerException(
  driverId: string,
  merchantId: string,
  rate: number,
) {
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
