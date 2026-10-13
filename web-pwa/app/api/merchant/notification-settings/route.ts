import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireServerRole } from "@/lib/server-permissions";
import {
  normalizeMerchantPreferences,
  parseMerchantPreferencesPayload,
} from "@/lib/notifications/types";

// ──────────────────────────────────────────────────────────────────────────────
// Merchant notification preferences API (settings modal).
//
// GET   /api/merchant/notification-settings → normalized preferences
//         (a null column returns DEFAULT_MERCHANT_PREFERENCES: everything on)
// PATCH /api/merchant/notification-settings → persist a fully-materialized
//         { channels: {...}, events: {...} } object
// ──────────────────────────────────────────────────────────────────────────────

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

// GET /api/merchant/notification-settings
export async function GET(request: Request) {
  try {
    const resolved = await resolveMerchantId(request);
    if ("error" in resolved) return resolved.error;

    const merchant = await prisma.merchant.findUnique({
      where: { id: resolved.merchantId },
      select: { notificationPreferences: true },
    });

    return NextResponse.json({
      preferences: normalizeMerchantPreferences(
        merchant?.notificationPreferences,
      ),
    });
  } catch (error) {
    console.error("[merchant/notification-settings] GET failed:", error);
    return NextResponse.json(
      { error: "Failed to load notification settings" },
      { status: 500 },
    );
  }
}

// PATCH /api/merchant/notification-settings
export async function PATCH(request: Request) {
  try {
    const resolved = await resolveMerchantId(request);
    if ("error" in resolved) return resolved.error;

    const body = await request.json().catch(() => null);
    const preferences = parseMerchantPreferencesPayload(body);
    if (!preferences) {
      return NextResponse.json(
        { error: "Expected { channels: { inApp, whatsapp }, events: { ... } } with boolean values" },
        { status: 400 },
      );
    }

    await prisma.merchant.update({
      where: { id: resolved.merchantId },
      data: {
        notificationPreferences: preferences as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("[merchant/notification-settings] PATCH failed:", error);
    return NextResponse.json(
      { error: "Failed to save notification settings" },
      { status: 500 },
    );
  }
}
