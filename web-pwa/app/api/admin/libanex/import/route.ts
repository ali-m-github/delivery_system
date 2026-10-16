import { NextResponse } from "next/server";
import { requireServerPermission } from "@/lib/server-permissions";
import { importSellerOrders } from "@/lib/libanexSync";

/**
 * POST /api/admin/libanex/import — import one seller's Libanex orders.
 * Body: { "sellerId": "556", "orderIds"?: ["556-123", ...] }
 * When orderIds is provided only those orders are imported; otherwise all of
 * the seller's orders are.
 * Idempotent: already-linked orders are skipped; orders that already exist in
 * the PWA are adopted (linked) instead of duplicated.
 */
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;

  let sellerId = "";
  let orderIds: string[] | undefined;
  try {
    const body = await request.json();
    sellerId = String(body?.sellerId ?? "").trim();
    if (Array.isArray(body?.orderIds)) {
      orderIds = body.orderIds.map((x: unknown) => String(x).trim()).filter(Boolean);
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!sellerId) {
    return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
  }

  try {
    const summary = await importSellerOrders(sellerId, orderIds);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: `Import failed: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
