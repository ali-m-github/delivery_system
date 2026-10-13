import prisma from "@/lib/prisma";
import { getReasonLabel } from "@/lib/driver-reasons";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";
import {
  normalizeMerchantPreferences,
  type NotificationPreferences,
  type NotificationType,
} from "@/lib/notifications/types";

// ──────────────────────────────────────────────────────────────────────────────
// Merchant notification dispatcher.
//
// Called (fire-and-forget) from the order PATCH route after a driver scan
// audit entry (OrderHistory.meta) has been written. It decides, per merchant:
//   1. which event types this scan maps to,
//   2. which of those the merchant's saved preferences enable,
//   3. creates the in-app Notification rows (bell dropdown), and
//   4. sends the WhatsApp message(s) via the Cloud API client (mock in dev).
//
// Defaults: a null notificationPreferences behaves as "everything enabled"
// (see lib/notifications/types.ts). WhatsApp additionally requires a phone
// number on the merchant record.
// ──────────────────────────────────────────────────────────────────────────────

export interface DriverScanEvent {
  merchantId: string;
  /** Order.id (cuid) — stored on the Notification row. */
  orderId: string;
  /** Human-readable Order.orderId (e.g. "2-0001") used in message text. */
  orderRef: string;
  semanticStatus: "delivered" | "postponed" | "rejected";
  reasonCode: string | null;
  reasonText: string | null;
  expectedCod: number | null;
  actualCodCollected: number | null;
  discrepancy: number;
  driverName: string | null;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/** Bilingual "English / العربية" reason line, or null when no reason given. */
function reasonLine(
  reasonCode: string | null,
  reasonText: string | null,
): string | null {
  const label = getReasonLabel(reasonCode);
  if (label) return label;
  if (reasonText) return reasonText;
  return null;
}

interface EventContent {
  title: string;
  message: string; // in-app (English, matches the merchant portal UI)
  whatsapp: string; // bilingual EN/AR
}

function buildEventContent(event: DriverScanEvent, type: NotificationType): EventContent {
  const driver = event.driverName || "Driver";
  const reason = reasonLine(event.reasonCode, event.reasonText);

  switch (type) {
    case "DELIVERED": {
      const collected =
        event.actualCodCollected !== null
          ? ` Collected: ${formatUsd(event.actualCodCollected)}.`
          : "";
      return {
        title: "Order delivered",
        message: `Order ${event.orderRef} was delivered by ${driver}.${collected}`,
        whatsapp:
          `✅ Order ${event.orderRef} has been delivered by ${driver}.${collected}\n` +
          `✅ تم تسليم الطلب ${event.orderRef} من قبل المندوب.`,
      };
    }
    case "PRICE_DISCREPANCY": {
      const diff = formatSignedUsd(event.discrepancy);
      return {
        title: "COD price discrepancy",
        message:
          `Order ${event.orderRef}: expected COD ${formatUsd(event.expectedCod)}, ` +
          `collected ${formatUsd(event.actualCodCollected)} (difference ${diff}).` +
          (reason ? ` Reason: ${reason}` : ""),
        whatsapp:
          `⚠️ Price difference on order ${event.orderRef}:\n` +
          `Expected: ${formatUsd(event.expectedCod)} | Collected: ${formatUsd(event.actualCodCollected)} (${diff})\n` +
          (reason ? `Reason: ${reason}\n` : "") +
          `⚠️ فرق في السعر على الطلب ${event.orderRef}: المتوقع ${formatUsd(event.expectedCod)} — المستلم ${formatUsd(event.actualCodCollected)}.`,
      };
    }
    case "POSTPONED": {
      return {
        title: "Delivery postponed",
        message:
          `Order ${event.orderRef} was postponed by ${driver}.` +
          (reason ? ` Reason: ${reason}` : ""),
        whatsapp:
          `🕐 Delivery of order ${event.orderRef} was postponed by ${driver}.\n` +
          (reason ? `Reason: ${reason}\n` : "") +
          `🕐 تم تأجيل تسليم الطلب ${event.orderRef}.`,
      };
    }
    case "REJECTED": {
      return {
        title: "Order rejected / returned",
        message:
          `Order ${event.orderRef} was rejected and returned by ${driver}.` +
          (reason ? ` Reason: ${reason}` : ""),
        whatsapp:
          `❌ Order ${event.orderRef} was rejected by the customer and returned by ${driver}.\n` +
          (reason ? `Reason: ${reason}\n` : "") +
          `❌ تم رفض الطلب ${event.orderRef} من الزبون وإرجاعه.`,
      };
    }
  }
}

/** Map a driver scan to the notification event types it produces. */
function eventTypesForScan(event: DriverScanEvent): NotificationType[] {
  switch (event.semanticStatus) {
    case "delivered":
      return event.discrepancy !== 0
        ? ["DELIVERED", "PRICE_DISCREPANCY"]
        : ["DELIVERED"];
    case "postponed":
      return ["POSTPONED"];
    case "rejected":
      return ["REJECTED"];
  }
}

/**
 * Core dispatcher. Loads the merchant, applies preferences, writes in-app
 * rows, and sends WhatsApp. Throws only for programming errors; the
 * fire-and-forget wrapper below is what production call sites should use.
 */
export async function dispatchDriverScanEvent(
  event: DriverScanEvent,
): Promise<void> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: event.merchantId },
    select: { id: true, phone: true, notificationPreferences: true },
  });
  if (!merchant) return;

  const prefs: NotificationPreferences = normalizeMerchantPreferences(
    merchant.notificationPreferences,
  );

  const types = eventTypesForScan(event).filter(
    (type) => prefs.events[type],
  );
  if (types.length === 0) return;

  const contents = types.map((type) => buildEventContent(event, type));

  // ── In-app rows (bell dropdown) ──────────────────────────────────────────
  if (prefs.channels.inApp) {
    await prisma.notification.createMany({
      data: types.map((type, i) => ({
        merchantId: merchant.id,
        orderId: event.orderId,
        type,
        title: contents[i].title,
        message: contents[i].message,
        meta: {
          orderRef: event.orderRef,
          driverName: event.driverName,
          reasonCode: event.reasonCode,
          reasonText: event.reasonText,
          expectedCod: event.expectedCod,
          actualCodCollected: event.actualCodCollected,
          discrepancy: event.discrepancy,
        },
      })),
    });
  }

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  // A delivered-with-discrepancy scan produces two event types; send ONE
  // consolidated message (the discrepancy text already confirms delivery)
  // instead of spamming the merchant with two.
  if (prefs.channels.whatsapp && merchant.phone) {
    const whatsappBody =
      types.includes("PRICE_DISCREPANCY") && types.includes("DELIVERED")
        ? contents[types.indexOf("PRICE_DISCREPANCY")].whatsapp
        : contents.map((c) => c.whatsapp).join("\n\n");
    await sendWhatsAppMessage({ to: merchant.phone, message: whatsappBody });
  }
}

/**
 * Fire-and-forget entry point for API routes. Notification delivery must
 * never affect the order mutation response, so every error is swallowed and
 * logged.
 */
export function fireAndForgetDriverScanNotification(
  event: DriverScanEvent,
): void {
  dispatchDriverScanEvent(event).catch((error) => {
    console.error(
      `[notifications] Dispatch failed for order ${event.orderRef}:`,
      error instanceof Error ? error.message : error,
    );
  });
}
