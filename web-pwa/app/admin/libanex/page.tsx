"use client";

import { useState } from "react";
import PermissionGuard from "@/components/PermissionGuard";

interface SellerRow {
  sellerId: string;
  businessName: string;
  telNumber: string;
  linkedOrders: number;
}

interface OrderRow {
  order_id: string;
  date_rcvd: string | null;
  customer: string | null;
  tel_number: string | null;
  amount: string | null;
  location: string | null;
  fin_status: string | null;
  alreadyLinked: boolean;
  existsInPwa: boolean;
}

interface ImportSummary {
  sellerId: string;
  fetched: number;
  created: number;
  adopted: number;
  skipped: number;
  warnings: string[];
}

interface SyncResult {
  sellerId: string;
  historyRows: number;
  ordersUpdated: number;
  ordersDriverProtected: number;
  warnings: string[];
}

interface PwaOrderRow {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  amountUsd: number;
  amountLbp: number;
  location: string;
  financialStatus: string;
  zoneName: string;
  createdAt: string;
}

interface ExportSummary {
  sellerId: string;
  requested: number;
  exported: number;
  skipped: number;
  warnings: string[];
}

// Mirrors the codes accepted by the Libanex create_order endpoint.
const LX_LOCATIONS: { code: string; label: string }[] = [
  { code: "W", label: "W — Warehouse" },
  { code: "WH", label: "WH — Warehouse hold" },
  { code: "W9", label: "W9 — Warehouse 9" },
  { code: "OP", label: "OP — Overdue / problem" },
  { code: "CP", label: "CP — CP" },
  { code: "CP1", label: "CP1 — CP1" },
  { code: "Dr", label: "Dr — With driver" },
  { code: "DrD", label: "DrD — Driver delivering" },
  { code: "DrR", label: "DrR — Driver returning" },
  { code: "Tr", label: "Tr — In transit" },
  { code: "De", label: "De — Delivered" },
  { code: "Re", label: "Re — Returned" },
  { code: "Ba", label: "Ba — Back to seller" },
  { code: "Rc", label: "Rc — Received back" },
];

const LX_FIN_CODES = [
  "DC", "DP", "PS", "RD", "RM", "RS", "RW", "UD",
  "UP", "UR", "WC", "WD", "WO", "XD", "XS", "XW",
];

export default function LibanexAdminPage() {
  const [query, setQuery] = useState("");
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  // Order picker state (per selected seller)
  const [previewSeller, setPreviewSeller] = useState<SellerRow | null>(null);
  const [previewRows, setPreviewRows] = useState<OrderRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importingSelected, setImportingSelected] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Export (PWA → Libanex) state
  const [exportQuery, setExportQuery] = useState("");
  const [exportRows, setExportRows] = useState<PwaOrderRow[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set());
  const [exportSellerId, setExportSellerId] = useState("");
  const [exportLocation, setExportLocation] = useState("W");
  const [exportFinStatus, setExportFinStatus] = useState("UD");
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportSummary | null>(null);

  const searchSellers = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/admin/libanex/sellers?q=${encodeURIComponent(query)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error || "Seller lookup failed.");
        setSellers([]);
      } else {
        setSellers(data.sellers ?? []);
      }
    } catch (error) {
      setSearchError(String(error));
    } finally {
      setSearching(false);
    }
  };

  const openOrderPicker = async (seller: SellerRow) => {
    setPreviewSeller(seller);
    setPreviewRows([]);
    setPreviewError(null);
    setImportResult(null);
    setSelected(new Set());
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/admin/libanex/orders?sellerId=${encodeURIComponent(seller.sellerId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error || "Order lookup failed.");
      } else {
        const rows: OrderRow[] = data.orders ?? [];
        setPreviewRows(rows);
        // Pre-select everything not already imported.
        setSelected(
          new Set(rows.filter((r) => !r.alreadyLinked).map((r) => r.order_id)),
        );
      }
    } catch (error) {
      setPreviewError(String(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleRow = (orderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAll = () => {
    const selectable = previewRows.filter((r) => !r.alreadyLinked);
    if (selected.size === selectable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((r) => r.order_id)));
    }
  };

  const importSelected = async () => {
    if (!previewSeller) return;
    const orderIds = Array.from(selected);
    if (orderIds.length === 0) {
      alert("Select at least one order to import.");
      return;
    }
    if (
      !confirm(
        `Import ${orderIds.length} selected order(s) from seller ${previewSeller.sellerId}? Orders already on this site will be linked, not duplicated.`,
      )
    )
      return;
    setImportingSelected(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/libanex/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: previewSeller.sellerId, orderIds }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setImportResult(data.summary);
        await openOrderPicker(previewSeller); // refresh picker flags
        await searchSellers(); // refresh linked counts
      } else {
        alert(data.error || "Import failed.");
      }
    } catch (error) {
      alert(String(error));
    } finally {
      setImportingSelected(false);
    }
  };

  const searchExportableOrders = async () => {
    setExportLoading(true);
    setExportError(null);
    try {
      const res = await fetch(
        `/api/admin/libanex/pwa-orders?q=${encodeURIComponent(exportQuery)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setExportError(data.error || "Order lookup failed.");
        setExportRows([]);
      } else {
        const rows: PwaOrderRow[] = data.orders ?? [];
        setExportRows(rows);
        setExportSelected(new Set(rows.map((r) => r.id)));
      }
    } catch (error) {
      setExportError(String(error));
    } finally {
      setExportLoading(false);
    }
  };

  const toggleExportRow = (id: string) => {
    setExportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllExport = () => {
    if (exportSelected.size === exportRows.length) {
      setExportSelected(new Set());
    } else {
      setExportSelected(new Set(exportRows.map((r) => r.id)));
    }
  };

  const exportSelectedOrders = async () => {
    const orderIds = Array.from(exportSelected);
    if (!exportSellerId.trim()) {
      alert("Enter the Libanex seller ID to export the orders under.");
      return;
    }
    if (orderIds.length === 0) {
      alert("Select at least one order to export.");
      return;
    }
    if (
      !confirm(
        `Export ${orderIds.length} order(s) to Libanex under seller ${exportSellerId.trim()} with initial status ${exportLocation}/${exportFinStatus}? They will be assigned to driver D999 (Libanex) and their status will follow Libanex from now on.`,
      )
    )
      return;
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch("/api/admin/libanex/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          sellerId: exportSellerId.trim(),
          location: exportLocation,
          finStatus: exportFinStatus,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setExportResult(data.summary);
        await searchExportableOrders(); // refresh list (exported orders disappear)
      } else {
        alert(data.error || "Export failed.");
      }
    } catch (error) {
      alert(String(error));
    } finally {
      setExporting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResults(null);
    try {
      const res = await fetch("/api/admin/libanex/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setSyncResults(data.results ?? []);
      } else {
        setSyncError(data.error || "Sync failed.");
      }
    } catch (error) {
      setSyncError(String(error));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto text-gray-100">
      <h1 className="text-2xl font-bold mb-2">Libanex Sync</h1>
      <p className="text-gray-400 mb-6 text-sm">
        Import orders from Libanex by seller, then keep their status and history
        updated automatically every 30 minutes. Imported orders are assigned to
        driver <span className="font-mono">D999 (Libanex)</span>; if you
        reassign an order to another driver, the sync will not touch its driver
        again.
      </p>

      {/* ── Seller picker / import ── */}
      <div className="bg-slate-900 border border-gray-800 rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Import a seller's orders</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchSellers()}
            placeholder="Search seller by name, phone or id…"
            className="flex-1 bg-slate-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
          />
          <button
            onClick={searchSellers}
            disabled={searching}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg px-4 py-2"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError && (
          <p className="text-red-400 text-sm mb-3">{searchError}</p>
        )}

        {sellers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2 pr-4">Seller ID</th>
                  <th className="py-2 pr-4">Business</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Already linked</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.sellerId} className="border-b border-gray-800">
                    <td className="py-2 pr-4 font-mono">{s.sellerId}</td>
                    <td className="py-2 pr-4">{s.businessName || "—"}</td>
                    <td className="py-2 pr-4">{s.telNumber || "—"}</td>
                    <td className="py-2 pr-4">{s.linkedOrders}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => openOrderPicker(s)}
                        className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-1.5"
                      >
                        Select orders…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sellers.length === 0 && !searching && !searchError && (
          <p className="text-gray-500 text-sm">
            Search for a Libanex seller to see the Import button.
          </p>
        )}

        {/* ── Order picker for the chosen seller ── */}
        {previewSeller && (
          <div className="mt-6 bg-slate-800 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">
                Orders for seller{" "}
                <span className="font-mono">{previewSeller.sellerId}</span>
                {previewSeller.businessName && (
                  <span className="text-gray-400 font-normal">
                    {" "}
                    — {previewSeller.businessName}
                  </span>
                )}
              </h3>
              <button
                onClick={() => setPreviewSeller(null)}
                className="text-gray-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            {previewLoading && <p className="text-gray-400 text-sm">Loading orders…</p>}
            {previewError && <p className="text-red-400 text-sm">{previewError}</p>}

            {!previewLoading && !previewError && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={toggleAll}
                    className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm"
                  >
                    Select / deselect all
                  </button>
                  <span className="text-sm text-gray-400">
                    {selected.size} of{" "}
                    {previewRows.filter((r) => !r.alreadyLinked).length}{" "}
                    importable order(s) selected
                  </span>
                  <button
                    onClick={importSelected}
                    disabled={importingSelected || selected.size === 0}
                    className="ml-auto bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg px-4 py-1.5"
                  >
                    {importingSelected
                      ? "Importing…"
                      : `Import selected (${selected.size})`}
                  </button>
                </div>

                {previewRows.length === 0 && (
                  <p className="text-gray-500 text-sm">
                    This seller has no orders on Libanex.
                  </p>
                )}
                {previewRows.length > 0 && (
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-800">
                        <tr className="text-left text-gray-400 border-b border-gray-700">
                          <th className="py-2 pr-3"></th>
                          <th className="py-2 pr-4">Order</th>
                          <th className="py-2 pr-4">Date</th>
                          <th className="py-2 pr-4">Customer</th>
                          <th className="py-2 pr-4">Phone</th>
                          <th className="py-2 pr-4">USD</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2">Local</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r) => (
                          <tr
                            key={r.order_id}
                            className="border-b border-gray-700/60"
                          >
                            <td className="py-1.5 pr-3">
                              <input
                                type="checkbox"
                                disabled={r.alreadyLinked}
                                checked={selected.has(r.order_id)}
                                onChange={() => toggleRow(r.order_id)}
                              />
                            </td>
                            <td className="py-1.5 pr-4 font-mono">
                              {r.order_id}
                            </td>
                            <td className="py-1.5 pr-4 whitespace-nowrap text-gray-400">
                              {r.date_rcvd || "—"}
                            </td>
                            <td className="py-1.5 pr-4">{r.customer || "—"}</td>
                            <td className="py-1.5 pr-4">{r.tel_number || "—"}</td>
                            <td className="py-1.5 pr-4">{r.amount ?? "—"}</td>
                            <td className="py-1.5 pr-4 font-mono text-gray-400">
                              {r.location ?? "—"}/{r.fin_status ?? "—"}
                            </td>
                            <td className="py-1.5">
                              {r.alreadyLinked ? (
                                <span className="text-emerald-400">imported</span>
                              ) : r.existsInPwa ? (
                                <span className="text-amber-400">
                                  already on this site (will link)
                                </span>
                              ) : (
                                <span className="text-gray-500">new</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {importResult && (
          <div className="mt-4 bg-slate-800 border border-gray-700 rounded-lg p-4 text-sm">
            <p className="font-semibold text-emerald-400 mb-1">
              Import finished for seller {importResult.sellerId}
            </p>
            <p>
              Fetched {importResult.fetched} · Created {importResult.created} ·
              Linked existing {importResult.adopted} · Skipped (already
              imported) {importResult.skipped}
            </p>
            {importResult.warnings.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-amber-400">
                  {importResult.warnings.length} warning(s)
                </summary>
                <ul className="mt-1 list-disc list-inside text-gray-400">
                  {importResult.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ── Export to Libanex ── */}
      <PermissionGuard requires="MANAGE_ORDERS">
        <div className="bg-slate-900 border border-gray-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold mb-2">Export orders to Libanex</h2>
          <p className="text-gray-400 text-sm mb-4">
            Hand orders over to Libanex: they are created on Libanex under the
            seller ID you choose, assigned to driver{" "}
            <span className="font-mono">D999 (Libanex)</span> here, and from
            then on their status follows Libanex automatically (the same 30-minute
            sync keeps both sides in lockstep). Orders that already came from
            Libanex are never listed here.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            <input
              value={exportSellerId}
              onChange={(e) => setExportSellerId(e.target.value)}
              placeholder="Libanex seller ID (e.g. 1176)"
              className="bg-slate-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-56"
            />
            <select
              value={exportLocation}
              onChange={(e) => setExportLocation(e.target.value)}
              className="bg-slate-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              title="Initial Libanex location"
            >
              {LX_LOCATIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <select
              value={exportFinStatus}
              onChange={(e) => setExportFinStatus(e.target.value)}
              className="bg-slate-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              title="Initial Libanex fin status"
            >
              {LX_FIN_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              value={exportQuery}
              onChange={(e) => setExportQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchExportableOrders()}
              placeholder="Search orders by order id, customer or phone…"
              className="flex-1 bg-slate-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
            />
            <button
              onClick={searchExportableOrders}
              disabled={exportLoading}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg px-4 py-2"
            >
              {exportLoading ? "Searching…" : "List exportable orders"}
            </button>
          </div>
          {exportError && <p className="text-red-400 text-sm mb-3">{exportError}</p>}

          {exportRows.length > 0 && (
            <>
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={toggleAllExport}
                  className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 text-sm"
                >
                  Select / deselect all
                </button>
                <span className="text-sm text-gray-400">
                  {exportSelected.size} of {exportRows.length} order(s) selected
                </span>
                <button
                  onClick={exportSelectedOrders}
                  disabled={exporting || exportSelected.size === 0}
                  className="ml-auto bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg px-4 py-1.5"
                >
                  {exporting ? "Exporting…" : `Export selected (${exportSelected.size})`}
                </button>
              </div>

              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-2 pr-3"></th>
                      <th className="py-2 pr-4">Order</th>
                      <th className="py-2 pr-4">Created</th>
                      <th className="py-2 pr-4">Customer</th>
                      <th className="py-2 pr-4">Phone</th>
                      <th className="py-2 pr-4">USD</th>
                      <th className="py-2 pr-4">Zone</th>
                      <th className="py-2">Current status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exportRows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-700/60">
                        <td className="py-1.5 pr-3">
                          <input
                            type="checkbox"
                            checked={exportSelected.has(r.id)}
                            onChange={() => toggleExportRow(r.id)}
                          />
                        </td>
                        <td className="py-1.5 pr-4 font-mono">{r.orderId}</td>
                        <td className="py-1.5 pr-4 whitespace-nowrap text-gray-400">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-1.5 pr-4">{r.customerName || "—"}</td>
                        <td className="py-1.5 pr-4">{r.customerPhone || "—"}</td>
                        <td className="py-1.5 pr-4">{r.amountUsd}</td>
                        <td className="py-1.5 pr-4">{r.zoneName || "—"}</td>
                        <td className="py-1.5 font-mono text-gray-400">
                          {r.location}/{r.financialStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {exportResult && (
            <div className="mt-4 bg-slate-800 border border-gray-700 rounded-lg p-4 text-sm">
              <p className="font-semibold text-emerald-400 mb-1">
                Export finished for seller {exportResult.sellerId}
              </p>
              <p>
                Requested {exportResult.requested} · Exported {exportResult.exported}{" "}
                · Skipped {exportResult.skipped}
              </p>
              {exportResult.warnings.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-amber-400">
                    {exportResult.warnings.length} warning(s)
                  </summary>
                  <ul className="mt-1 list-disc list-inside text-gray-400">
                    {exportResult.warnings.slice(0, 50).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </PermissionGuard>

      {/* ── Manual sync trigger ── */}
      <PermissionGuard requires="MANAGE_ORDERS">
        <div className="bg-slate-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-2">Sync now</h2>
          <p className="text-gray-400 text-sm mb-4">
            The server syncs automatically every 30 minutes. Use this button to
            pull Libanex history and status changes immediately.
          </p>
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg px-4 py-2"
          >
            {syncing ? "Syncing…" : "Run sync now"}
          </button>
          {syncError && (
            <p className="text-red-400 text-sm mt-3">{syncError}</p>
          )}
          {syncResults && (
            <div className="mt-4 space-y-2 text-sm">
              {syncResults.length === 0 && (
                <p className="text-gray-500">
                  Nothing to sync — no Libanex orders are linked yet.
                </p>
              )}
              {syncResults.map((r) => (
                <div
                  key={r.sellerId}
                  className="bg-slate-800 border border-gray-700 rounded-lg p-3"
                >
                  <p>
                    Seller <span className="font-mono">{r.sellerId}</span>:{" "}
                    {r.historyRows} history event(s), {r.ordersUpdated} order(s)
                    updated
                    {r.ordersDriverProtected > 0 &&
                      ` (${r.ordersDriverProtected} kept your manual driver)`}
                  </p>
                  {r.warnings.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-amber-400">
                        {r.warnings.length} warning(s)
                      </summary>
                      <ul className="mt-1 list-disc list-inside text-gray-400">
                        {r.warnings.slice(0, 50).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PermissionGuard>
    </div>
  );
}
