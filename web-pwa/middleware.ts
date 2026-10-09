import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, getSessionToken, verifySessionToken } from "@/lib/jwt";

export async function middleware(request: NextRequest) {
  const token = getSessionToken(request);

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    // `verifySessionToken` returns null for any failure (bad signature,
    // expired, malformed, or a missing JWT_SECRET in production — the
    // internal secret loader throws, which the verifier swallows into a
    // null). So an unconfigured deployment redirects to /login instead of
    // letting anyone through or crashing.
    const payload = await verifySessionToken(token);
    if (!payload) {
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }

    // Send logged-in users away from the root landing page to the orders page
    if (request.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/orders", request.url));
    }

    // Coarse page-level gate only. The role claim here is best-effort for
    // redirect purposes; all real authorization is re-evaluated server-side
    // against the database in the API routes (lib/server-permissions.ts).
    if (
      request.nextUrl.pathname.startsWith("/admin") ||
      request.nextUrl.pathname.startsWith("/zones")
    ) {
      if (payload.role !== "ADMIN") {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }

    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/orders/:path*",
    "/admin/:path*",
    "/driver/:path*",
    "/drivers/:path*",
    "/merchants/:path*",
    "/settlements/:path*",
    "/merchant/:path*",
    "/zones/:path*",
    "/statistics/:path*",
  ],
};
