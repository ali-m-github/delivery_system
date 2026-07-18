"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function addSellerException(
  driverId: string,
  merchantId: string,
  rate: number,
) {
  await prisma.driverSellerRate.upsert({
    where: { driverId_merchantId: { driverId, merchantId } },
    update: { rateUsd: rate },
    create: { driverId, merchantId, rateUsd: rate, rateLbp: 0 },
  });
  revalidatePath(`/drivers/${driverId}`);
}
