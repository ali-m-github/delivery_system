"use client";

import { useEffect } from "react";

// ─── Order Details Modal ──────────────────────────────────────────────────────
// Opens from any order-ID cell (user side and merchant side). Layout mirrors
// the reference sheet: a clean multi-column grid of bold labels with the value
// directly underneath each one — no per-field boxes — while keeping the site's
// dark theme.
//
// The order object is passed in directly from the table row (every table
// already has the full record client-side), so no extra API fetch is needed.

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  CP: "CP (Pickup)",
  WITH_DRIVER: "With Driver",
  ASSIGNED: "Out for Delivery",
  ASSIGNED_TR: "Out for Delivery - Tr",
  DELIVERED: "Delivered",
  RETURN: "Returned",
  Re: "Returned",
  RTS: "Returned to Seller",
  EWD: "Exchange w/ Driver",
  EX: "Exchange (Warehouse)",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// Checkbox rendered like the reference sheet: an empty square, or a bold "X"
// inside it when the flag is set, so checked/unchecked is obvious on dark bg.
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex w-4 h-4 items-center justify-center border rounded-sm text-[11px] font-bold leading-none ${
        checked
          ? "border-cyan-400 text-cyan-400"
          : "border-gray-600 text-transparent"
      }`}
    >
      {checked ? "X" : ""}
    </span>
  );
}

// One field: bold label on top, plain value below — like the reference sheet.
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const value = children;
  const isEmpty =
    value === null || value === undefined || value === "" || value === false;
  return (
    <div className="py-1">
      <p className="text-xs font-bold text-gray-300 mb-1">{label}</p>
      <div className="text-sm text-gray-400 break-words min-h-[1.25rem]">
        {isEmpty ? "" : value}
      </div>
    </div>
  );
}

export default function OrderDetailsModal({
  order,
  onClose,
}: {
  order: any;
  onClose: () => void;
}) {
  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sellerName =
    order.merchant?.merchantName ||
    order.merchant?.ownerFirstName ||
    (order.merchant?.ownerLastName
      ? `${order.merchant.ownerFirstName} ${order.merchant.ownerLastName}`
      : null) ||
    "";

  const driverName = order.driver
    ? `${order.driver.firstName} ${order.driver.lastName}`
    : "";

  const locationLabel = LOCATION_LABELS[order.location] || order.location || "";

  const amountUsd = Number(order.amountUsd ?? 0);
  const amountLbp = Number(order.amountLbp ?? 0);
  const collectedUsd = Number(order.collectedUsd ?? 0);
  const collectedLbp = Number(order.collectedLbp ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#121824] w-full max-w-3xl rounded-xl border border-white/10 shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — "Orders [ID]" with a divider, like the reference sheet */}
        <div className="px-6 pt-5 pb-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-cyan-400">
            Orders [{order.orderId}]
          </h2>
          <button
            onClick={onClose}
            title="Close"
            className="shrink-0 w-7 h-7 text-sm font-bold bg-white/5 text-gray-400 border border-white/10 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Three-column label/value grid, no boxes */}
        <div className="overflow-y-auto px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-1 content-start">
          <Field label="Order Id">
            <span className="font-mono">{order.orderId || ""}</span>
          </Field>
          <Field label="Driver">{driverName}</Field>
          <Field label="Location">{locationLabel}</Field>

          <Field label="Date Received">
            <span className="font-mono">{formatDateTime(order.createdAt)}</span>
          </Field>
          <Field label="Zone">{order.zone?.name || ""}</Field>
          <Field label="Fin Status">{order.financialStatus || ""}</Field>

          <Field label="Seller">{sellerName}</Field>
          <Field label="Amount L.L">
            <span className="font-mono">
              {amountLbp ? amountLbp.toLocaleString() : ""}
            </span>
          </Field>
          <Field label="Packages">
            {order.packages != null ? String(order.packages) : ""}
          </Field>

          <Field label="Customer">{order.customerName || ""}</Field>
          <Field label="Amount $">
            <span className="font-mono">${amountUsd.toFixed(2)}</span>
          </Field>
          {/* Checkbox column — Exchange / Open Parcel / Fragile stacked in the
              right column, mirroring where "Ex" used to sit. */}
          <Field label="Exchange">
            <CheckBox checked={order.hasExchange === true} />
          </Field>

          <Field label="Tel Number">
            <span className="font-mono">{order.customerPhone || ""}</span>
          </Field>
          <Field label="Extra Shipping">
            <span className="font-mono">
              {order.extraShipping
                ? `$${Number(order.extraShipping).toFixed(2)}`
                : ""}
            </span>
          </Field>
          <Field label="Open Parcel">
            <CheckBox checked={order.openParcelAllowed === true} />
          </Field>

          <Field label="Address">{order.customerAddress || ""}</Field>
          <Field label="$ Collected">
            <span className="font-mono">${collectedUsd.toFixed(2)}</span>
          </Field>
          <Field label="Fragile">
            <CheckBox checked={order.isFragile === true} />
          </Field>

          <Field label="Notes">{order.notes || ""}</Field>
          <Field label="L.L Collected">
            <span className="font-mono">
              {collectedLbp ? collectedLbp.toLocaleString() : ""}
            </span>
          </Field>

          {order.deliveredAt && (
            <Field label="Delivered">
              <span className="font-mono">{formatDateTime(order.deliveredAt)}</span>
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}
