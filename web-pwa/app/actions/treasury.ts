"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/server-permissions";

export async function createTreasuryBox(formData: FormData) {
  // Server-side authorization: creating treasury boxes is a financial action.
  // Mirrors POST /api/admin/treasury (ACTION_TREASURY_TRANSACT).
  await requireActionPermission("ACTION_TREASURY_TRANSACT");

  const name = (formData.get("name") as string)?.trim();
  const isPositive = formData.get("isPositive") === "on";

  if (!name) throw new Error("Name is required");

  try {
    await prisma.treasuryBox.create({
      data: {
        name,
        isPositive,
        balanceUsd: 0,
        balanceLbp: 0,
      },
    });
  } catch (error: any) {
    // TreasuryBox.name is @unique — surface a clear message on collision
    // instead of leaking the raw Prisma P2002 as a 500.
    if (error?.code === "P2002") {
      throw new Error("A treasury box with this name already exists");
    }
    throw error;
  }

  revalidatePath("/admin/treasury");
}
