import { NextResponse } from "next/server";
import { requireServerPermission } from "@/lib/server-permissions";
import {
  exportOrdersToLibanex,
  LIBANEX_FIN_CODES,
  LIBANEX_LOCATION_CODES,
} from "@/lib/libanexSync";

/**
 * POST /api/admin/libanex/export — export selected PWA orders into Libanex.
 * Body: { "orderIds": ["<internal Order.id>", ...], "sellerId": "1176",
 *         "location": "W", "finStatus": "UD" }
 * After export, Libanex becomes the source of truth: a LibanexLink row is
 * created so the regular 30-minute sync keeps both sides in lockstep, and the
 * PWA order is assigned driver D999 ("Libanex").
 */
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;

  let orderIds: string[] = [];
  let sellerId = "";
  let location = "W";
  let finStatus = "UD";
  try {
    const body = await request.json();
    if (Array.isArray(body?.orderIds)) {
      orderIds = body.orderIds.map((x: unknown) => String(x).trim()).filter(Boolean);
    }
    sellerId = String(body?.sellerId ?? "").trim();
    location = String(body?.location ?? "W").trim();
    finStatus = String(body?.finStatus ?? "UD").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds is required" }, { status: 400 });
  }
  if (orderIds.length > 100) {
    return NextResponse.json(
      { error: "At most 100 orders can be exported per request" },
      { status: 400 },
    );
  }
  if (!sellerId) {
    return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
  }
  if (!(LIBANEX_LOCATION_CODES as readonly string[]).includes(location)) {
    return NextResponse.json({ error: `Unknown Libanex location: ${location}` }, { status: 400 });
  }
  if (!(LIBANEX_FIN_CODES as readonly string[]).includes(finStatus)) {
    return NextResponse.json({ error: `Unknown Libanex fin status: ${finStatus}` }, { status: 400 });
  }

  try {
    const summary = await exportOrdersToLibanex(orderIds, sellerId, location, finStatus);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: `Export failed: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
