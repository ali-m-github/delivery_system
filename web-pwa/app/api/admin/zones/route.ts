import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const zones = await prisma.zone.findMany({
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(zones);
  } catch (error) {
    console.error('Fetch Zones Error:', error);
    return NextResponse.json({ error: 'Failed to fetch zones' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name } = await request.json();

    if (!name) {
      return NextResponse.json({ error: 'Zone name is required' }, { status: 400 });
    }

    const newZone = await prisma.zone.create({
      data: { name }
    });

    return NextResponse.json(newZone, { status: 201 });
  } catch (error) {
    console.error('Create Zone Error:', error);
    return NextResponse.json({ error: 'Failed to create zone' }, { status: 500 });
  }
}