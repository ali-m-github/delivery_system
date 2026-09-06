import { maskPhone } from "@/lib/pii";

// ──────────────────────────────────────────────
// Notification base-URL resolution.
//
// Root-cause fix: this used to be
//   `process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"`
// which silently shipped *localhost* tracking links to real customers in
// production whenever the env var was missing. That is now fail-closed:
//   - production + missing var  → no base URL (links are omitted and the
//     misconfiguration is logged loudly exactly once)
//   - development + missing var → localhost (expected in local dev)
// ──────────────────────────────────────────────

let baseWarned = false;

function getTrackingBase(): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (base) return base;

  if (process.env.NODE_ENV === "production") {
    if (!baseWarned) {
      baseWarned = true;
      console.error(
        "[notifications] NEXT_PUBLIC_BASE_URL is not set — tracking links are " +
          "disabled until it is configured. Notifications that need a link will be skipped.",
      );
    }
    return null;
  }

  return "http://localhost:3000";
}

function getStatusMessage(
  status: string,
  orderId: string,
  trackToken?: string | null,
): string | null {
  const base = getTrackingBase();

  // The only status that needs a tracking link; if no base URL is
  // configured (production misconfiguration), skip rather than sending a
  // broken/localhost link to a customer.
  if (status === "WITH_DRIVER" && !base) return null;

  const trackingUrl = base
    ? trackToken
      ? `${base}/track/${trackToken}/${orderId}`
      : `${base}/track/${orderId}`
    : null;

  switch (status) {
    case "WITH_DRIVER":
      return `Hi! Your order ${orderId} is out for delivery and will arrive soon. Track it here: ${trackingUrl}`;
    case "DELIVERED":
      return `Great news! Your order ${orderId} has been successfully delivered. Thank you!`;
    case "POSTPONED":
      return `Update: Your delivery for order ${orderId} has been rescheduled. Check your tracking link for details.`;
    default:
      return null;
  }
}

/**
 * Fires a notification when an order's status changes.
 * Intended to be called without await so the calling API route returns immediately.
 *
 * PII note: logs must never contain the full customer phone number — it is
 * masked via lib/pii before hitting the console.
 */
export async function notifyCustomerStatusChange(
  orderId: string,
  newStatus: string,
  customerPhone: string,
  trackToken?: string | null,
): Promise<void> {
  const message = getStatusMessage(newStatus, orderId, trackToken);
  if (!message) return;

  // Colored console output for the admin to see in the terminal.
  // \x1b[36m = cyan, \x1b[33m = yellow, \x1b[0m = reset
  console.log("\x1b[36m=== NOTIFICATION ENGINE \x1b[0m");
  console.log(`\x1b[33mOrder:\x1b[0m  ${orderId}`);
  console.log(`\x1b[33mStatus:\x1b[0m ${newStatus}`);
  console.log(`\x1b[33mPhone:\x1b[0m  ${maskPhone(customerPhone)}`);
  console.log(`\x1b[33mMessage:\x1b[0m ${message}`);
  console.log("\x1b[36m=======================\n\x1b[0m");

  // Future: Replace this with a real SMS / webhook call.
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  /*
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status: newStatus, phone: customerPhone, message }),
    });
  }
  */
}
