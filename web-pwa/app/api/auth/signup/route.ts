import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/helpers/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, firstName, lastName, email, password } = body;

    // 1. Validate all required fields
    if (!username || !firstName || !lastName || !email || !password) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: username, firstName, lastName, email, password",
        },
        { status: 400 },
      );
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Basic password strength
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    // 2. Check if email or username already exists
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existingUser) {
      const field = existingUser.email === email ? "Email" : "Username";
      return NextResponse.json(
        { error: `${field} already registered` },
        { status: 409 },
      );
    }

    // 3. Hash the password
    const hashedPassword = await hashPassword(password);

    // 4. Create user with MERCHANT role (no merchant profile yet — admin links later)
    await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        role: "MERCHANT",
      },
    });

    return NextResponse.json(
      {
        message: "Merchant account created successfully. Await admin linking.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Signup Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
