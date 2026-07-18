"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createTreasuryBox(formData: FormData) {
  const name = formData.get("name") as string;
  const isPositive = formData.get("isPositive") === "on";

  if (!name) throw new Error("Name is required");

  await prisma.treasuryBox.create({
    data: {
      name,
      isPositive,
      balanceUsd: 0,
      balanceLbp: 0,
    },
  });

  revalidatePath("/admin/treasury");
}
