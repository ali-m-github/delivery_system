import prisma from "@/lib/prisma";
import {
  computeOrderCommission,
  loadDriverRateTable,
  type DriverRateTable,
} from "@/lib/commission";
import { PdfDownloadTrigger } from "./PdfDownloadTrigger";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// ─── Types ────────────────────────────────────────────────────────────────────
interface EnrichedOrder {
  id: string;
  orderId: string;
  seller: string;
  dateReceived: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  price: number;
  shippingRate: number;
  driverCommission: number;
  netPayout: number;
  profit: number;
}

// ─── Helper ────────────────────────────────────────────────────────────────────
function formatDate(value: Date | string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

// ─── Server Component ─────────────────────────────────────────────────────────
export default async function PrintOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    ids?: string;
    driverId?: string;
    payoutId?: string;
    simple?: string;
    pdf?: string;
  }>;
}) {
  const { ids, driverId, payoutId, simple, pdf } = await searchParams;

  if (!ids) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        No order IDs provided in the URL (?ids=1,2,3).
      </div>
    );
  }

  const orderIds = ids.split(",").filter(Boolean);

  // ── Fetch driver rate table if driverId is present (Driver-Mode) ──
  // Uses the authoritative commission module (seller exception ∪ cash-seller
  // exception → zone → $0 default), identical to every ledger path.
  let driverRateTable: DriverRateTable | null = null;
  if (driverId) {
    driverRateTable = await loadDriverRateTable(prisma, driverId);
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
        select: { id: true, userId: true },
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

  // Default mode: one rate table per distinct assigned driver (batch, no N+1
  // per order).
  const tableByDriver = new Map<string, DriverRateTable>();
  if (!isDriverMode) {
    const driverIds = Array.from(
      new Set(orders.map((o) => o.driver?.id).filter(Boolean) as string[]),
    );
    const loaded = await Promise.all(
      driverIds.map((did) => loadDriverRateTable(prisma, did)),
    );
    loaded.forEach((table) => tableByDriver.set(table.profileId, table));
  }

  const enrichedOrders: EnrichedOrder[] = orders.map((order) => {
    // Shipping rate: order-specific override → merchant default → 0
    const shippingRate =
      order.extraShipping && order.extraShipping > 0
        ? order.extraShipping
        : (order.merchant?.defaultSellerRate ?? 0);

    // Driver commission calculation — authoritative 3-tier precedence:
    // seller exception (cash wins, $0 valid) → zone rate → $0 default.
    let driverCommission = 0;

    if (isDriverMode && driverRateTable) {
      // Driver-Mode: use the specified driver's rates
      driverCommission = computeOrderCommission(driverRateTable, {
        merchantId: order.merchantId,
        zoneId: order.zoneId,
      }).usd;
    } else if (order.driver) {
      // Default mode: use the order's assigned driver's rates
      const driverTable = tableByDriver.get(order.driver.id);
      if (driverTable) {
        driverCommission = computeOrderCommission(driverTable, {
          merchantId: order.merchantId,
          zoneId: order.zoneId,
        }).usd;
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
      seller:
        order.merchant?.merchantName || order.merchant?.contactName || "—",
      dateReceived: formatDate(order.createdAt),
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

  // ── "simple" mode: used from the Orders page — hides financial columns ──
  const isSimple = simple === "true";

  // ── Profit column visibility ──
  // Profit is a company-internal figure: it must never appear on documents
  // given to drivers (driver mode or payout context), nor in "simple" mode.
  // The record itself stays in the DB and is surfaced in the admin panel
  // (Profit tab: per seller and per driver) via /api/admin/profit.
  const isDriverFacing = isDriverMode || !!payoutId;
  const showProfit =
    !isSimple &&
    !isDriverFacing &&
    orders.some((o) => o.merchant?.isCashSeller);

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
    <>
      {pdf === "true" && <PdfDownloadTrigger />}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
        thead { display: table-header-group; }
        /* Render the footer as a plain row group: table-footer-group makes
           the browser pin/repeat the Totals row at the bottom of every page,
           which overlaps the last data row when the table ends at the page edge. */
        tfoot { display: table-row-group; }
      `,
        }}
      />
      <div id="print-container" className="p-6 max-w-[1400px] mx-auto">
      {/* Print-only header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-black">
          {isSimple
            ? "Orders Summary"
            : isDriverMode
              ? "Driver Orders Export"
              : "Orders Export"}
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
            {isSimple && (
              <>
                <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-center">
                  Seller
                </th>
                <th className="border-2 border-gray-800 bg-gray-200 text-black p-1.5 font-bold text-center">
                  Date Received
                </th>
              </>
            )}
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
            {!isSimple && (
              <>
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
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {enrichedOrders.map((o) => (
            <tr key={o.id} className="even:bg-gray-50">
              <td className="border border-gray-800 p-1.5 text-center text-black font-mono">
                {o.orderId}
              </td>
              {isSimple && (
                <>
                  <td className="border border-gray-800 p-1.5 text-center text-black">
                    {o.seller}
                  </td>
                  <td className="border border-gray-800 p-1.5 text-center text-black">
                    {o.dateReceived}
                  </td>
                </>
              )}
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
              {!isSimple && (
                <>
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
                </>
              )}
            </tr>
          ))}
        </tbody>
        {/* Summary footer */}
        <tfoot>
          <tr className="bg-gray-100 font-bold">
            <td
              colSpan={isSimple ? 6 : 4}
              className="border-2 border-gray-800 p-1.5 text-right text-black"
            >
              Totals ({enrichedOrders.length} orders):
            </td>
            <td className="border-2 border-gray-800 p-1.5 text-right text-black font-mono">
              ${totals.price.toFixed(2)}
            </td>
            {!isSimple && (
              <>
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
              </>
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
    </>
  );
}
