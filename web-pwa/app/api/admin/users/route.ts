import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/helpers/auth';

const prisma = new PrismaClient();

// GET /api/admin/users — Fetch all users (select fields)
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        permissions: true,
      },
      orderBy: { username: 'asc' },
    });
    return NextResponse.json(users, { status: 200 });
  } catch (error) {
    console.error('GET /api/admin/users Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/admin/users — Create a new user (employee/admin)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, email, password, role, permissions } = body;

    // Validate required fields
    if (!username || !email || !password || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: username, email, password, role' },
        { status: 400 }
      );
    }

    // Check for existing user by email
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create the user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role,
        permissions: permissions || [],
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        permissions: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error('POST /api/admin/users Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
