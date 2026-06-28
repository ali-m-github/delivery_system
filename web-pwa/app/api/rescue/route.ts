import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function GET() {
  try {
    // 1. Set your new desired credentials here
    const newEmail = "YOUR_NEW_EMAIL@system.local";
    const newPassword = "YOUR_NEW_PASSWORD";

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 2. Find the existing admin account
    let admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });

    if (admin) {
      // 3. If an admin exists, FORCE an update to the new email and password
      admin = await prisma.user.update({
        where: { id: admin.id },
        data: {
          email: newEmail,
          password: hashedPassword,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Existing Admin successfully overwritten!",
        credentials: { email: newEmail, password: newPassword },
      });
    } else {
      // 4. If no admin exists, create one from scratch
      admin = await prisma.user.create({
        data: {
          username: "admin",
          email: newEmail,
          password: hashedPassword,
          role: "ADMIN",
          permissions: [],
        },
      });

      return NextResponse.json({
        success: true,
        message: "Admin account created!",
        credentials: { email: newEmail, password: newPassword },
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to update admin.",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
