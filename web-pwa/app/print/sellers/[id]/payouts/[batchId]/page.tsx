export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import Script from "next/script";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceLine {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  zoneName: string;
  createdAt: string;
  collectedUsd: number;
  collectedLbp: number;
  shippingUsd: number;
  netToSeller: number;
  type: "advance" | "return";
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
          sellerNumber: true,
          phone: true,
          address: true,
        },
      },
      orders: {
        include: {
          zone: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      resolvedReturns: {
        include: {
          zone: { select: { name: true } },
        },
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

  // ── Build line items ──
  const orderLines: InvoiceLine[] = batch.orders.map((o) => ({
    id: o.id,
    orderId: o.orderId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerAddress: o.customerAddress,
    zoneName: o.zone?.name ?? "—",
    createdAt: o.createdAt.toISOString(),
    collectedUsd: o.collectedUsd ?? 0,
    collectedLbp: o.collectedLbp ?? 0,
    shippingUsd: o.amountUsd ?? 0,
    netToSeller: (o.collectedUsd ?? 0) - (o.amountUsd ?? 0),
    type: "advance",
  }));

  const returnLines: InvoiceLine[] = batch.resolvedReturns.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerAddress: r.customerAddress,
    zoneName: r.zone?.name ?? "—",
    createdAt: r.createdAt.toISOString(),
    collectedUsd: r.collectedUsd ?? 0,
    collectedLbp: r.collectedLbp ?? 0,
    shippingUsd: r.amountUsd ?? 0,
    netToSeller: 0,
    type: "return",
  }));

  const adjustments: InvoiceAdjustment[] = batch.adjustments.map((a) => ({
    id: a.id,
    description: a.description,
    amountUsd: a.amountUsd,
    amountLbp: a.amountLbp,
    createdAt: a.createdAt.toISOString(),
  }));

  // ── Computed totals ──
  const totalCollectedUsd = orderLines.reduce((s, o) => s + o.collectedUsd, 0);
  const totalShippingUsd = orderLines.reduce((s, o) => s + o.shippingUsd, 0);
  const grossAdvance = orderLines.reduce((s, o) => s + o.netToSeller, 0);
  const totalReturnsDeduction = returnLines.reduce(
    (s, r) => s + (r.collectedUsd - r.shippingUsd),
    0,
  );
  const adjustmentsTotal = adjustments.reduce((s, a) => s + a.amountUsd, 0);
  const netPaid = grossAdvance - totalReturnsDeduction + adjustmentsTotal;

  return (
    <html>
      <head>
        <Script
          id="print-trigger"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.onload = () => window.print();`,
          }}
        />
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
          .type-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
          .type-advance { background: #dbeafe; color: #1e40af; }
          .type-return { background: #fce4ec; color: #c62828; }
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
      </head>
      <body>
        <div className="no-print">
          <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
        </div>

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
            {batch.merchant.sellerNumber && (
              <span> (Seller #{batch.merchant.sellerNumber})</span>
            )}
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
                <th style={{ width: "14%" }}>Order ID</th>
                <th style={{ width: "18%" }}>Customer</th>
                <th style={{ width: "8%" }}>Date</th>
                <th style={{ width: "8%" }}>Zone</th>
                <th className="right" style={{ width: "13%" }}>
                  Collected $
                </th>
                <th className="right" style={{ width: "13%" }}>
                  Shipping $
                </th>
                <th className="right" style={{ width: "13%" }}>
                  Net to Seller
                </th>
                <th style={{ width: "5%" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {[...orderLines, ...returnLines].map((line, idx) => (
                <tr key={line.id} className={idx % 2 === 0 ? "even" : ""}>
                  <td
                    style={{
                      fontFamily: "'Courier New', monospace",
                      fontSize: 10,
                    }}
                  >
                    #{line.orderId}
                  </td>
                  <td style={{ fontSize: 10 }}>{line.customerName}</td>
                  <td style={{ fontSize: 10 }}>{formatDate(line.createdAt)}</td>
                  <td style={{ fontSize: 10 }}>{line.zoneName}</td>
                  <td className="right">{currency(line.collectedUsd)}</td>
                  <td className="right">{currency(line.shippingUsd)}</td>
                  <td className="right">
                    {line.type === "advance" ? currency(line.netToSeller) : "—"}
                  </td>
                  <td>
                    <span
                      className={`type-badge ${line.type === "advance" ? "type-advance" : "type-return"}`}
                    >
                      {line.type === "advance" ? "ADV" : "RET"}
                    </span>
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
                  Total Collected (COD):
                </td>
                <td className="right" style={{ width: "40%" }}>
                  {currency(totalCollectedUsd)}
                </td>
              </tr>
              <tr>
                <td style={{ textAlign: "right" }}>
                  Total Shipping Fees Deducted:
                </td>
                <td className="right">−{currency(totalShippingUsd)}</td>
              </tr>
              <tr>
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  Gross Advance:
                </td>
                <td
                  className="right"
                  style={{ fontWeight: 600, borderTop: "1px solid #222" }}
                >
                  {currency(grossAdvance)}
                </td>
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
              <tr className="total-row">
                <td
                  style={{ textAlign: "right", fontSize: 14, fontWeight: 700 }}
                >
                  Net Payout:
                </td>
                <td
                  className="right"
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: netPaid >= 0 ? "#15803d" : "#dc2626",
                  }}
                >
                  {currency(netPaid)}
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
            · Batch {batch.batchReference} · This is a computer-generated
            invoice.
          </div>
        </div>
      </body>
    </html>
  );
}
