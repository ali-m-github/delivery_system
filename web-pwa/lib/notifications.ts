const TRACKING_BASE =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

function getStatusMessage(status: string, orderId: string): string | null {
  const trackingUrl = `${TRACKING_BASE}/track/${orderId}`;

  switch (status) {
    case "WITH_DRIVER":
      return `Hi! Your order #${orderId} is out for delivery and will arrive soon. Track it here: ${trackingUrl}`;
    case "DELIVERED":
      return `Great news! Your order #${orderId} has been successfully delivered. Thank you!`;
    case "POSTPONED":
      return `Update: Your delivery for order #${orderId} has been rescheduled. Check your tracking link for details.`;
    default:
      return null;
  }
}

/**
 * Fires a notification when an order's status changes.
 * Intended to be called without await so the calling API route returns immediately.
 */
export async function notifyCustomerStatusChange(
  orderId: string,
  newStatus: string,
  customerPhone: string,
): Promise<void> {
  const message = getStatusMessage(newStatus, orderId);
  if (!message) return;

  // Colored console output for the admin to see in the terminal.
  // \x1b[36m = cyan, \x1b[33m = yellow, \x1b[0m = reset
  console.log("\x1b[36m=== NOTIFICATION ENGINE \x1b[0m");
  console.log(`\x1b[33mOrder:\x1b[0m  #${orderId}`);
  console.log(`\x1b[33mStatus:\x1b[0m ${newStatus}`);
  console.log(`\x1b[33mPhone:\x1b[0m  ${customerPhone}`);
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
