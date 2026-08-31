import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/jwt';

// POST /api/auth/logout
export async function POST() {
  const cookieStore = await cookies();
  // Clear the session cookie by overwriting it with an empty value and
  // maxAge 0, mirroring the attributes used at sign-in (path / and Secure in
  // production) so the browser matches and removes the exact same cookie.
  cookieStore.set(SESSION_COOKIE, '', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
  });

  return NextResponse.json({ message: 'Logged out successfully' }, { status: 200 });
}
