import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { importSellerOrders } from "@/lib/libanexSync";

/**
 * POST /api/admin/libanex/import — import selected Libanex orders of one
 * seller. Body: { "sellerId": "556", "orderIds": ["556-123", ...],
 * "merchantId"?: "<our merchant uuid>" }
 * orderIds is required: an import of a whole seller implicitly is no longer
 * allowed, the admin must explicitly select the orders in the picker.
 * merchantId (optional) assigns the newly created orders to one of our
 * merchants; it must exist and be active. Adopted pre-existing orders keep
 * their current merchant.
 * Idempotent: already-linked orders are skipped; orders that already exist in
 * the PWA are adopted (linked) instead of duplicated.
 */
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;

  let sellerId = "";
  let orderIds: string[] | undefined;
  let merchantId: string | undefined;
  try {
    const body = await request.json();
    sellerId = String(body?.sellerId ?? "").trim();
    if (Array.isArray(body?.orderIds)) {
      orderIds = body.orderIds.map((x: unknown) => String(x).trim()).filter(Boolean);
    }
    const mRaw = String(body?.merchantId ?? "").trim();
    merchantId = mRaw || undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!sellerId) {
    return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
  }
  // Never import a whole seller implicitly — the admin must pick the orders.
  if (!orderIds || orderIds.length === 0) {
    return NextResponse.json(
      { error: "orderIds is required: select the orders to import" },
      { status: 400 },
    );
  }
  // Validate the chosen merchant BEFORE any write so the import never
  // half-applies with a bad seller id.
  if (merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, isActive: true },
    });
    if (!merchant) {
      return NextResponse.json({ error: "merchantId not found" }, { status: 400 });
    }
    if (!merchant.isActive) {
      return NextResponse.json(
        { error: "merchant is inactive — re-activate it or pick another seller" },
        { status: 400 },
      );
    }
  }

  try {
    const summary = await importSellerOrders(sellerId, orderIds, merchantId);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: `Import failed: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
