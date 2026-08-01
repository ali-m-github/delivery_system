import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionToken } from "@/helpers/auth";

// ─── Session token extraction ─────────────────────────────────────────────────
// Reads the `session` cookie from the raw Request so this guard works like the
// other route handlers (lib/server-permissions.ts) without next/headers().
function getSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// GET /api/notifications/payouts — Returns unread payout notification counts
// for the Sidebar badges.
//
//   pendingSettlements → count of PENDING payouts (need settling; /settlements)
//   pendingClearance   → count of PENDING_APPROVAL payouts (settled, awaiting
//                        final admin clearance; /cleared-payouts)
//
// Route Handlers are not cached by default, so this always returns fresh counts.
export async function GET(request: Request) {
  try {
    // ── Require an authenticated session (badges are only shown to logged-in
    //    users in the Sidebar) ──
    const token = getSessionToken(request);
    const payload = token ? await verifySessionToken(token) : null;
    if (!payload?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [pendingSettlements, pendingClearance] = await Promise.all([
      prisma.driverPayout.count({ where: { status: "PENDING" } }),
      prisma.driverPayout.count({ where: { status: "PENDING_APPROVAL" } }),
    ]);

    return NextResponse.json({ pendingSettlements, pendingClearance });
  } catch (error: unknown) {
    console.error("GET /api/notifications/payouts error:", error);
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
