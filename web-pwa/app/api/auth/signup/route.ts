import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/helpers/auth';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, businessName, address } = body;

    // 1. Verify all required fields are present
    if (!email || !password || !name || !businessName || !address) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 2. Check if the merchant email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    // 3. Cryptographically hash the password
    const hashedPassword = await hashPassword(password);

    // 4. Create User and Merchant Profile simultaneously in a single transaction
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'MERCHANT', // Hardcoded role for this specific public signup endpoint
        merchantProfile: {
          create: {
            businessName,
            address,
          },
        },
      },
    });

    return NextResponse.json(
      { message: 'Merchant account created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Signup Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
