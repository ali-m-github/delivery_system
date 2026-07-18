import { PrismaClient } from "@prisma/client";
import { DEFAULT_DRIVER_USD } from "@/lib/commission";

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────
interface EnrichedOrder {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  price: number;
  shippingRate: number;
  driverCommission: number;
  netPayout: number;
  profit: number;
}

// ─── Server Component ─────────────────────────────────────────────────────────
export default async function PrintOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; driverId?: string; payoutId?: string }>;
}) {
  const { ids, driverId, payoutId } = await searchParams;

  if (!ids) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        No order IDs provided in the URL (?ids=1,2,3).
      </div>
    );
  }

  const orderIds = ids.split(",").filter(Boolean);

  // ── Fetch driver rates if driverId is present (Driver-Mode) ──
  let driverRates = null;
  if (driverId) {
    driverRates = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        driverSellerRates: true,
        zoneRates: true,
      },
    });
  }

  // ── Fetch payout context if payoutId is present (for debt display) ──
  let payoutContext = null;
  if (payoutId) {
    payoutContext = await prisma.driverPayout.findUnique({
      where: { id: payoutId },
      select: { previousDebtUsd: true, previousDebtLbp: true },
    });
  }

  // ── Fetch orders with all relations needed for financial calculations ──
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      merchant: true,
      driver: {
        include: {
          driverSellerRates: true,
          zoneRates: true,
        },
      },
      zone: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (orders.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        No matching orders found.
      </div>
    );
  }

  // ── Financial calculation logic ──────────────────────────────────────────
  const isDriverMode = !!driverId;

  const enrichedOrders: EnrichedOrder[] = orders.map((order) => {
    // Shipping rate: order-specific override → merchant default → 0
    const shippingRate =
      order.extraShipping && order.extraShipping > 0
        ? order.extraShipping
        : (order.merchant?.defaultSellerRate ?? 0);

    // Driver commission calculation
    let driverCommission = 0;

    if (isDriverMode && driverRates) {
      // Driver-Mode: Use the specified driver's rates
      // Tier 1: Seller-specific rate exception
      const exception = driverRates.driverSellerRates.find(
        (r) => r.merchantId === order.merchantId,
      );
      if (exception && Number(exception.rateUsd || 0) > 0) {
        driverCommission = Number(exception.rateUsd);
      } else {
        // Tier 2: Zone-based rate
        const zoneRate = driverRates.zoneRates.find(
          (r) => r.zoneId === order.zoneId,
        );
        driverCommission = Number(zoneRate?.rate || 0);
      }
    } else if (order.driver) {
      // Default mode: Use the order's assigned driver rates (3-tier hierarchy)
      driverCommission = DEFAULT_DRIVER_USD;

      // Tier 1: Driver-Seller flat rate exception
      if (order.merchantId) {
        const sellerException = order.driver.driverSellerRates.find(
          (r) => r.merchantId === order.merchantId,
        );
        if (sellerException && sellerException.rateUsd > 0) {
          driverCommission = sellerException.rateUsd;
        }
      }

      // Tier 2: Zone-based rate (only if no seller exception was found)
      if (driverCommission === DEFAULT_DRIVER_USD) {
        const zoneRate = order.driver.zoneRates.find(
          (r) => r.zoneId === order.zoneId,
        );
        if (zoneRate && zoneRate.rate > 0) {
          driverCommission = zoneRate.rate;
        }
      }
    }

    const price = order.amountUsd ?? 0;

    // In driver mode, netPayout is amount minus driver commission
    // In normal mode, netPayout is amount minus shipping rate
    const netPayout = isDriverMode
      ? price - driverCommission
      : price - shippingRate;
    const profit = shippingRate - driverCommission;

    return {
      id: order.id,
      orderId: order.orderId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      price,
      shippingRate,
      driverCommission,
      netPayout,
      profit,
    };
  });

  // ── Determine if any order belongs to a cash seller (for Profit column visibility) ──
  const showProfit = orders.some((o) => o.merchant?.isCashSeller);

  // ── Totals ───────────────────────────────────────────────────────────────
  const totals = enrichedOrders.reduce(
    (acc, o) => ({
      price: acc.price + o.price,
      shippingRate: acc.shippingRate + o.shippingRate,
      driverCommission: acc.driverCommission + o.driverCommission,
      netPayout: acc.netPayout + o.netPayout,
      profit: acc.profit + o.profit,
    }),
    { price: 0, shippingRate: 0, driverCommission: 0, netPayout: 0, profit: 0 },
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div id="print-container" className="p-6 max-w-[1400px] mx-auto">
      {/* Print-only header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-black">
          {isDriverMode ? "Driver Orders Export" : "Orders Export"}
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          {enrichedOrders.length} order
          {enrichedOrders.length !== 1 ? "s" : ""} · Generated{" "}
          {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>

      <table className="w-full border-collapse border-2 border-gray-800 text-xs">
        <thead>
          <tr>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-center">
              Order ID
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-center">
              Customer Name
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-center">
              Phone
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-center">
              Address
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-right">
              Order Amount
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-right">
              {isDriverMode ? "Commission" : "Shipping Rate"}
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-right">
              Net Payout
            </th>
            {showProfit && (
              <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-right">
                Profit
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {enrichedOrders.map((o) => (
            <tr key={o.id} className="even:bg-gray-50">
              <td className="border border-gray-800 p-1.5 text-center text-black font-mono">
                {o.orderId}
              </td>
              <td className="border border-gray-800 p-1.5 text-center text-black">
                {o.customerName || "—"}
              </td>
              <td className="border border-gray-800 p-1.5 text-center text-black">
                {o.customerPhone || "—"}
              </td>
              <td className="border border-gray-800 p-1.5 text-black text-xs max-w-[200px]">
                {o.customerAddress || "—"}
              </td>
              <td className="border border-gray-800 p-1.5 text-right text-black font-mono">
                ${o.price.toFixed(2)}
              </td>
              <td className="border border-gray-800 p-1.5 text-right text-black font-mono">
                $
                {isDriverMode
                  ? o.driverCommission.toFixed(2)
                  : o.shippingRate.toFixed(2)}
              </td>
              <td className="border border-gray-800 p-1.5 text-right text-black font-mono">
                ${o.netPayout.toFixed(2)}
              </td>
              {showProfit && (
                <td className="border border-gray-800 p-1.5 text-right text-black font-mono">
                  ${o.profit.toFixed(2)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {/* Summary footer */}
        <tfoot>
          <tr className="bg-gray-100 font-bold">
            <td
              colSpan={4}
              className="border-2 border-gray-800 p-1.5 text-right text-black"
            >
              Totals ({enrichedOrders.length} orders):
            </td>
            <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
              ${totals.price.toFixed(2)}
            </td>
            <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
              $
              {isDriverMode
                ? totals.driverCommission.toFixed(2)
                : totals.shippingRate.toFixed(2)}
            </td>
            <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
              ${totals.netPayout.toFixed(2)}
            </td>
            {showProfit && (
              <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
                ${totals.profit.toFixed(2)}
              </td>
            )}
          </tr>
          {/* Conditional Debt Row */}
          {payoutContext && payoutContext.previousDebtUsd > 0 && (
            <tr className="text-red-600 font-semibold">
              <td
                colSpan={6}
                className="border-2 border-gray-800 p-1.5 text-right pr-4"
              >
                Previous Debt / Due Amount:
              </td>
              <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
                + ${payoutContext.previousDebtUsd.toFixed(2)}
              </td>
              {showProfit && (
                <td className="border-2 border-gray-800 p-1.5"></td>
              )}
            </tr>
          )}
          {/* Conditional Final Net Row */}
          {payoutContext && payoutContext.previousDebtUsd > 0 && (
            <tr className="font-bold text-lg bg-gray-200">
              <td
                colSpan={6}
                className="border-2 border-gray-800 p-1.5 text-right pr-4"
              >
                Final Batch Net:
              </td>
              <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
                ${(totals.netPayout + payoutContext.previousDebtUsd).toFixed(2)}
              </td>
              {showProfit && (
                <td className="border-2 border-gray-800 p-1.5"></td>
              )}
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
