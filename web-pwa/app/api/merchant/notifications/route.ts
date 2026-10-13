import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerRole } from "@/lib/server-permissions";

// ──────────────────────────────────────────────────────────────────────────────
// Merchant notification bell API.
//
// GET   /api/merchant/notifications          → unread count + recent notifications
//         ?unreadOnly=true  only unread rows
//         ?limit=N           max rows (1..50, default 20)
// PATCH /api/merchant/notifications          → mark notifications as read
//         { ids: string[] }  specific rows
//         { all: true }      every unread row for this merchant
//
// All queries are scoped to the merchant resolved from the session — a
// merchant can never read or mutate another merchant's notifications.
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

async function resolveMerchantId(request: Request) {
  const auth = await requireServerRole(request, "MERCHANT");
  if (auth instanceof Response) return { error: auth } as const;

  const merchant = await prisma.merchant.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  });

  if (!merchant) {
    return {
      error: NextResponse.json(
        { error: "No merchant profile linked to your account" },
        { status: 403 },
      ),
    } as const;
  }

  return { merchantId: merchant.id } as const;
}

// GET /api/merchant/notifications
export async function GET(request: Request) {
  try {
    const resolved = await resolveMerchantId(request);
    if ("error" in resolved) return resolved.error;

    const params = new URL(request.url).searchParams;
    const unreadOnly = params.get("unreadOnly") === "true";

    const limitParam = parseInt(params.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const where = {
      merchantId: resolved.merchantId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [unreadCount, notifications] = await Promise.all([
      prisma.notification.count({
        where: { merchantId: resolved.merchantId, isRead: false },
      }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          orderId: true,
          type: true,
          title: true,
          message: true,
          meta: true,
          isRead: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({ unreadCount, notifications });
  } catch (error) {
    console.error("[merchant/notifications] GET failed:", error);
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 },
    );
  }
}

// PATCH /api/merchant/notifications
export async function PATCH(request: Request) {
  try {
    const resolved = await resolveMerchantId(request);
    if ("error" in resolved) return resolved.error;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const all = (body as { all?: unknown }).all === true;
    const idsRaw = (body as { ids?: unknown }).ids;

    if (!all && !Array.isArray(idsRaw)) {
      return NextResponse.json(
        { error: "Provide an ids array or all: true" },
        { status: 400 },
      );
    }

    if (!all) {
      const ids = (idsRaw as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      if (ids.length === 0) {
        return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
      }
      if (ids.length > MAX_LIMIT * 10) {
        return NextResponse.json({ error: "Too many ids" }, { status: 400 });
      }

      await prisma.notification.updateMany({
        // merchantId in the filter guarantees cross-merchant ids are ignored.
        where: { merchantId: resolved.merchantId, id: { in: ids } },
        data: { isRead: true },
      });
    } else {
      await prisma.notification.updateMany({
        where: { merchantId: resolved.merchantId, isRead: false },
        data: { isRead: true },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[merchant/notifications] PATCH failed:", error);
    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 },
    );
  }
}
