import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("session")?.value;

  // 1. No token? Kick to login.
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    // 2. Strict Admin Lock
    // If the user tries to go to /admin or /zones, but their role is NOT 'ADMIN', kick them to dashboard.
    if (
      request.nextUrl.pathname.startsWith("/admin") ||
      request.nextUrl.pathname.startsWith("/zones")
    ) {
      if (payload.role !== "ADMIN") {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }

    return NextResponse.next();
  } catch (error) {
    // 3. Token is fake, tampered with, or expired
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("session");
    return response;
  }
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/orders/:path*",
    "/admin/:path*",
    "/driver/:path*",
    "/drivers/:path*",
    "/sellers/:path*",
    "/settlements/:path*",
    "/merchant/:path*",
    "/zones/:path*",
  ],
};
