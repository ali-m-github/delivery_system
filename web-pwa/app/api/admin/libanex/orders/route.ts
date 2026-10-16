import { NextResponse } from "next/server";
import { requireServerPermission } from "@/lib/server-permissions";
import { previewSellerOrders } from "@/lib/libanexSync";

/**
 * GET /api/admin/libanex/orders?sellerId=556 — list a seller's Libanex orders
 * for the import picker, annotated with alreadyLinked / existsInPwa flags so
 * the admin can select exactly which orders to import.
 */
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const sellerId = url.searchParams.get("sellerId")?.trim() ?? "";
  if (!sellerId) {
    return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
  }

  try {
    const orders = await previewSellerOrders(sellerId);
    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json(
      { error: `Libanex orders lookup failed: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
