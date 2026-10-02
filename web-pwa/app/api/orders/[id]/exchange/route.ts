import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createExchangeOrderFromDelivered } from "@/lib/exchange";
import { requireServerPermission } from "@/lib/server-permissions";

/**
 * POST /api/orders/:id/exchange
 *
 * Manually creates the "<orderId>-Exchange" proof order for an order whose
 * exchange (return) item arrived BEFORE the order itself was delivered.
 *
 * This reuses the exact same generator as the automatic delivery flow
 * (lib/exchange.ts), so the proof order is identical: $0 amounts, location
 * RETURN, financial status EWD, with a history entry. Because that generator
 * is idempotent (it first checks whether "<orderId>-Exchange" already exists),
 * delivering the main order later will NOT create a duplicate — the automatic
 * flow finds this row and skips.
 *
 * Access: ACTION_ORDER_EXCHANGE — a dedicated, admin-assignable permission so
 * the return lifecycle (ACTION_ORDER_RETURN) and manual exchange-order
 * creation can be granted independently.
 *
 * Responses:
 *  - 201 { created: true,  order } — proof order just created
 *  - 200 { alreadyExists: true, order } — an "-Exchange" order already exists
 *      (created earlier via this button or by the delivery flow)
 *  - 400 { error } — the order has no exchange flag, or is itself a proof order
 *  - 401/403 — auth/permission failures
 *  - 404 — order not found
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "ACTION_ORDER_EXCHANGE");
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Proof orders are terminal artifacts — they can never be the source of
  // another exchange order (would produce "X-Exchange-Exchange").
  if (order.orderId.toLowerCase().endsWith("-exchange")) {
    return NextResponse.json(
      {
        error:
          "This order is itself an exchange proof order and cannot generate another exchange.",
      },
      { status: 400 },
    );
  }

  if (!order.hasExchange) {
    return NextResponse.json(
      {
        error: `Order ${order.orderId} has no exchange (the exchange flag is not checked).`,
      },
      { status: 400 },
    );
  }

  const created = await createExchangeOrderFromDelivered(order, auth.user.id);

  if (!created) {
    // Idempotency guard tripped: an "-Exchange" order already exists for this
    // order (created earlier via this button or by the delivery flow).
    const existing = await prisma.order.findUnique({
      where: { orderId: `${order.orderId}-Exchange` },
      select: {
        id: true,
        orderId: true,
        location: true,
        financialStatus: true,
      },
    });
    return NextResponse.json({ alreadyExists: true, order: existing });
  }

  return NextResponse.json(
    {
      created: true,
      order: {
        id: created.id,
        orderId: created.orderId,
        location: created.location,
        financialStatus: created.financialStatus,
      },
    },
    { status: 201 },
  );
}
