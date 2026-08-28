export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { PrintControls } from "./PrintControls";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceLine {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  createdAt: string;
  amountUsd: number;
  shippingUsd: number;
  netToSeller: number;
  type: "advance" | "return";
  financialStatus: string;
}

interface InvoiceAdjustment {
  id: number;
  description: string;
  amountUsd: number;
  amountLbp: number;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function currency(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

// ─── Server Component ─────────────────────────────────────────────────────────

export default async function PrintSellerInvoicePage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const { id: merchantId, batchId } = await params;
  const batchIdInt = parseInt(batchId, 10);

  if (isNaN(batchIdInt)) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        Invalid Batch ID
      </div>
    );
  }

  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { id: batchIdInt },
    include: {
      merchant: {
        select: {
          id: true,
          merchantName: true,
          merchantId: true,
          phone: true,
          address: true,
          defaultSellerRate: true,
          defaultProfitRate: true,
        },
      },
      orders: {
        orderBy: { createdAt: "asc" },
      },
      resolvedReturns: {
        orderBy: { createdAt: "asc" },
      },
      adjustments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        Batch Not Found
      </div>
    );
  }

  // Cash seller rate charged per order = seller rate + profit rate.
  // This is the shipping fee the seller is charged on each order.
  const cashSellerRate =
    (batch.merchant.defaultSellerRate ?? 4.0) +
    (batch.merchant.defaultProfitRate ?? 0);

  // ── Build line items ──
  const orderLines: InvoiceLine[] = batch.orders.map((o) => ({
    id: o.id,
    orderId: o.orderId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerAddress: o.customerAddress,
    createdAt: o.createdAt.toISOString(),
    amountUsd: o.amountUsd ?? 0,
    shippingUsd: cashSellerRate,
    netToSeller: (o.amountUsd ?? 0) - cashSellerRate,
    type: "advance",
    financialStatus: o.financialStatus,
  }));

  const returnLines: InvoiceLine[] = batch.resolvedReturns.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerAddress: r.customerAddress,
    createdAt: r.createdAt.toISOString(),
    amountUsd: r.amountUsd ?? 0,
    shippingUsd: cashSellerRate,
    netToSeller: (r.amountUsd ?? 0) - cashSellerRate,
    type: "return",
    financialStatus: r.financialStatus,
  }));

  const adjustments: InvoiceAdjustment[] = batch.adjustments.map((a) => ({
    id: a.id,
    description: a.description,
    amountUsd: a.amountUsd,
    amountLbp: a.amountLbp,
    createdAt: a.createdAt.toISOString(),
  }));

  // ── Computed totals ──
  const totalAmountUsd = orderLines.reduce((s, o) => s + o.amountUsd, 0);
  const totalShippingUsd = orderLines.reduce((s, o) => s + o.shippingUsd, 0);
  const grossAdvance = orderLines.reduce((s, o) => s + o.netToSeller, 0);
  const totalReturnsDeduction = returnLines.reduce(
    (s, r) => s + r.netToSeller,
    0,
  );
  const adjustmentsTotal = adjustments.reduce((s, a) => s + a.amountUsd, 0);
  const netPaid = grossAdvance - totalReturnsDeduction + adjustmentsTotal;

  return (
    <>
      <style>{`
          @page { margin: 15mm 10mm; size: A4 portrait; }
          body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; margin: 0; padding: 0; }
          .invoice-wrap { max-width: 1000px; margin: 0 auto; padding: 20px; }
          h1 { font-size: 22px; font-weight: 800; margin: 0 0 4px 0; }
          h2 { font-size: 14px; font-weight: 700; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px; color: #444; border-bottom: 2px solid #222; padding-bottom: 6px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px double #222; }
          .header-left { flex: 1; }
          .header-right { text-align: right; }
          .company-name { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
          .company-tagline { font-size: 11px; color: #666; margin-top: 2px; }
          .merchant-info { margin-bottom: 20px; padding: 12px 16px; background: #f5f5f5; border-radius: 6px; font-size: 13px; line-height: 1.6; }
          .merchant-info strong { font-weight: 700; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
          th { background: #222; color: #fff; padding: 8px 6px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
          th.right { text-align: right; }
          td { padding: 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
          td.right { text-align: right; font-family: 'Courier New', monospace; }
          tr.even { background: #f9f9f9; }
          .summary-table { width: auto; min-width: 320px; margin-left: auto; }
          .summary-table td { padding: 5px 10px; }
          .summary-table tr.total-row td { font-weight: 700; border-top: 2px solid #222; padding-top: 8px; }
          .summary-table tr.final-row td { font-weight: 800; font-size: 14px; border-top: 3px double #222; padding-top: 8px; color: #1e40af; }
          .summary-table tr.final-row td:last-child { font-size: 16px; }
          .adjustments-section { margin-bottom: 20px; }
          .adjustments-section p { font-size: 11px; color: #666; font-style: italic; }
          .footer { font-size: 10px; color: #888; text-align: center; margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; }
          .no-print { display: block; text-align: center; margin-bottom: 16px; }
          .no-print button { padding: 10px 24px; font-size: 14px; font-weight: 700; background: #1e40af; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
          @media print { .no-print { display: none !important; } }
        `}</style>
      <PrintControls />

      <div className="invoice-wrap">
        {/* ── Header ── */}
        <div className="header">
          <div className="header-left">
            <div className="company-name">Delivery Co.</div>
            <div className="company-tagline">
              Payout Statement — Seller Invoice
            </div>
          </div>
          <div className="header-right">
            <h1>INVOICE</h1>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <strong>Batch:</strong> {batch.batchReference}
            </div>
            <div style={{ fontSize: 12 }}>
              <strong>Date:</strong>{" "}
              {formatDateTime(batch.createdAt.toISOString())}
            </div>
          </div>
        </div>

        {/* ── Merchant Info ── */}
        <div className="merchant-info">
          <strong>Bill To:</strong> {batch.merchant.merchantName}
          <br />
          {batch.merchant.phone && (
            <>
              <strong>Phone:</strong> {batch.merchant.phone}
              <br />
            </>
          )}
          {batch.merchant.address && (
            <>
              <strong>Address:</strong> {batch.merchant.address}
              <br />
            </>
          )}
          <strong>Merchant ID:</strong> #{batch.merchant.merchantId}
        </div>

        {/* ── Orders Table ── */}
        <h2>Orders</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "13%" }}>Order ID</th>
              <th style={{ width: "14%" }}>Customer</th>
              <th style={{ width: "25%" }}>Address</th>
              <th style={{ width: "9%" }}>Date</th>
              <th className="right" style={{ width: "13%" }}>
                Amount $
              </th>
              <th className="right" style={{ width: "13%" }}>
                Shipping $
              </th>
              <th className="right" style={{ width: "13%" }}>
                Net to Seller
              </th>
            </tr>
          </thead>
          <tbody>
            {[...orderLines, ...returnLines].map((line, idx) => (
              <tr key={line.id} className={idx % 2 === 0 ? "even" : ""}>
                <td
                  style={{
                    fontFamily: "'Courier New', monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                  }}
                >
                  #{line.orderId}{line.type === "return" && line.financialStatus === "RTS" ? "R" : ""}
                </td>
                <td style={{ fontSize: 11 }}>{line.customerName}</td>
                <td style={{ fontSize: 11 }}>{line.customerAddress}</td>
                <td style={{ fontSize: 11 }}>{formatDate(line.createdAt)}</td>
                <td className="right">{currency(line.amountUsd)}</td>
                <td className="right">{currency(line.shippingUsd)}</td>
                <td className="right">
                  {line.type === "advance"
                    ? currency(line.netToSeller)
                    : `−${currency(line.netToSeller)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Adjustments ── */}
        {adjustments.length > 0 && (
          <div className="adjustments-section">
            <h2>Adjustments</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "5%" }}>#</th>
                  <th style={{ width: "55%" }}>Description</th>
                  <th className="right" style={{ width: "20%" }}>
                    Amount (USD)
                  </th>
                  <th style={{ width: "20%" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adj, idx) => (
                  <tr key={adj.id} className={idx % 2 === 0 ? "even" : ""}>
                    <td>{idx + 1}</td>
                    <td>{adj.description}</td>
                    <td
                      className="right"
                      style={{
                        color: adj.amountUsd >= 0 ? "#15803d" : "#dc2626",
                      }}
                    >
                      {adj.amountUsd >= 0 ? "+" : "−"}
                      {currency(adj.amountUsd)}
                    </td>
                    <td>{formatDate(adj.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Summary ── */}
        <h2>Summary</h2>
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
            <tr>
              <td style={{ textAlign: "right" }}>
                Total Shipping Fees Deducted:
              </td>
              <td className="right">−{currency(totalShippingUsd)}</td>
            </tr>
            {totalReturnsDeduction !== 0 && (
              <tr>
                <td style={{ textAlign: "right", color: "#dc2626" }}>
                  Return Deductions:
                </td>
                <td className="right" style={{ color: "#dc2626" }}>
                  −{currency(Math.abs(totalReturnsDeduction))}
                </td>
              </tr>
            )}
            {adjustmentsTotal !== 0 && (
              <tr>
                <td style={{ textAlign: "right" }}>Adjustments:</td>
                <td
                  className="right"
                  style={{
                    color: adjustmentsTotal >= 0 ? "#15803d" : "#dc2626",
                  }}
                >
                  {adjustmentsTotal >= 0 ? "+" : "−"}
                  {currency(Math.abs(adjustmentsTotal))}
                </td>
              </tr>
            )}
            <tr className="final-row">
              <td
                style={{
                  textAlign: "right",
                  fontSize: 16,
                  fontWeight: 800,
                }}
              >
                Net Paid to Seller:
              </td>
              <td
                className="right"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: netPaid >= 0 ? "#1e40af" : "#dc2626",
                }}
              >
                {currency(netPaid)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="footer">
          Generated on{" "}
          {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}{" "}
          · Batch {batch.batchReference} · This is a computer-generated invoice.
        </div>
      </div>
    </>
  );
}
