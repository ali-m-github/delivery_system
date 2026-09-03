import prisma from "@/lib/prisma";

/**
 * Shared fields of an Order needed to build the "-Exchange" proof order.
 */
export type ExchangeSourceOrder = {
  id: string;
  orderId: string;
  hasExchange: boolean;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  zoneId: string;
  merchantId: string | null;
  driverId: string | null;
  amountUsd: number;
  amountLbp: number;
  packages: number;
  extraShipping: number;
  notes: string | null;
};

/**
 * Idempotently creates an "-Exchange" proof order when an exchange order is
 * delivered. The exchange order duplicates the main order's details but NEVER
 * holds a price (amountUsd/Lbp = 0 — the COD value belongs to the main order,
 * which is already settled) nor collected columns (collectedUsd/Lbp = 0), and
 * is created in location RETURN with financial status EWD (Exchange With
 * Driver). Because it is never DELIVERED and carries no price, it has no
 * impact on any financial transaction — it exists purely as proof that an item
 * is being returned to the merchant (resolving it in a cash payout deducts $0).
 *
 * Returns the created exchange order, or null when the source order is not an
 * exchange or an "-Exchange" order already exists (idempotency guard).
 */
export async function createExchangeOrderFromDelivered(
  main: ExchangeSourceOrder,
  actionUserId: string,
) {
  if (!main.hasExchange) return null;

  const exchangeOrderId = `${main.orderId}-Exchange`;

  // Idempotency guard: never create a duplicate exchange order on retries
  const existing = await prisma.order.findUnique({
    where: { orderId: exchangeOrderId },
    select: { id: true },
  });
  if (existing) return null;

  const exchangeOrder = await prisma.order.create({
    data: {
      orderId: exchangeOrderId,
      customerName: main.customerName,
      customerPhone: main.customerPhone,
      customerAddress: main.customerAddress,
      zoneId: main.zoneId,
      merchantId: main.merchantId,
      driverId: main.driverId,
      hasExchange: true,
      // Exchange proof orders carry NO price: the COD amount belongs to the main
      // order (already settled), so resolving the exchange in a payout deducts $0.
      amountUsd: 0,
      amountLbp: 0,
      packages: main.packages,
      extraShipping: main.extraShipping,
      notes: main.notes,
      // Exchange proof orders never hold collected columns and never impact financials
      collectedUsd: 0,
      collectedLbp: 0,
      location: "RETURN",
      financialStatus: "EWD",
      creatorId: actionUserId,
      history: {
        create: {
          action: `Exchange order created from delivered order ${main.orderId}`,
          location: "RETURN",
          userId: actionUserId,
        },
      },
    },
  });

  return exchangeOrder;
}
