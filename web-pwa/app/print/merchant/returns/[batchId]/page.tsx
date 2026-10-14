export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/server-permissions";
import { getReasonLabel } from "@/lib/driver-reasons";
import { PrintControls } from "./PrintControls";
import { PdfDownloadTrigger } from "../../../orders/PdfDownloadTrigger";

// ─── Return Batch Manifest (bilingual EN/AR) ─────────────────────────────────
// Prints the handoff manifest for a Return-to-Seller batch: company header,
// merchant info, per-order table (#, Order ID, Recipient, Phone, Original COD,
// Return Reason) and signature lines for the driver and the seller.

// All manifest dates/times are displayed in Beirut local time (Asia/Beirut),
// independent of the server's timezone.
const BEIRUT_TZ = "Asia/Beirut";

function beirutDateParts(d: Date): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BEIRUT_TZ,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  return {
    day: Number(parts.find((p) => p.type === "day")?.value ?? 0),
    month: Number(parts.find((p) => p.type === "month")?.value ?? 0),
    year: Number(parts.find((p) => p.type === "year")?.value ?? 0),
  };
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const { day, month, year } = beirutDateParts(d);
  const date = `${day}/${month}/${year}`;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BEIRUT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return `${date} ${time}`;
}

function currency(amount: number | null): string {
  return amount == null ? "—" : `$${amount.toFixed(2)}`;
}

export default async function PrintMerchantReturnBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;

  // ── Authenticate the merchant from the session cookie ────────────────────
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        Unauthorized
      </div>
    );
  }

  let merchantId = "";
  let authError: string | null = null;
  if (user.role !== "MERCHANT") {
    authError = "Forbidden";
  } else {
    const merchant = await prisma.merchant.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!merchant) {
      authError = "No merchant profile linked to your account";
    } else {
      merchantId = merchant.id;
    }
  }

  if (authError) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        {authError}
      </div>
    );
  }

  // ── Fetch the batch, scoped to the authenticated merchant ────────────────
  const batch = await prisma.returnBatch.findFirst({
    where: { id: batchId, merchantId },
    include: {
      merchant: {
        select: {
          id: true,
          merchantName: true,
          merchantId: true,
          phone: true,
          address: true,
          logoUrl: true,
        },
      },
      orders: {
        select: {
          id: true,
          orderId: true,
          customerName: true,
          customerPhone: true,
          amountUsd: true,
          financialStatus: true,
          history: {
            where: {
              action: {
                in: ["SC_RETURNED_TO_SELLER_RTS", "RETURNED_TO_SELLER_RTS"],
              },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { meta: true },
          },
        },
        orderBy: { orderId: "asc" },
      },
    },
  });

  if (!batch) {
    return (
      <div className="p-8 text-center text-red-600 text-sm font-medium">
        Return Batch Not Found
      </div>
    );
  }

  // Flatten the scanner audit meta for the return-reason column.
  const rows = batch.orders.map((o) => {
    const meta = (o.history[0]?.meta ?? null) as {
      reasonCode?: string;
      staffName?: string;
    } | null;
    return {
      id: o.id,
      orderId: o.orderId,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      amountUsd: o.amountUsd,
      reasonLabel: getReasonLabel(meta?.reasonCode) ?? "—",
    };
  });

  return (
    <>
      <style>{`
          @page { margin: 15mm 10mm; size: A4 portrait; }
          body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; margin: 0; padding: 0; }
          .invoice-wrap { max-width: 1000px; margin: 0 auto; padding: 20px; }
          h1 { font-size: 22px; font-weight: 800; margin: 0 0 4px 0; }
          h2 { font-size: 14px; font-weight: 700; margin: 16px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px; color: #444; border-bottom: 2px solid #222; padding-bottom: 6px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px double #222; }
          .header-left { flex: 1; }
          .header-right { text-align: right; }
          .company-name { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
          .company-tagline { font-size: 11px; color: #666; margin-top: 2px; }
          .merchant-info { margin-bottom: 20px; padding: 12px 16px; background: #f5f5f5; border-radius: 6px; font-size: 13px; line-height: 1.6; display: flex; align-items: center; gap: 16px; }
          .merchant-info strong { font-weight: 700; }
          .merchant-logo { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; border: 1px solid #ddd; border-radius: 6px; background: #fff; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
          th { background: #222; color: #fff; padding: 8px 6px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
          th.right { text-align: right; }
          td { padding: 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
          td.right { text-align: right; font-family: 'Courier New', monospace; }
          td.center { text-align: center; }
          tr.even { background: #f9f9f9; }
          .ar { direction: rtl; }
          .totals-row td { font-weight: 700; border-top: 2px solid #222; padding-top: 8px; }
          .signatures { display: flex; justify-content: space-between; gap: 40px; margin-top: 48px; }
          .signature-block { flex: 1; }
          .signature-line { border-bottom: 1.5px solid #222; height: 42px; margin-bottom: 6px; }
          .signature-label { font-size: 11px; color: #444; font-weight: 600; }
          .footer { font-size: 10px; color: #888; text-align: center; margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; }
          .no-print { display: block; text-align: center; margin-bottom: 16px; }
          .no-print button { padding: 10px 24px; font-size: 14px; font-weight: 700; background: #1e40af; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
          @media print { .no-print { display: none !important; } }
        `}</style>
      <PrintControls />

      <div id="print-container" className="invoice-wrap">
        {/* On-screen only: excluded from both browser printing (.no-print) and
            the generated PDF (ignoreElements in PdfDownloadTrigger). */}
        <PdfDownloadTrigger />

        {/* ── Header ── */}
        <div className="header">
          <div className="header-left">
            <div className="company-name">Jet Delivery</div>
            <div className="company-tagline">
              Return Batch Manifest — سجل تسليم المرتجعات
            </div>
          </div>
          <div className="header-right">
            <h1>
              RETURNS MANIFEST
              <br />
              <span className="ar" style={{ fontSize: 16 }}>
                كشف المرتجعات
              </span>
            </h1>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <strong>Batch:</strong> {batch.batchNumber}
            </div>
            <div style={{ fontSize: 12 }}>
              <strong>Date:</strong> {formatDateTime(batch.createdAt.toISOString())}
            </div>
            <div style={{ fontSize: 12 }}>
              <strong>Status:</strong> {batch.status}
            </div>
          </div>
        </div>

        {/* ── Merchant Info ── */}
        <div className="merchant-info">
          {batch.merchant.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={batch.merchant.logoUrl}
              alt={`${batch.merchant.merchantName} logo`}
              className="merchant-logo"
            />
          )}
          <div>
            <strong>
              Returned To / سُلّمت إلى:{" "}
              {batch.merchant.merchantName || batch.merchant.merchantId}
            </strong>
            <br />
            {batch.merchant.phone && (
              <>
                <strong>Phone / الهاتف:</strong> {batch.merchant.phone}
                <br />
              </>
            )}
            {batch.merchant.address && (
              <>
                <strong>Address / العنوان:</strong> {batch.merchant.address}
                <br />
              </>
            )}
            <strong>Merchant ID:</strong> #{batch.merchant.merchantId}
          </div>
        </div>

        {/* ── Orders Table ── */}
        <h2>
          Returned Packages / الطرود المرتجعة ({rows.length})
        </h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "4%" }}>#</th>
              <th style={{ width: "18%" }}>
                Order ID
                <br />
                <span className="ar" style={{ fontWeight: 400 }}>
                  رقم الطلب
                </span>
              </th>
              <th style={{ width: "22%" }}>
                Recipient
                <br />
                <span className="ar" style={{ fontWeight: 400 }}>
                  المستلم
                </span>
              </th>
              <th style={{ width: "16%" }}>
                Phone
                <br />
                <span className="ar" style={{ fontWeight: 400 }}>
                  الهاتف
                </span>
              </th>
              <th className="right" style={{ width: "13%" }}>
                Original COD $
                <br />
                <span className="ar" style={{ fontWeight: 400 }}>
                  المبلغ الأصلي
                </span>
              </th>
              <th style={{ width: "27%" }}>
                Return Reason
                <br />
                <span className="ar" style={{ fontWeight: 400 }}>
                  سبب الإرجاع
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} className={idx % 2 === 0 ? "even" : ""}>
                <td className="center">{idx + 1}</td>
                <td
                  style={{
                    fontFamily: "'Courier New', monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                  }}
                >
                  {row.orderId}
                </td>
                <td style={{ fontSize: 11 }}>{row.customerName}</td>
                <td style={{ fontSize: 11 }}>{row.customerPhone}</td>
                <td className="right">{currency(row.amountUsd)}</td>
                <td style={{ fontSize: 11 }}>{row.reasonLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Signatures ── */}
        <div className="signatures">
          <div className="signature-block">
            <div className="signature-line" />
            <div className="signature-label">
              Driver Signature / توقيع السائق
            </div>
          </div>
          <div className="signature-block">
            <div className="signature-line" />
            <div className="signature-label">
              Seller Signature / توقيع التاجر
            </div>
          </div>
          <div className="signature-block">
            <div className="signature-line" />
            <div className="signature-label">Date / التاريخ</div>
          </div>
        </div>

        <div className="footer">
          Jet Delivery — Return Batch {batch.batchNumber} ·{" "}
          {rows.length} package(s) · Generated{" "}
          {formatDateTime(new Date().toISOString())}
        </div>
      </div>
    </>
  );
}
