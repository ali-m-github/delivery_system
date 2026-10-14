"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getReasonLabel } from "@/lib/driver-reasons";

interface HistoryDriver {
  id: string;
  firstName: string;
  lastName: string;
  driverId: string;
}

/**
 * Structured audit payload written by the driver exception modals
 * (see buildDriverAuditMeta in app/api/orders/route.ts). Absent on legacy
 * rows and non-driver actions.
 */
interface DriverAuditMeta {
  action?: string;
  timestamp?: string;
  performedBy?: string;
  reasonCode?: string | null;
  notes?: string | null;
  expectedCod?: number | null;
  actualCodCollected?: number | null;
  discrepancy?: number | null;
  // ── Universal Staff Scanner audit fields (written by
  //    app/api/admin/orders/universal-scan/route.ts) ──
  isScannerAction?: boolean;
  staffName?: string;
  batchNumber?: string;
  merchantName?: string;
  driverName?: string;
  driverCode?: string;
  assignmentType?: string;
  previousLocation?: string;
}

interface HistoryEntry {
  id: string;
  action: string;
  location: string | null;
  driverId: string | null;
  meta?: DriverAuditMeta | null;
  user?: { id: string; username: string; role?: string } | null;
  driver?: HistoryDriver | null;
  createdAt: string;
}

interface PayoutBatchInfo {
  id: number;
  batchReference: string;
  createdAt: string;
  merchantId: string;
}

interface OrderHistoryModalProps {
  orderId: string;
  /**
   * Optional pre-fetched history (used as an optimistic first paint while the
   * modal loads the FULL history from the dedicated endpoint). If omitted or
   * empty, the modal shows a loading state until the fetch resolves.
   */
  initialHistory?: HistoryEntry[];
  payoutReference?: string | null;
  onClose: () => void;
}

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  WITH_DRIVER: "With Driver",
  DELIVERED: "Delivered",
  RETURN: "Returned",
  Re: "Returned",
  RTS: "Returned to Seller",
  ASSIGNED: "Assigned",
  ASSIGNED_TR: "Assigned - Tr",
};

const LOCATION_COLORS: Record<string, string> = {
  WAREHOUSE: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  WITH_DRIVER: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  DELIVERED: "text-green-400 bg-green-500/10 border-green-500/20",
  RETURN: "text-red-400 bg-red-500/10 border-red-500/20",
  Re: "text-red-400 bg-red-500/10 border-red-500/20",
  RTS: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  ASSIGNED: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  ASSIGNED_TR: "text-amber-400 bg-amber-500/10 border-amber-500/20",
};

const ROLE_BADGES: Record<string, string> = {
  ADMIN: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30",
  MERCHANT: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  DRIVER: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
  EMPLOYEE: "text-green-300 bg-green-500/10 border-green-500/30",
  USER: "text-gray-300 bg-gray-500/10 border-gray-500/30",
};

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "Asia/Beirut",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatAction(action: string) {
  if (!action) return "";
  return action
    .replace(/ -> /g, " → ")
    .replace(/Price\$/g, "Price $")
    .replace(/PriceLL/g, "Price LL")
    .replace(/Collected:/g, "Collected:");
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

/**
 * Human-readable label for a structured driver-scan audit action, e.g.
 * "DELIVERED_WITH_PRICE_ADJUSTMENT" → "Delivered with price adjustment".
 */
function formatAuditAction(action: string | undefined): string | null {
  if (!action) return null;
  const words = action
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return words;
}

/**
 * Clean labels for Universal Staff Scanner actions (SC_-prefixed, written by
 * app/api/admin/orders/universal-scan/route.ts). Unknown SC_ actions fall back
 * to stripping the prefix and humanizing the remainder.
 */
const SCANNER_ACTION_LABELS: Record<string, string> = {
  SC_RECEIVED_AT_WAREHOUSE: "Received at warehouse",
  SC_ASSIGNED_DRIVER_DR: "Assigned driver — Dr run",
  SC_ASSIGNED_DRIVER_TR: "Assigned driver — Tr run",
  SC_MOVED_TO_RETURNS_WAREHOUSE: "Moved to returns warehouse",
  SC_RETURNED_TO_SELLER_RTS: "Returned to seller (RTS)",
  SC_DELIVERED: "Marked delivered",
};

function formatScannerAction(action: string): string {
  if (!action) return "";
  if (SCANNER_ACTION_LABELS[action]) return SCANNER_ACTION_LABELS[action];
  return action
    .replace(/^SC_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function OrderHistoryModal({
  orderId,
  initialHistory,
  payoutReference,
  onClose,
}: OrderHistoryModalProps) {
  const hasSeed = !!initialHistory && initialHistory.length > 0;
  const [history, setHistory] = useState<HistoryEntry[] | null>(
    hasSeed ? initialHistory : null,
  );
  const [payoutBatch, setPayoutBatch] = useState<PayoutBatchInfo | null>(null);
  const [loading, setLoading] = useState(!hasSeed);
  const [error, setError] = useState(false);

  // Always fetch the FULL history from the dedicated endpoint — the pre-passed
  // list can be a truncated subset (e.g. only the first 10 rows).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    fetch(`/api/orders/${orderId}/history`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { history?: HistoryEntry[]; payoutBatch?: PayoutBatchInfo | null }) => {
        if (cancelled) return;
        if (Array.isArray(data.history)) {
          setHistory(data.history);
        } else {
          setHistory([]);
        }
        setPayoutBatch(data.payoutBatch ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Keep the pre-passed history if we have it, otherwise surface an error
        if (!hasSeed) setHistory([]);
        setLoading(false);
        setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, hasSeed]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // Sort oldest to newest (chronological timeline)
  const sortedHistory = (history || []).slice().sort((a, b) => {
    return (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  });

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a2235] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">Order History</h2>
            {payoutReference && (
              <p className="text-xs text-cyan-400 mt-0.5 font-mono">
                Payout: {payoutReference}
              </p>
            )}
            {payoutBatch && (
              <p className="text-xs text-amber-400 mt-0.5 font-mono">
                Paid in Payout Batch:{" "}
                <Link
                  href={`/merchants/${payoutBatch.merchantId}/payouts/${payoutBatch.id}`}
                  className="underline decoration-amber-400/40 hover:text-amber-300 hover:decoration-amber-300 transition-colors"
                  title="Open payout batch"
                >
                  {payoutBatch.batchReference}
                </Link>
              </p>
            )}
            <p className="text-xs text-gray-500 mt-0.5">
              Complete action log — every action, who did it and when
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
              <span className="ml-3 text-gray-400 text-sm">
                Loading full history...
              </span>
            </div>
          ) : sortedHistory.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-12 h-12 mx-auto text-gray-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-gray-500 text-sm">
                {error ? "Could not load order history." : "No history records found."}
              </p>
            </div>
          ) : (
            <>
              {/* Count summary */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[11px] text-gray-400">
                  {sortedHistory.length}{" "}
                  {sortedHistory.length === 1 ? "action" : "actions"} recorded
                </span>
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[11px] text-gray-500">
                  oldest → newest
                </span>
              </div>

              <div className="space-y-0">
                {sortedHistory.map((entry, index) => {
                  const locationLabel =
                    LOCATION_LABELS[entry.location || ""] ||
                    entry.location ||
                    "—";
                  const locationColor =
                    LOCATION_COLORS[entry.location || ""] ||
                    "text-gray-400 bg-gray-500/10 border-gray-500/20";
                  const roleBadge = entry.user?.role
                    ? ROLE_BADGES[entry.user.role] ||
                      "text-gray-300 bg-gray-500/10 border-gray-500/30"
                    : null;
                  const meta = entry.meta ?? null;
                  const reasonLabel = meta?.reasonCode
                    ? getReasonLabel(meta.reasonCode)
                    : null;
                  const discrepancy =
                    typeof meta?.discrepancy === "number"
                      ? meta.discrepancy
                      : 0;
                  const auditActionLabel = formatAuditAction(meta?.action);
                  // Scanner rows are checked FIRST so they never render the
                  // driver-scan "Driver Scan" badge below.
                  const isScannerAction =
                    entry.action.startsWith("SC_") ||
                    meta?.isScannerAction === true;

                  return (
                    <div
                      key={entry.id}
                      className="relative flex gap-4 py-3 group"
                    >
                      {/* Timeline line */}
                      {index < sortedHistory.length - 1 && (
                        <div className="absolute left-[15px] top-[36px] bottom-[-12px] w-0.5 bg-white/10 group-hover:bg-cyan-500/30 transition-colors" />
                      )}

                      {/* Timeline dot */}
                      <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-cyan-400" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pb-1">
                        {/* Actor row: who did it */}
                        <div className="flex items-center flex-wrap gap-2 mb-1.5">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs font-medium text-cyan-300">
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                            {entry.user?.username || "System"}
                          </span>
                          {roleBadge && entry.user?.role && (
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${roleBadge}`}
                            >
                              {entry.user.role}
                            </span>
                          )}
                          {entry.driver && (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-xs font-medium text-cyan-300"
                              title={`Driver ${entry.driver.driverId}`}
                            >
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 7h8m-8 4h8M9 17H8a1 1 0 01-1-1v-1m10 2h-1a1 1 0 01-1-1v-1m-6 0a3 3 0 100 6 3 3 0 000-6zm6 0a3 3 0 100 6 3 3 0 000-6z"
                                />
                              </svg>
                              {entry.driver.firstName} {entry.driver.lastName}
                              <span className="font-mono text-[10px] text-cyan-500">
                                {entry.driver.driverId}
                              </span>
                            </span>
                          )}
                          {isScannerAction ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/40 text-[10px] font-bold uppercase tracking-wide text-indigo-300"
                              title={`Scanner action${meta?.staffName ? ` by ${meta.staffName}` : ""}`}
                            >
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M3 5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v14a2 2 0 01-2 2h-2M3 19a2 2 0 002 2h2M7 8v8m4-8v8m4-8v8"
                                />
                              </svg>
                              [SC] Scanner
                            </span>
                          ) : meta ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-sky-500/10 border border-sky-500/30 text-[10px] font-semibold uppercase tracking-wide text-sky-300"
                              title={meta.performedBy || "Driver scan"}
                            >
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M3 5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v14a2 2 0 01-2 2h-2M3 19a2 2 0 002 2h2M7 8v8m4-8v8m4-8v8"
                                />
                              </svg>
                              Driver Scan
                            </span>
                          ) : null}
                          <span className="text-[11px] text-gray-500">
                            {formatTimestamp(entry.createdAt)}
                          </span>
                        </div>

                        {/* Action description */}
                        <p className="text-sm text-gray-200 leading-relaxed">
                          {isScannerAction
                            ? formatScannerAction(entry.action)
                            : auditActionLabel
                              ? `${auditActionLabel} — ${formatAction(entry.action)}`
                              : formatAction(entry.action)}
                        </p>

                        {/* Scanner staff attribution + return batch reference */}
                        {isScannerAction && (meta?.staffName || meta?.batchNumber) && (
                          <p className="mt-1 text-[11px] text-indigo-300/80">
                            By: {meta?.staffName || "staff"}
                            {meta?.batchNumber
                              ? ` · Batch ${meta.batchNumber}`
                              : ""}
                          </p>
                        )}

                        {/* Reason tag (driver scan) */}
                        {reasonLabel && (
                          <span className="inline-block mt-1.5 px-2 py-0.5 rounded border text-[10px] font-semibold text-rose-300 bg-rose-500/10 border-rose-500/25">
                            Reason: {reasonLabel}
                          </span>
                        )}

                        {/* Custom note quote bubble */}
                        {meta?.notes && (
                          <blockquote className="mt-2 ml-3 border-l-2 border-white/15 pl-3 text-[13px] text-gray-400 italic">
                            {meta.notes}
                          </blockquote>
                        )}

                        {/* COD financial discrepancy badge */}
                        {discrepancy !== 0 && (
                          <span className="inline-block mt-1.5 px-2 py-1 rounded border text-[11px] font-semibold text-amber-300 bg-amber-500/10 border-amber-500/30">
                            COD Adjusted: Expected{" "}
                            {formatUsd(meta?.expectedCod ?? 0)} → Collected{" "}
                            {formatUsd(meta?.actualCodCollected ?? 0)} (Diff:{" "}
                            {formatUsd(discrepancy)})
                          </span>
                        )}

                        {/* Location badge */}
                        {entry.location && (
                          <span
                            className={`inline-block mt-1.5 px-2 py-0.5 rounded border text-[10px] font-semibold ${locationColor}`}
                          >
                            {locationLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between">
          <span className="text-[11px] text-gray-500">
            Timestamps in local time (Asia/Beirut)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
