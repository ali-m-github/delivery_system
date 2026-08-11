"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { WaybillQRCode } from "@/components/WaybillQRCode";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Order {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  city: string | null;
  location: string;
  amountUsd: number;
  amountLbp: number;
  notes: string | null;
  packages: number;
  merchant: {
    merchantName: string | null;
    phone: string | null;
    logoUrl: string | null;
  } | null;
  createdAt: string;
}

// ─── Helper ────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

// ─── Waybill card (one per order) ─────────────────────────────────────────────
function WaybillCard({ order }: { order: Order }) {
  const merchantName = order.merchant?.merchantName || "—";
  const merchantPhone = order.merchant?.phone || "—";
  const codUsd = Number(order.amountUsd) || 0;
  const codLbp = Number(order.amountLbp) || 0;
  const packages = Number(order.packages) || 1;

  return (
    <div className="w-full max-w-3xl mx-auto border-2 border-black text-sm bg-white mb-8 page-break-inside-avoid print:m-0 print:shadow-none">
      {/* ── ROW 1: Header — empty company logo placeholder ── */}
      <div className="flex justify-between items-center p-4 border-b-2 border-black">
        <div className="w-40 h-12 border-2 border-dashed border-gray-400"></div>
      </div>

      {/* ── ROW 2: Order info + seller + QR ── */}
      <div className="flex justify-between p-4 border-b-2 border-black">
        {/* Left col: Order */}
        <div className="flex flex-col gap-1">
          <div className="font-bold">Order ID: {order.orderId}</div>
          <div>Date: {formatDate(order.createdAt)}</div>
          <div>Packages: {packages}</div>
        </div>
        {/* Middle col: Seller */}
        <div className="flex flex-col gap-1">
          <span className="font-bold">SELLER / MERCHANT</span>
          <span>Name: {merchantName}</span>
          <span>Phone: {merchantPhone}</span>
          {order.merchant?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={order.merchant.logoUrl}
              alt="Merchant Logo"
              className="object-contain mt-1"
              style={{ maxHeight: "60px", maxWidth: "150px" }}
            />
          )}
        </div>
        {/* Right col: QR */}
        <div className="w-24 h-24 flex-shrink-0">
          <WaybillQRCode value={order.orderId} size={96} />
        </div>
      </div>

      {/* ── ROW 3: Ship to (receiver) ── */}
      <div className="p-4 border-b-2 border-black flex flex-col gap-1">
        <div className="font-bold text-lg">SHIP TO (RECEIVER)</div>
        <div>Name: {order.customerName || "—"}</div>
        <div>Phone: {order.customerPhone || "—"}</div>
        <div>Address: {order.customerAddress || "—"}</div>
      </div>

      {/* ── ROW 4: Special instructions + COD due ── */}
      <div className="grid grid-cols-2">
        <div className="p-4 border-r-2 border-black flex flex-col">
          <div className="font-bold">SPECIAL INSTRUCTIONS</div>
          <p className="whitespace-pre-wrap">{order.notes?.trim() || "—"}</p>
        </div>
        <div className="p-4 flex flex-col bg-gray-50 print:bg-transparent">
          <div className="font-bold text-lg">TOTAL C.O.D. DUE</div>
          <div className="font-bold text-xl">USD: {codUsd.toFixed(2)}</div>
          <div className="font-bold text-xl">
            LBP: {codLbp.toLocaleString()}
          </div>
        </div>
      </div>

      {/* ── ROW 5: Footer — Arabic legal statement + signature ── */}
      <div className="flex justify-between items-end p-4 border-t-2 border-black text-xs">
        <p dir="rtl" lang="ar" className="max-w-[60%] leading-relaxed">
          يؤكد المرسل أن هذا الطرد لا يحتوي على أية مواد خطرة أو ممنوعة قانوناً.
        </p>
        <div className="flex-shrink-0">Signature: ___________________</div>
      </div>
    </div>
  );
}

// ─── Print page ───────────────────────────────────────────────────────────────
export default function PrintPage() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const idsParam = searchParams.get("ids");

    if (!idsParam) {
      // Guard: no IDs selected — resolve the loading state synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    const ids = idsParam.split(",").filter(Boolean);

    // Fetch with the maximum server-side take so selected orders are found
    // regardless of age, and normalize both the legacy array format and the
    // current { data, meta } response shape returned by GET /api/orders.
    // The GET handler includes the `merchant` relation (merchantName + logoUrl)
    // plus `notes` and `packages`, so each card renders fully.
    fetch("/api/orders?take=5000")
      .then((res) => res.json())
      .then((result) => {
        const allOrders: Order[] = Array.isArray(result)
          ? result
          : (result.data ?? []);
        const filtered = allOrders.filter((o: Order) => ids.includes(o.id));
        setOrders(filtered);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [searchParams]);

  // ── Auto-handle: PDF generation ──
  useEffect(() => {
    if (orders.length > 0 && searchParams.get("pdf") === "true") {
      import("html2pdf.js").then((html2pdf) => {
        const element = document.getElementById("print-container");
        if (!element) return;
        const opt = {
          margin: 0.4,
          filename: "Waybills.pdf",
          image: { type: "jpeg" as const, quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: {
            unit: "in" as const,
            format: "letter" as const,
            orientation: "portrait" as const,
          },
        };
        html2pdf
          .default()
          .set(opt)
          .from(element)
          .save()
          .then(() => window.close());
      });
    }
  }, [orders, searchParams]);

  if (loading) {
    return <div className="bg-white text-black p-8">Loading orders...</div>;
  }

  if (orders.length === 0) {
    return <div className="bg-white text-black p-8">No orders selected.</div>;
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page { margin: 0.5cm; }
          body { background-color: white; }
        }
      `,
        }}
      />
      <div id="print-container" className="bg-white text-black p-6">
        {orders.map((o) => (
          <WaybillCard key={o.id} order={o} />
        ))}
      </div>
    </>
  );
}
