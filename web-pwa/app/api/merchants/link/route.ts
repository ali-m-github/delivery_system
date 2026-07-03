import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET — fetch orphaned MERCHANT users (not linked to any Merchant record)
export async function GET() {
  try {
    const unlinkedUsers = await prisma.user.findMany({
      where: {
        role: "MERCHANT",
        merchant: null,
      },
      select: {
        id: true,
        username: true,
        email: true,
      },
      orderBy: { username: "asc" },
    });

    return NextResponse.json(unlinkedUsers, { status: 200 });
  } catch (error) {
    console.error("Link GET Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// PATCH — link a user to a merchant
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { merchantId, userId } = body;

    if (!merchantId || !userId) {
      return NextResponse.json(
        { error: "merchantId and userId are required" },
        { status: 400 },
      );
    }

    // Verify the merchant exists
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      return NextResponse.json(
        { error: "Merchant not found" },
        { status: 404 },
      );
    }

    if (merchant.userId) {
      return NextResponse.json(
        { error: "Merchant is already linked to a user" },
        { status: 409 },
      );
    }

    // Verify the user exists and has the MERCHANT role
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role !== "MERCHANT") {
      return NextResponse.json(
        { error: "User must have the MERCHANT role" },
        { status: 400 },
      );
    }

    // Check the user isn't already linked to another merchant
    const existingLink = await prisma.merchant.findUnique({
      where: { userId },
    });

    if (existingLink) {
      return NextResponse.json(
        { error: "User is already linked to another merchant" },
        { status: 409 },
      );
    }

    // Link the user to the merchant
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { userId },
    });

    return NextResponse.json(
      { success: true, message: "User linked to merchant successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Link PATCH Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
