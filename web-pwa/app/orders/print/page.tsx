"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

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
  merchant: { ownerFirstName: string; ownerLastName: string; merchantName: string } | null;
  createdAt: string;
}

// ─── Helper ────────────────────────────────────────────────────────────────────
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PrintPage() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const idsParam = searchParams.get("ids");
    const pdfParam = searchParams.get("pdf");

    if (!idsParam) {
      setLoading(false);
      return;
    }

    const ids = idsParam.split(",").filter(Boolean);

    fetch("/api/orders")
      .then((res) => res.json())
      .then((allOrders: Order[]) => {
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
        const opt = { margin: 0.5, filename: "Orders_Export.pdf", image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: "in", format: "letter", orientation: "landscape" } };
        html2pdf.default().set(opt).from(element).save().then(() => window.close());
      });
    }
  }, [orders, searchParams]);

  if (loading) {
    return (
      <div className="bg-white text-black p-8">
        Loading orders...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white text-black p-8">
        No orders selected.
      </div>
    );
  }

  const sellerName = (o: Order) =>
    o.merchant?.ownerFirstName || o.merchant?.merchantName || "—";

  return (
    <div id="print-container" className="bg-white text-black p-8">
      <table className="w-full border-collapse border-2 border-gray-800 text-sm">
        <thead>
          <tr>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Order ID
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Date
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Seller
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Customer
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Phone
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Address
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              City
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Amount $
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Amount LL
            </th>
            <th className="border-2 border-gray-800 bg-gray-200 text-black p-2 font-bold text-center">
              Location
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="border border-gray-800 p-2 text-center text-black">{o.orderId}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{shortDate(o.createdAt)}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{sellerName(o)}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{o.customerName}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{o.customerPhone}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{o.customerAddress}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{o.city || "—"}</td>
              <td className="border border-gray-800 p-2 text-center text-black">${o.amountUsd.toFixed(2)}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{o.amountLbp.toLocaleString()}</td>
              <td className="border border-gray-800 p-2 text-center text-black">{o.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
