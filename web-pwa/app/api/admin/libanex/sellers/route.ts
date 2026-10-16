import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { libanexGet } from "@/lib/libanexSync";

/**
 * GET /api/admin/libanexsellers — list Libanex sellers for the import picker.
 * Proxies the Libanex sellers API (supports ?q= search) and annotates each
 * seller with how many orders we already have linked locally.
 */
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  try {
    // A purely numeric query first tries an exact Seller ID lookup (so "5272"
    // finds seller 5272 even when its name/phone don't contain it), then falls
    // back to the text search (q and seller_id would be AND-ed by the API).
    let body: Awaited<ReturnType<typeof libanexGet>> | null = null;
    if (/^\d+$/.test(q)) {
      body = await libanexGet("sellers.php", { limit: "100", seller_id: q });
      if ((body.data as any[]).length === 0) body = null;
    }
    if (body === null) {
      body = await libanexGet("sellers.php", {
        limit: "100",
        ...(q ? { q } : {}),
      });
    }

    const sellers = (body.data as any[])
      .filter((s) => (s.seller_id ?? "").toString().trim() !== "")
      .map((s) => ({
        sellerId: String(s.seller_id),
        businessName: s.business_name ?? "",
        telNumber: s.tel_number ?? "",
      }));

    const counts = await prisma.libanexLink.groupBy({
      by: ["libanexSellerId"],
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.libanexSellerId, c._count._all]));

    return NextResponse.json({
      sellers: sellers.map((s) => ({
        ...s,
        linkedOrders: countMap.get(s.sellerId) ?? 0,
      })),
      total: body.pagination?.total ?? sellers.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Libanex sellers lookup failed: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
