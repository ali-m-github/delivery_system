"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BarcodeScannerModal from "@/components/BarcodeScannerModal";

// ─── Types (mirror GET /api/admin/pickup-batches) ────────────────────────────

interface BatchOrderItem {
  id: string;
  orderId: string;
  customerName: string;
  packages: string;
  location: string;
  financialStatus: string;
}

interface BatchRecord {
  id: string;
  batchNumber: string;
  status: "PENDING" | "PICKED_UP";
  totalOrders: number;
  pickedUpCount: number;
  receivedCount: number;
  discrepancyNote: string | null;
  createdAt: string;
  merchant: { id: number; merchantId: number; merchantName: string };
  driver: { id: string; firstName: string; lastName: string } | null;
  orders: BatchOrderItem[];
}

interface DriverOption {
  id: string;
  firstName: string;
  lastName: string;
  driverId?: number | string;
}

interface CompletionBanner {
  batchNumber: string;
  allMatched: boolean;
  matched: number;
  missing: Array<{ id: string; orderId: string }>;
  orderIds: string[];
}

interface Props {
  availableDrivers: DriverOption[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WarehouseIntakePanel({
  availableDrivers,
}: Props) {
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // batchId -> selected driverId for the assign dropdown
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  // batchId -> Set of order ids marked as physically received at the warehouse
  const [matched, setMatched] = useState<Record<string, Set<string>>>({});
  // batchId -> optional discrepancy note
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [busyId, setBusyId] = useState<string | null>(null);
  const [scannerBatchId, setScannerBatchId] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [completion, setCompletion] = useState<CompletionBanner | null>(null);

  // ── Fetch active batches (PENDING + PICKED_UP) ─────────────────────────────
  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pickup-batches?status=ACTIVE");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load pickup batches");
        return;
      }
      const list: BatchRecord[] = data.batches || [];
      setBatches(list);
      // Reset per-batch intake state to match the freshly loaded data
      setMatched((prev) => {
        const next: Record<string, Set<string>> = {};
        for (const b of list) next[b.id] = prev[b.id] ?? new Set<string>();
        return next;
      });
    } catch {
      setError("Network error while loading pickup batches");
    } finally {
      setLoading(false);
    }
  }, []);

  // The panel is mounted by the Staff Scanner's "Batch Intake" tab, so loading on
  // mount is sufficient — the host unmounts it whenever the tab changes.
  useEffect(() => {
    setCompletion(null);
    setScanMsg(null);
    fetchBatches();
  }, [fetchBatches]);

  // ── Assign a driver to a PENDING batch ─────────────────────────────────────
  const handleAssign = async (batchId: string) => {
    const driverId = assignSel[batchId];
    if (!driverId) return;
    setBusyId(batchId);
    try {
      const res = await fetch(`/api/admin/pickup-batches/${batchId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to assign driver");
        return;
      }
      setAssignSel((prev) => ({ ...prev, [batchId]: "" }));
      await fetchBatches();
    } catch {
      setError("Network error while assigning driver");
    } finally {
      setBusyId(null);
    }
  };

  // ── Toggle an order's matched state (manual verify) ────────────────────────
  const toggleMatch = (batchId: string, orderId: string) => {
    setMatched((prev) => {
      const set = new Set(prev[batchId] ?? []);
      if (set.has(orderId)) set.delete(orderId);
      else set.add(orderId);
      return { ...prev, [batchId]: set };
    });
  };

  const markAllMatched = (batch: BatchRecord) => {
    setMatched((prev) => ({
      ...prev,
      [batch.id]: new Set(batch.orders.map((o) => o.id)),
    }));
  };

  // ── Camera scan: match scanned orderId against the open batch ──────────────
  const handleIntakeScan = useCallback(
    (decodedText: string) => {
      const text = decodedText.trim();
      if (!scannerBatchId) return;
      const batch = batches.find((b) => b.id === scannerBatchId);
      if (!batch) return;
      const order = batch.orders.find(
        (o) => o.orderId === text || o.id === text,
      );
      if (!order) {
        setScanMsg(`❌ ${text} is not part of ${batch.batchNumber}`);
        return;
      }
      if (matched[batch.id]?.has(order.id)) {
        setScanMsg(`⚠️ ${order.orderId} already matched`);
        return;
      }
      setMatched((prev) => ({
        ...prev,
        [batch.id]: new Set([...(prev[batch.id] ?? []), order.id]),
      }));
      setScanMsg(`✅ ${order.orderId} matched — ${order.customerName}`);
    },
    [scannerBatchId, batches, matched],
  );

  // ── Confirm warehouse intake (receive) ──────────────────────────────────────
  const handleReceive = async (batch: BatchRecord) => {
    const receivedOrderIds = Array.from(matched[batch.id] ?? []);
    const missingCount = batch.orders.length - receivedOrderIds.length;
    if (
      missingCount > 0 &&
      !confirm(
        `${missingCount} order(s) were NOT matched at intake. They will be flagged as DISCREPANCY and stay with the driver. Continue?`,
      )
    ) {
      return;
    }
    setBusyId(batch.id);
    try {
      const res = await fetch(
        `/api/admin/pickup-batches/${batch.id}/receive`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receivedOrderIds,
            discrepancyNotes: notes[batch.id] || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to confirm warehouse intake");
        return;
      }
      setCompletion({
        batchNumber: batch.batchNumber,
        allMatched: !!data.allMatched,
        matched: data.matched ?? receivedOrderIds.length,
        missing: data.missing ?? [],
        orderIds: batch.orders.map((o) => o.id),
      });
      setMatched((prev) => ({ ...prev, [batch.id]: new Set() }));
      setNotes((prev) => ({ ...prev, [batch.id]: "" }));
      await fetchBatches();
    } catch {
      setError("Network error while confirming intake");
    } finally {
      setBusyId(null);
    }
  };

  // ── Live counters per batch ─────────────────────────────────────────────────
  const counters = useMemo(() => {
    const out: Record<string, { matched: number; missing: number }> = {};
    for (const b of batches) {
      const m = matched[b.id]?.size ?? 0;
      out[b.id] = { matched: m, missing: Math.max(b.orders.length - m, 0) };
    }
    return out;
  }, [batches, matched]);

  const pendingBatches = batches.filter((b) => b.status === "PENDING");
  const pickedUpBatches = batches.filter((b) => b.status === "PICKED_UP");

  // Embedded panel (rendered by the Staff Scanner's "Batch Intake" tab) — no
  // backdrop, no card chrome; the host modal owns those.
  return (
    <div>
      {/* ── Panel toolbar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <p className="text-xs text-gray-500">
          Verify merchant pickup batches against physical stock at the warehouse
        </p>
        <button
          onClick={fetchBatches}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-40"
        >
          {loading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      <div>
          {/* ── Completion banner ── */}
          {completion && (
            <div
              className={`mb-4 rounded-xl border p-4 ${
                completion.allMatched
                  ? "bg-green-500/10 border-green-500/40"
                  : "bg-red-500/10 border-red-500/40"
              }`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p
                    className={`text-sm font-bold ${
                      completion.allMatched ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {completion.allMatched
                      ? `✅ BATCH COMPLETE — ${completion.batchNumber}`
                      : `⚠️ BATCH CLOSED WITH DISCREPANCY — ${completion.batchNumber}`}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {completion.matched} matched
                    {completion.missing.length > 0 &&
                      ` · ${completion.missing.length} missing: ${completion.missing
                        .map((m) => m.orderId)
                        .join(", ")}`}
                  </p>
                </div>
                <button
                  onClick={() =>
                    window.open(
                      "/orders/print?ids=" + completion.orderIds.join(","),
                      "_blank",
                    )
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-green-600/80 hover:bg-green-600 transition-colors"
                >
                  🖨️ Print Waybills
                </button>
              </div>
            </div>
          )}

          {/* ── Error banner ── */}
          {error && (
            <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/40 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-400">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading && batches.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">
              Loading pickup batches…
            </p>
          ) : batches.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-400 text-sm font-semibold">
                No active pickup batches
              </p>
              <p className="text-gray-600 text-xs mt-1">
                Batches appear here once a merchant requests a pickup.
              </p>
            </div>
          ) : (
            <>
              {/* ── PENDING: assign a driver ── */}
              {pendingBatches.length > 0 && (
                <section className="mb-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-2">
                    Awaiting Driver Pickup ({pendingBatches.length})
                  </h3>
                  {pendingBatches.map((batch) => (
                    <div
                      key={batch.id}
                      className="mb-3 rounded-xl border border-purple-500/30 bg-purple-500/[0.04] p-4"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                        <div>
                          <span className="font-mono text-sm font-bold text-white">
                            {batch.batchNumber}
                          </span>
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full border bg-purple-500/15 text-purple-300 border-purple-500/30">
                            Pending Pickup
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {batch.totalOrders} orders · created{" "}
                          {fmtDate(batch.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mb-3">
                        Seller:{" "}
                        <span className="text-gray-200 font-semibold">
                          {batch.merchant.merchantName}
                        </span>{" "}
                        (#{batch.merchant.merchantId})
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={assignSel[batch.id] ?? ""}
                          onChange={(e) =>
                            setAssignSel((prev) => ({
                              ...prev,
                              [batch.id]: e.target.value,
                            }))
                          }
                          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-purple-500/50"
                        >
                          <option value="">
                            {batch.driver
                              ? `Reassign from ${batch.driver.firstName} ${batch.driver.lastName}`
                              : "— Choose a driver —"}
                          </option>
                          {availableDrivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.firstName} {d.lastName}
                              {d.driverId != null ? ` (${d.driverId})` : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssign(batch.id)}
                          disabled={!assignSel[batch.id] || busyId === batch.id}
                          className="px-3 py-2 rounded-lg text-xs font-semibold text-purple-300 bg-purple-500/20 border border-purple-500/30 hover:bg-purple-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {busyId === batch.id
                            ? "Assigning..."
                            : batch.driver
                              ? "Reassign Driver"
                              : "Assign Driver"}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* ── PICKED_UP: verify against physical stock ── */}
              {pickedUpBatches.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2">
                    With Driver — Awaiting Warehouse Intake (
                    {pickedUpBatches.length})
                  </h3>
                  {pickedUpBatches.map((batch) => {
                    const c = counters[batch.id] ?? {
                      matched: 0,
                      missing: batch.orders.length,
                    };
                    const allMatched =
                      batch.orders.length > 0 && c.matched === batch.orders.length;
                    return (
                      <div
                        key={batch.id}
                        className="mb-3 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-4"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                          <div>
                            <span className="font-mono text-sm font-bold text-white">
                              {batch.batchNumber}
                            </span>
                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full border bg-cyan-500/15 text-cyan-300 border-cyan-500/30">
                              Picked Up
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-green-400 font-semibold">
                              ✓ {c.matched} matched
                            </span>
                            <span className="text-gray-600">·</span>
                            <span
                              className={
                                c.missing > 0
                                  ? "text-red-400 font-semibold"
                                  : "text-gray-500"
                              }
                            >
                              ✗ {c.missing} missing
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mb-1">
                          Seller:{" "}
                          <span className="text-gray-200 font-semibold">
                            {batch.merchant.merchantName}
                          </span>{" "}
                          (#{batch.merchant.merchantId}) · Driver:{" "}
                          <span className="text-gray-200">
                            {batch.driver
                              ? `${batch.driver.firstName} ${batch.driver.lastName}`
                              : "—"}
                          </span>{" "}
                          · {batch.pickedUpCount}/{batch.totalOrders} picked up
                        </p>

                        {/* Scan controls */}
                        <div className="flex items-center gap-2 flex-wrap my-3">
                          <button
                            onClick={() => {
                              setScanMsg(null);
                              setScannerBatchId(batch.id);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 bg-cyan-500/20 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
                          >
                            📷 Scan Orders
                          </button>
                          <button
                            onClick={() => markAllMatched(batch)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                          >
                            ✓ Match All
                          </button>
                          <button
                            onClick={() =>
                              setMatched((prev) => ({
                                ...prev,
                                [batch.id]: new Set(),
                              }))
                            }
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                          >
                            Clear
                          </button>
                        </div>

                        {/* Item checklist */}
                        <div className="rounded-lg border border-white/10 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-white/[0.03] text-gray-500 text-[10px] uppercase tracking-wider">
                                <th className="px-3 py-2 w-10 text-center">
                                  In
                                </th>
                                <th className="px-3 py-2 text-left">
                                  Order ID
                                </th>
                                <th className="px-3 py-2 text-left">
                                  Customer
                                </th>
                                <th className="px-3 py-2 text-left">
                                  Packages
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {batch.orders.map((o) => {
                                const isMatched = matched[batch.id]?.has(o.id);
                                return (
                                  <tr
                                    key={o.id}
                                    className={`border-t border-white/5 cursor-pointer transition-colors ${
                                      isMatched
                                        ? "bg-green-500/[0.06]"
                                        : "hover:bg-white/[0.03]"
                                    }`}
                                    onClick={() => toggleMatch(batch.id, o.id)}
                                  >
                                    <td className="px-3 py-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked={!!isMatched}
                                        onChange={() =>
                                          toggleMatch(batch.id, o.id)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        className="accent-green-500"
                                      />
                                    </td>
                                    <td className="px-3 py-2 font-mono text-gray-200">
                                      {o.orderId}
                                    </td>
                                    <td className="px-3 py-2 text-gray-400">
                                      {o.customerName}
                                    </td>
                                    <td className="px-3 py-2 text-gray-400">
                                      {o.packages}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Notes + submit */}
                        <div className="mt-3 flex flex-col gap-2">
                          <textarea
                            value={notes[batch.id] ?? ""}
                            onChange={(e) =>
                              setNotes((prev) => ({
                                ...prev,
                                [batch.id]: e.target.value,
                              }))
                            }
                            placeholder="Optional note for missing items (visible to merchant & driver)…"
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-500/50 resize-none"
                          />
                          <button
                            onClick={() => handleReceive(batch)}
                            disabled={busyId === batch.id}
                            className={`px-4 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              allMatched
                                ? "bg-green-600/80 hover:bg-green-600 text-white"
                                : "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30"
                            }`}
                          >
                            {busyId === batch.id
                              ? "Confirming..."
                              : allMatched
                                ? `✅ Confirm Intake — ${c.matched}/${batch.orders.length} MATCHED`
                                : `Confirm Intake — ${c.matched} matched / ${c.missing} missing`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </>
          )}
      </div>

      {/* ── Intake scanner (continuous scanning) ── */}
      <BarcodeScannerModal
        isOpen={scannerBatchId !== null}
        onClose={() => {
          setScannerBatchId(null);
          setScanMsg(null);
        }}
        onScanSuccess={handleIntakeScan}
        heading="Scan Order Barcode for Warehouse Intake"
      />

      {/* ── Scan feedback toast ── */}
      {scanMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-gray-900/95 border border-white/20 text-sm text-white shadow-2xl">
          {scanMsg}
        </div>
      )}
    </div>
  );
}
