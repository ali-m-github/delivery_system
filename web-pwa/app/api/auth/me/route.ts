import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) return NextResponse.json({ error: 'No token found' }, { status: 401 });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    const user = await prisma.user.findUnique({
      where: { id: payload.id as string },
      select: { id: true, username: true, role: true, permissions: true }
    });

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });

    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    console.error('Me API Error:', error);
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
}