export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { ManifestPrintButton } from "./ManifestPrintButton";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ManifestRow {
  id: string;
  orderId: string;
  seller: string;
  dateReceived: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  zone: string;
  driver: string;
  financialStatus: string;
  amountUsd: number;
  isCashSeller: boolean;
  sellerRate: number;
  moneyRequiredUsd: number;
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

function currency(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

// ─── Server Component ─────────────────────────────────────────────────────────
export default async function PrintRtsManifestPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;

  if (!ids) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        No order IDs provided in the URL (?ids=1,2,3).
      </div>
    );
  }

  const orderIds = ids.split(",").filter(Boolean);

  // ── Fetch selected return orders with merchant/seller details ──
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      merchant: true,
      zone: true,
      driver: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (orders.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        No matching orders found.
      </div>
    );
  }

  // ── Build manifest rows ──
  // Seller delivery rate: order-specific override → merchant default → 0.
  // For cash sellers, the amount required from the seller per order is the
  // order value minus the seller's delivery rate (shown as a negative amount,
  // i.e. money owed to the delivery company).
  const rows: ManifestRow[] = orders.map((order) => {
    const isCashSeller = order.merchant?.isCashSeller ?? false;
    const sellerRate =
      order.extraShipping && order.extraShipping > 0
        ? order.extraShipping
        : (order.merchant?.defaultSellerRate ?? 0);
    const amountUsd = order.amountUsd ?? 0;
    const moneyRequiredUsd = isCashSeller ? amountUsd - sellerRate : 0;

    return {
      id: order.id,
      orderId: order.orderId,
      seller:
        order.merchant?.merchantName || order.merchant?.contactName || "—",
      dateReceived: formatDate(order.createdAt),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      zone: order.zone?.name || order.zoneId || "—",
      driver: order.driver
        ? `${order.driver.firstName} ${order.driver.lastName}`
        : "—",
      financialStatus: order.financialStatus,
      amountUsd,
      isCashSeller,
      sellerRate,
      moneyRequiredUsd,
    };
  });

  const hasCashSeller = rows.some((r) => r.isCashSeller);
  const totalAmountUsd = rows.reduce((s, r) => s + r.amountUsd, 0);
  const totalMoneyRequiredUsd = rows.reduce(
    (s, r) => s + (r.isCashSeller ? r.moneyRequiredUsd : 0),
    0,
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @page { margin: 15mm 10mm; size: A4 portrait; }
        body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; margin: 0; padding: 0; }
        .manifest-wrap { max-width: 1100px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 22px; font-weight: 800; margin: 0 0 4px 0; }
        .subtitle { font-size: 12px; color: #666; margin-bottom: 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
        th { background: #222; color: #fff; padding: 8px 6px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
        th.right { text-align: right; }
        td { padding: 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
        td.right { text-align: right; font-family: 'Courier New', monospace; }
        tr.even { background: #f9f9f9; }
        .cash-badge { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: #b45309; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 4px; padding: 1px 5px; }
        .summary-table { width: auto; min-width: 340px; margin-left: auto; }
        .summary-table td { padding: 5px 10px; }
        .summary-table tr.total-row td { font-weight: 700; border-top: 2px solid #222; padding-top: 8px; }
        .summary-table tr.final-row td { font-weight: 800; font-size: 14px; border-top: 3px double #222; padding-top: 8px; color: #1e40af; }
        .summary-table tr.final-row td:last-child { font-size: 16px; }
        .footer { font-size: 10px; color: #888; text-align: center; margin-top: 26px; padding-top: 12px; border-top: 1px solid #ddd; }
        .no-print { display: block; }
        @media print { .no-print { display: none !important; } }
      `}</style>

      <ManifestPrintButton />

      <div className="manifest-wrap">
        {/* ── Header ── */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1>RTS Manifest</h1>
            <div className="subtitle">
              {rows.length} return order{rows.length !== 1 ? "s" : ""} ·
              Generated{" "}
              {new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </div>
          </div>
        </div>

        {/* ── Orders table ── */}
        <table>
          <thead>
            <tr>
              <th style={{ width: "11%" }}>Order ID</th>
              <th style={{ width: "12%" }}>Seller</th>
              <th style={{ width: "8%" }}>Date</th>
              <th style={{ width: "12%" }}>Customer</th>
              <th style={{ width: "11%" }}>Phone</th>
              <th style={{ width: "13%" }}>Address</th>
              <th style={{ width: "7%" }}>Zone</th>
              <th style={{ width: "9%" }}>Driver</th>
              <th style={{ width: "5%" }}>Status</th>
              <th className="right" style={{ width: "6%" }}>
                Amount $
              </th>
              <th className="right" style={{ width: "6%" }}>
                Rate $
              </th>
              <th className="right" style={{ width: "8%" }}>
                Req. from Seller $
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id} className={idx % 2 === 0 ? "even" : ""}>
                <td
                  style={{
                    fontFamily: "'Courier New', monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                  }}
                >
                  #{r.orderId}
                </td>
                <td style={{ fontSize: 11 }}>
                  {r.seller}
                  {r.isCashSeller && (
                    <span className="cash-badge" style={{ marginLeft: 4 }}>
                      Cash
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 11 }}>{r.dateReceived}</td>
                <td style={{ fontSize: 11 }}>{r.customerName || "—"}</td>
                <td style={{ fontSize: 11 }}>{r.customerPhone || "—"}</td>
                <td style={{ fontSize: 11 }}>{r.customerAddress || "—"}</td>
                <td style={{ fontSize: 11 }}>{r.zone}</td>
                <td style={{ fontSize: 11 }}>{r.driver}</td>
                <td style={{ fontSize: 11 }}>{r.financialStatus}</td>
                <td className="right">{currency(r.amountUsd)}</td>
                <td className="right">
                  {r.isCashSeller ? currency(r.sellerRate) : "—"}
                </td>
                <td
                  className="right"
                  style={{ color: r.isCashSeller ? "#dc2626" : "#999" }}
                >
                  {r.isCashSeller ? `-${currency(r.moneyRequiredUsd)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Summary ── */}
        <table className="summary-table">
          <tbody>
            <tr>
              <td style={{ textAlign: "right", width: "60%" }}>
                Total Order Amount (COD):
              </td>
              <td className="right" style={{ width: "40%" }}>
                {currency(totalAmountUsd)}
              </td>
            </tr>
            {hasCashSeller && (
              <>
                <tr>
                  <td style={{ textAlign: "right" }}>
                    Total Seller Delivery Rates Deducted:
                  </td>
                  <td className="right">
                    −
                    {currency(
                      rows.reduce(
                        (s, r) => s + (r.isCashSeller ? r.sellerRate : 0),
                        0,
                      ),
                    )}
                  </td>
                </tr>
                <tr className="final-row">
                  <td
                    style={{
                      textAlign: "right",
                      fontSize: 16,
                      fontWeight: 800,
                    }}
                  >
                    Total Required from Seller:
                  </td>
                  <td
                    className="right"
                    style={{ fontSize: 18, fontWeight: 800, color: "#dc2626" }}
                  >
                    {currency(totalMoneyRequiredUsd)}
                  </td>
                </tr>
              </>
            )}
            {!hasCashSeller && (
              <tr className="total-row">
                <td
                  style={{ textAlign: "right", fontSize: 14, fontWeight: 700 }}
                >
                  Total Required from Seller:
                </td>
                <td className="right" style={{ fontSize: 14, fontWeight: 700 }}>
                  — (no cash sellers selected)
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="footer">
          RTS Manifest · Amounts in USD · Required-from-seller values are shown
          as negative per order and totaled in the summary above.
        </div>
      </div>
    </>
  );
}
