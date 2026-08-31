import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionToken, verifySessionToken } from "@/lib/jwt";

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
    if (!payload?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [pendingSettlements, pendingClearance] = await Promise.all([
      prisma.driverPayout.count({ where: { status: "PENDING" } }),
      prisma.driverPayout.count({ where: { status: "PENDING_APPROVAL" } }),
    ]);

    return NextResponse.json({ pendingSettlements, pendingClearance });
  } catch (error: unknown) {
    console.error("GET /api/notifications/payouts error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
