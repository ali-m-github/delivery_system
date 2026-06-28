import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/helpers/auth';

const prisma = new PrismaClient();

// PUT /api/admin/employees/[id] — Update an employee (user)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const body = await request.json();
    const { username, password, role, permissions } = body;

    // Build conditional update payload
    const updateData: Record<string, unknown> = {};

    if (username) updateData.username = username;
    if (role) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = permissions;
    if (password && password.trim() !== '') {
      updateData.password = await hashPassword(password);
    }

    // Ensure at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields provided for update' },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        permissions: true,
      },
    });

    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    console.error('PUT /api/admin/employees Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/admin/employees/[id] — Delete an employee (user)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ message: 'Employee deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('DELETE /api/admin/employees Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
