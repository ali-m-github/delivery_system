export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/server-permissions";
import { PrintControls } from "./PrintControls";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function currency(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

// ─── Server Component ─────────────────────────────────────────────────────────

export default async function PrintMerchantStatementInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // ── Authenticate the merchant from the session cookie ────────────────────
  // Verifies the session and loads the CURRENT user record from the database
  // (the role is not trusted from the stale 24-hour token claim).
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        Unauthorized
      </div>
    );
  }

  let merchantId = "";
  let merchantName = "";
  let authError: string | null = null;
  if (user.role !== "MERCHANT") {
    authError = "Forbidden";
  } else {
    const merchant = await prisma.merchant.findUnique({
      where: { userId: user.id },
      select: { id: true, merchantName: true },
    });
    if (!merchant) {
      authError = "No merchant profile linked to your account";
    } else {
      merchantId = merchant.id;
      merchantName = merchant.merchantName;
    }
  }

  if (authError) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        {authError}
      </div>
    );
  }

  // ── Fetch the statement, scoped to the authenticated merchant ────────────
  const statement = await prisma.merchantPayout.findFirst({
    where: { id, merchantId },
    include: {
      merchant: {
        include: { zoneRates: true },
      },
      orders: {
        include: { driver: true, zone: true },
      },
    },
  });

  if (!statement) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        Statement Not Found
      </div>
    );
  }

  const zoneRates = statement.merchant?.zoneRates || [];

  // ── Build line items (mirrors the merchant statement detail modal) ───────
  const lines = statement.orders.map((order: any) => {
    const rate = zoneRates.find(
      (zr: any) =>
        String(zr.zoneId) === String(order.zoneId) ||
        String(zr.zoneId) === String(order.zone?.name),
    );
    const shipUsd = rate?.rate ?? 0;
    const shipLbp = rate?.rateLbp ?? 0;
    const origUsd = order.amountUsd ?? 0;
    const origLbp = order.amountLbp ?? 0;
    const collUsd = order.collectedUsd ?? order.amountUsd ?? 0;
    const collLbp = order.collectedLbp ?? order.amountLbp ?? 0;
    return {
      id: order.id,
      orderId: order.orderId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      createdAt: order.createdAt?.toISOString?.() ?? "",
      origUsd,
      origLbp,
      collUsd,
      collLbp,
      shipUsd,
      shipLbp,
      netUsd: collUsd - shipUsd,
      netLbp: collLbp - shipLbp,
    };
  });

  const totalUsd = statement.totalUsd ?? 0;
  const totalLbp = statement.totalLbp ?? 0;
  const shippingUsd = statement.shippingUsd ?? 0;
  const shippingLbp = statement.shippingLbp ?? 0;
  const netUsd = statement.netUsd ?? 0;
  const netLbp = statement.netLbp ?? 0;

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
          .summary-table tr.final-row td { font-weight: 800; font-size: 14px; border-top: 3px double #222; padding-top: 8px; color: #1e40af; }
          .summary-table tr.final-row td:last-child { font-size: 16px; }
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
            <div className="company-tagline">Seller Statement — Invoice</div>
          </div>
          <div className="header-right">
            <h1>INVOICE</h1>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <strong>Statement:</strong> #{statement.sequentialIndex}
            </div>
            <div style={{ fontSize: 12 }}>
              <strong>Date:</strong>{" "}
              {formatDateTime(statement.createdAt.toISOString())}
            </div>
          </div>
        </div>

        {/* ── Merchant Info ── */}
        <div className="merchant-info">
          <strong>Bill To:</strong> {merchantName}
          <br />
          {statement.merchant?.phone && (
            <>
              <strong>Phone:</strong> {statement.merchant.phone}
              <br />
            </>
          )}
          {statement.merchant?.address && (
            <>
              <strong>Address:</strong> {statement.merchant.address}
              <br />
            </>
          )}
          <strong>Merchant ID:</strong> #{statement.merchant?.merchantId}
        </div>

        {/* ── Orders Table ── */}
        <h2>Orders</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "13%" }}>Order ID</th>
              <th style={{ width: "16%" }}>Customer</th>
              <th style={{ width: "22%" }}>Address</th>
              <th className="right" style={{ width: "11%" }}>
                Orig $
              </th>
              <th className="right" style={{ width: "12%" }}>
                Collected $
              </th>
              <th className="right" style={{ width: "12%" }}>
                Shipping $
              </th>
              <th className="right" style={{ width: "14%" }}>
                Net $
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={line.id} className={idx % 2 === 0 ? "even" : ""}>
                <td
                  style={{
                    fontFamily: "'Courier New', monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                  }}
                >
                  #{line.orderId}
                </td>
                <td style={{ fontSize: 11 }}>{line.customerName}</td>
                <td style={{ fontSize: 11 }}>{line.customerAddress}</td>
                <td className="right">{currency(line.origUsd)}</td>
                <td className="right">{currency(line.collUsd)}</td>
                <td className="right">−{currency(line.shipUsd)}</td>
                <td className="right">{currency(line.netUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Summary ── */}
        <h2>Summary</h2>
        <table className="summary-table">
          <tbody>
            <tr>
              <td style={{ textAlign: "right", width: "60%" }}>
                Gross Cash Collected:
              </td>
              <td className="right" style={{ width: "40%" }}>
                {currency(totalUsd)}
                {totalLbp > 0 && (
                  <span style={{ color: "#666", fontSize: 11 }}>
                    {" "}
                    | {totalLbp.toLocaleString()} LL
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ textAlign: "right" }}>
                Shipping Costs Deducted:
              </td>
              <td className="right">
                −{currency(shippingUsd)}
                {shippingLbp > 0 && (
                  <span style={{ color: "#666", fontSize: 11 }}>
                    {" "}
                    | −{shippingLbp.toLocaleString()} LL
                  </span>
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
                Net Cash Disbursed:
              </td>
              <td
                className="right"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: netUsd >= 0 ? "#1e40af" : "#dc2626",
                }}
              >
                {currency(netUsd)}
                {netLbp > 0 && (
                  <span style={{ color: "#666", fontSize: 12 }}>
                    {" "}
                    | {netLbp.toLocaleString()} LL
                  </span>
                )}
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
          · Statement #{statement.sequentialIndex} · This is a
          computer-generated invoice.
        </div>
      </div>
    </>
  );
}
