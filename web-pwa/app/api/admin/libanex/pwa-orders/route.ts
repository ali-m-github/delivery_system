import { NextResponse } from "next/server";
import { requireServerPermission } from "@/lib/server-permissions";
import { listExportableOrders } from "@/lib/libanexSync";

/**
 * GET /api/admin/libanex/pwa-orders — list PWA orders that have never been
 * exported to Libanex (no LibanexLink), for the export picker.
 * Query: ?q=<order id / customer / phone>&limit=<1..200, default 100>
 */
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10) || 100;

  try {
    const orders = await listExportableOrders(q, limit);
    return NextResponse.json({ orders, total: orders.length });
  } catch (error) {
    return NextResponse.json(
      { error: `Order list failed: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
