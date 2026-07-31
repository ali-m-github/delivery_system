"use client";

import { useState, useCallback, useRef } from "react";

// ─── Zone Type ─────────────────────────────────────────────────────────────────
interface Zone {
  id: string;
  name: string;
  basePriceUsd: number;
  basePriceLbp: number;
}

// ─── Training Result ───────────────────────────────────────────────────────────
interface TrainResult {
  success?: boolean;
  newAddressesAdded?: number;
  existingAddressesUpdated?: number;
  newlyVerifiedCount?: number;
  totalVerifiedCount?: number;
  error?: string;
  details?: string;
}

// ─── Auto-Assign Result ────────────────────────────────────────────────────────
interface UnassignedOrder {
  id: string;
  orderId: string;
  address: string;
  reason?: string;
}

interface AutoAssignResult {
  totalOrdersScanned?: number;
  assignedCount?: number;
  unassignedCount?: number;
  unassignedOrders?: UnassignedOrder[];
  message?: string;
  error?: string;
  details?: string;
}

// ─── Seed Result ───────────────────────────────────────────────────────────────
interface SeedResult {
  success?: boolean;
  upsertedCount?: number;
  createdCount?: number;
  updatedCount?: number;
  totalVerifiedCount?: number;
  skippedCount?: number;
  skippedRows?: { row: number; city: string; zone: string; reason: string }[];
  error?: string;
  details?: string;
}

// ─── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  zones: Zone[];
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function ZonesClient({ zones: initialZones }: Props) {
  const [zones, setZones] = useState<Zone[]>(initialZones);

  // ── Zone Create State ──
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneUsd, setNewZoneUsd] = useState("");
  const [newZoneLbp, setNewZoneLbp] = useState("");
  const [zoneCreateLoading, setZoneCreateLoading] = useState(false);
  const [zoneCreateError, setZoneCreateError] = useState("");

  // ── Zone Edit State ──
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editZoneName, setEditZoneName] = useState("");
  const [editZoneUsd, setEditZoneUsd] = useState("");
  const [editZoneLbp, setEditZoneLbp] = useState("");
  const [zoneEditLoading, setZoneEditLoading] = useState(false);
  const [zoneEditError, setZoneEditError] = useState("");

  // ── Train Engine State ──
  const [trainModalOpen, setTrainModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainResult, setTrainResult] = useState<TrainResult | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Auto-Assign State ──
  const [autoAssignModalOpen, setAutoAssignModalOpen] = useState(false);
  const [autoAssignLoading, setAutoAssignLoading] = useState(false);
  const [autoAssignResult, setAutoAssignResult] =
    useState<AutoAssignResult | null>(null);
  const [defaultZoneId, setDefaultZoneId] = useState("");

  // ── Seed State ──
  const [seedModalOpen, setSeedModalOpen] = useState(false);
  const [seedFile, setSeedFile] = useState<File | null>(null);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const seedFileInputRef = useRef<HTMLInputElement>(null);

  // ── Refresh helpers ──
  const refreshZones = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/zones");
      if (res.ok) {
        const data = await res.json();
        setZones(data);
      }
    } catch {
      // silently fail
    }
  }, []);

  // ── Toast helper ──
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 5000);
  }, []);

  // ── Zone CRUD Handlers ──

  // Create zone
  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneName.trim()) return;
    setZoneCreateLoading(true);
    setZoneCreateError("");

    try {
      const res = await fetch("/api/admin/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newZoneName.trim(),
          basePriceUsd: newZoneUsd ? Number(newZoneUsd) : 0,
          basePriceLbp: newZoneLbp ? Number(newZoneLbp) : 0,
        }),
      });

      if (res.ok) {
        setNewZoneName("");
        setNewZoneUsd("");
        setNewZoneLbp("");
        await refreshZones();
      } else {
        const data = await res.json();
        setZoneCreateError(data.error || "Failed to create zone");
      }
    } catch {
      setZoneCreateError("Network error");
    } finally {
      setZoneCreateLoading(false);
    }
  };

  // Start editing a zone
  const startEditZone = (zone: Zone) => {
    setEditingZoneId(zone.id);
    setEditZoneName(zone.name);
    setEditZoneUsd(String(zone.basePriceUsd ?? ""));
    setEditZoneLbp(String(zone.basePriceLbp ?? ""));
    setZoneEditError("");
  };

  // Cancel editing
  const cancelEditZone = () => {
    setEditingZoneId(null);
    setEditZoneName("");
    setEditZoneUsd("");
    setEditZoneLbp("");
    setZoneEditError("");
  };

  // ── Train Engine Handler ──────────────────────────────────────────────
  const handleTrainUpload = async () => {
    if (!selectedFile) return;
    setTrainLoading(true);
    setTrainResult(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/admin/zones/train", {
        method: "POST",
        body: formData,
      });

      const data: TrainResult = await res.json();

      if (res.ok && data.success) {
        setTrainResult(data);
        showToast(
          `Training complete! ${data.newlyVerifiedCount} newly verified zones added (${VERIFICATION_THRESHOLD}+ occurrences). Total active verified locations: ${data.totalVerifiedCount}.`,
        );
      } else {
        setTrainResult(data);
        showToast(`Training failed: ${data.error || "Unknown error"}`);
      }
    } catch {
      setTrainResult({ error: "Network error" });
      showToast("Training failed: Network error");
    } finally {
      setTrainLoading(false);
    }
  };

  // ── Auto-Assign Handler ───────────────────────────────────────────────
  const handleAutoAssign = async () => {
    if (!defaultZoneId.trim()) return;
    setAutoAssignLoading(true);
    setAutoAssignResult(null);

    try {
      const res = await fetch("/api/admin/zones/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultZoneId: defaultZoneId.trim() }),
      });

      const data: AutoAssignResult = await res.json();

      if (res.ok) {
        setAutoAssignResult(data);
        if (data.assignedCount && data.assignedCount > 0) {
          showToast(
            `Auto-assign complete! ${data.assignedCount} of ${data.totalOrdersScanned} orders assigned.`,
          );
        }
      } else {
        setAutoAssignResult(data);
        showToast(`Auto-assign failed: ${data.error || "Unknown error"}`);
      }
    } catch {
      setAutoAssignResult({ error: "Network error" });
      showToast("Auto-assign failed: Network error");
    } finally {
      setAutoAssignLoading(false);
    }
  };

  // ── Seed Handler ──────────────────────────────────────────────────────
  const handleSeedUpload = async () => {
    if (!seedFile) return;
    setSeedLoading(true);
    setSeedResult(null);

    try {
      const formData = new FormData();
      formData.append("file", seedFile);

      const res = await fetch("/api/admin/zones/seed", {
        method: "POST",
        body: formData,
      });

      const data: SeedResult = await res.json();

      if (res.ok && data.success) {
        setSeedResult(data);
        showToast(
          `Seeding complete! ${data.upsertedCount} cities upserted (${data.createdCount} new, ${data.updatedCount} updated). Total verified: ${data.totalVerifiedCount}.`,
        );
      } else {
        setSeedResult(data);
        showToast(`Seeding failed: ${data.error || "Unknown error"}`);
      }
    } catch {
      setSeedResult({ error: "Network error" });
      showToast("Seeding failed: Network error");
    } finally {
      setSeedLoading(false);
    }
  };

  // ── Helpers ──
  const VERIFICATION_THRESHOLD = 5;

  // Save zone edit
  const handleUpdateZone = async (zoneId: string) => {
    setZoneEditLoading(true);
    setZoneEditError("");

    try {
      const res = await fetch(`/api/zones/${zoneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editZoneName.trim(),
          basePriceUsd: editZoneUsd ? Number(editZoneUsd) : 0,
          basePriceLbp: editZoneLbp ? Number(editZoneLbp) : 0,
        }),
      });

      if (res.ok) {
        cancelEditZone();
        await refreshZones();
      } else {
        const data = await res.json();
        setZoneEditError(data.error || "Failed to update zone");
      }
    } catch {
      setZoneEditError("Network error");
    } finally {
      setZoneEditLoading(false);
    }
  };

  // ── Helpers ──
  const formatCurrency = (n: number) =>
    n != null ? `$${Number(n).toFixed(2)}` : "$0.00";

  const formatLbp = (n: number) =>
    n != null ? `${Number(n).toLocaleString()} LBP` : "0 LBP";

  // ── Render ──
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] pointer-events-none z-0" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            Zone & Rate Management
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Configure delivery zones and base pricing.
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1: Create Zone Form
           ═══════════════════════════════════════════════════════════════════ */}
        <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            Add New Zone
          </h2>
          <form onSubmit={handleCreateZone} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="zoneName"
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
                  Zone Name
                </label>
                <input
                  id="zoneName"
                  type="text"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="e.g. Downtown"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="zoneUsd"
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
                  Base Rate (USD)
                </label>
                <input
                  id="zoneUsd"
                  type="number"
                  step="0.01"
                  min="0"
                  value={newZoneUsd}
                  onChange={(e) => setNewZoneUsd(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="zoneLbp"
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
                  Base Rate (LBP)
                </label>
                <input
                  id="zoneLbp"
                  type="number"
                  step="1"
                  min="0"
                  value={newZoneLbp}
                  onChange={(e) => setNewZoneLbp(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={zoneCreateLoading || !newZoneName.trim()}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                           hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                           transition-all duration-200"
              >
                {zoneCreateLoading ? "Creating..." : "Create Zone"}
              </button>
            </div>
            {zoneCreateError && (
              <p className="text-xs text-red-400">{zoneCreateError}</p>
            )}
          </form>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 2: Zones Data Grid
           ═══════════════════════════════════════════════════════════════════ */}
        <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            Active Delivery Zones ({zones.length})
          </h2>

          {zones.length === 0 ? (
            <p className="text-sm text-gray-500">No zones created yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4 font-medium">Zone Name</th>
                    <th className="py-3 px-4 font-medium">Base Rate (USD)</th>
                    <th className="py-3 px-4 font-medium">Base Rate (LBP)</th>
                    <th className="py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {zones.map((zone) => {
                    const isEditing = editingZoneId === zone.id;

                    return (
                      <tr
                        key={zone.id}
                        className="hover:bg-white/[0.03] transition-colors duration-150"
                      >
                        {/* Zone Name */}
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editZoneName}
                              onChange={(e) => setEditZoneName(e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 text-sm
                                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50"
                            />
                          ) : (
                            <span className="text-gray-200 font-medium">
                              {zone.name}
                            </span>
                          )}
                        </td>

                        {/* Base Rate USD */}
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editZoneUsd}
                              onChange={(e) => setEditZoneUsd(e.target.value)}
                              className="w-28 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 text-sm
                                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50"
                            />
                          ) : (
                            <span className="text-cyan-400 font-mono">
                              {formatCurrency(zone.basePriceUsd)}
                            </span>
                          )}
                        </td>

                        {/* Base Rate LBP */}
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={editZoneLbp}
                              onChange={(e) => setEditZoneLbp(e.target.value)}
                              className="w-32 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 text-sm
                                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50"
                            />
                          ) : (
                            <span className="text-purple-400 font-mono">
                              {formatLbp(zone.basePriceLbp)}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleUpdateZone(zone.id)}
                                disabled={zoneEditLoading}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                           bg-gradient-to-r from-cyan-500/20 to-cyan-600/20 text-cyan-300
                                           border border-cyan-500/30 hover:from-cyan-500/30 hover:to-cyan-600/30
                                           hover:shadow-[0_0_10px_rgba(6,182,212,0.3)]
                                           transition-all duration-200 disabled:opacity-50"
                              >
                                {zoneEditLoading ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditZone}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                           text-gray-400 bg-white/5 border border-white/10
                                           hover:bg-white/10 hover:text-white transition-all duration-200"
                              >
                                Cancel
                              </button>
                              {zoneEditError && (
                                <span className="text-[10px] text-red-400">
                                  {zoneEditError}
                                </span>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditZone(zone)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                         bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300
                                         border border-amber-500/30 hover:from-amber-500/30 hover:to-amber-600/30
                                         hover:shadow-[0_0_10px_rgba(245,158,11,0.3)]
                                         transition-all duration-200"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 3: Zone Automation & Intelligence
           ═══════════════════════════════════════════════════════════════════ */}
        <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
          <h2 className="text-lg font-semibold text-gray-200 mb-1">
            Zone Automation & Intelligence
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            Train the zone engine with address data and auto-assign pending
            orders.
          </p>

          <div className="flex flex-wrap gap-4">
            {/* Train Engine Button */}
            <button
              type="button"
              onClick={() => {
                setTrainResult(null);
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
                setTrainModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white
                         bg-gradient-to-r from-emerald-500 to-emerald-600
                         hover:from-emerald-400 hover:to-emerald-500
                         shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)]
                         transition-all duration-200"
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Train Engine (Upload Excel)
            </button>

            {/* Auto-Assign Button */}
            <button
              type="button"
              onClick={() => {
                setAutoAssignResult(null);
                setAutoAssignModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white
                         bg-gradient-to-r from-purple-500 to-purple-600
                         hover:from-purple-400 hover:to-purple-500
                         shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                         transition-all duration-200"
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
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Auto-Assign Pending Orders
            </button>

            {/* Seed Master Cities Button */}
            <button
              type="button"
              onClick={() => {
                setSeedResult(null);
                setSeedFile(null);
                if (seedFileInputRef.current)
                  seedFileInputRef.current.value = "";
                setSeedModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white
                         bg-gradient-to-r from-amber-500 to-orange-600
                         hover:from-amber-400 hover:to-orange-500
                         shadow-[0_0_12px_rgba(245,158,11,0.3)] hover:shadow-[0_0_20px_rgba(245,158,11,0.5)]
                         transition-all duration-200"
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
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              Seed Master Cities File
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          TOAST NOTIFICATION
         ═══════════════════════════════════════════════════════════════════ */}
      {toastVisible && (
        <div className="fixed bottom-6 right-6 z-[100] animate-slide-up">
          <div
            className="backdrop-blur-xl bg-gray-900/95 border border-cyan-500/30 rounded-xl px-5 py-3
                          shadow-[0_0_20px_rgba(6,182,212,0.2)] max-w-md"
          >
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-sm text-gray-200">{toastMessage}</p>
              </div>
              <button
                onClick={() => setToastVisible(false)}
                className="text-gray-500 hover:text-gray-300 ml-2 shrink-0"
              >
                <svg
                  className="w-4 h-4"
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
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TRAIN ENGINE MODAL
         ═══════════════════════════════════════════════════════════════════ */}
      {trainModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setTrainModalOpen(false)}
          />
          <div
            className="relative z-10 w-full max-w-lg backdrop-blur-xl bg-gray-900/95 border border-white/10
                          rounded-2xl p-6 shadow-[0_0_30px_rgba(6,182,212,0.15)]"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-100">
                Train Engine — Upload Excel
              </h3>
              <button
                onClick={() => setTrainModalOpen(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
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

            <p className="text-sm text-gray-400 mb-4">
              Upload an Excel file (.xlsx, .xls, .csv) with{" "}
              <code className="text-cyan-400 bg-cyan-500/10 px-1 rounded">
                address
              </code>{" "}
              and{" "}
              <code className="text-cyan-400 bg-cyan-500/10 px-1 rounded">
                zone
              </code>{" "}
              /{" "}
              <code className="text-cyan-400 bg-cyan-500/10 px-1 rounded">
                zoneId
              </code>{" "}
              columns. Repeated uploads accumulate occurrence counts. When a
              location reaches {VERIFICATION_THRESHOLD}+ occurrences, it becomes
              auto-verified.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Select File
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4
                           file:rounded-lg file:border-0 file:text-sm file:font-semibold
                           file:bg-cyan-500/20 file:text-cyan-300
                           hover:file:bg-cyan-500/30 file:cursor-pointer
                           file:transition-all file:duration-200"
              />
              {selectedFile && (
                <p className="text-xs text-cyan-400 mt-2">
                  Selected: {selectedFile.name} (
                  {(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTrainUpload}
                disabled={trainLoading || !selectedFile}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-emerald-500 to-emerald-600
                           hover:from-emerald-400 hover:to-emerald-500
                           disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-[0_0_10px_rgba(16,185,129,0.3)]
                           transition-all duration-200"
              >
                {trainLoading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Training...
                  </span>
                ) : (
                  "Upload & Train"
                )}
              </button>
              <button
                type="button"
                onClick={() => setTrainModalOpen(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-400
                           bg-white/5 border border-white/10 hover:bg-white/10
                           transition-all duration-200"
              >
                Cancel
              </button>
            </div>

            {trainResult && (
              <div
                className={`mt-5 p-4 rounded-xl border ${trainResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}
              >
                {trainResult.success ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-emerald-400 font-semibold">
                      Training Complete ✓
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-gray-300">
                      <div>
                        <span className="text-gray-500">New addresses:</span>{" "}
                        {trainResult.newAddressesAdded}
                      </div>
                      <div>
                        <span className="text-gray-500">Updated:</span>{" "}
                        {trainResult.existingAddressesUpdated}
                      </div>
                      <div>
                        <span className="text-gray-500">Newly verified:</span>{" "}
                        <span className="text-emerald-400 font-mono">
                          {trainResult.newlyVerifiedCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Total verified:</span>{" "}
                        <span className="text-cyan-400 font-mono">
                          {trainResult.totalVerifiedCount}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-red-400">
                    {trainResult.error || "Unknown error"}
                    {trainResult.details && (
                      <span className="block text-xs text-red-500 mt-1">
                        {trainResult.details}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          AUTO-ASSIGN MODAL
         ═══════════════════════════════════════════════════════════════════ */}
      {autoAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setAutoAssignModalOpen(false)}
          />
          <div
            className="relative z-10 w-full max-w-xl backdrop-blur-xl bg-gray-900/95 border border-white/10
                          rounded-2xl p-6 shadow-[0_0_30px_rgba(168,85,247,0.15)] max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-100">
                Auto-Assign Pending Orders
              </h3>
              <button
                onClick={() => setAutoAssignModalOpen(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
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

            <p className="text-sm text-gray-400 mb-4">
              Scan orders currently assigned to a default/unassigned zone and
              re-assign them using verified address-to-zone mappings from the
              training engine.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Default/Unassigned Zone
              </label>
              <select
                value={defaultZoneId}
                onChange={(e) => setDefaultZoneId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                           focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/50
                           transition-all duration-200 text-sm"
              >
                <option
                  value=""
                  style={{ backgroundColor: "#0a0a0a", color: "#ededed" }}
                >
                  -- Select a zone --
                </option>
                {[...zones]
                  .sort((a, b) => {
                    const numA = parseInt(a.name.replace(/\D/g, ""), 10) || 0;
                    const numB = parseInt(b.name.replace(/\D/g, ""), 10) || 0;
                    return numA - numB;
                  })
                  .map((z) => (
                    <option
                      key={z.id}
                      value={z.id}
                      style={{ backgroundColor: "#0a0a0a", color: "#ededed" }}
                    >
                      {z.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-gray-500 mt-1.5">
                Only orders in this zone will be scanned and re-assigned.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleAutoAssign}
                disabled={autoAssignLoading || !defaultZoneId.trim()}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-purple-500 to-purple-600
                           hover:from-purple-400 hover:to-purple-500
                           disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-[0_0_10px_rgba(168,85,247,0.3)]
                           transition-all duration-200"
              >
                {autoAssignLoading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Assigning...
                  </span>
                ) : (
                  "Run Auto-Assign"
                )}
              </button>
              <button
                type="button"
                onClick={() => setAutoAssignModalOpen(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-400
                           bg-white/5 border border-white/10 hover:bg-white/10
                           transition-all duration-200"
              >
                Cancel
              </button>
            </div>

            {autoAssignResult && !autoAssignResult.error && (
              <div className="mt-5 p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
                <div className="space-y-3">
                  <p className="text-purple-400 font-semibold text-sm">
                    Assignment Results
                  </p>

                  {autoAssignResult.message && (
                    <p className="text-sm text-gray-400">
                      {autoAssignResult.message}
                    </p>
                  )}

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="text-2xl font-bold text-gray-100">
                        {autoAssignResult.totalOrdersScanned ?? 0}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Scanned</div>
                    </div>
                    <div className="bg-emerald-500/10 rounded-lg p-3">
                      <div className="text-2xl font-bold text-emerald-400">
                        {autoAssignResult.assignedCount ?? 0}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Assigned</div>
                    </div>
                    <div className="bg-amber-500/10 rounded-lg p-3">
                      <div className="text-2xl font-bold text-amber-400">
                        {autoAssignResult.unassignedCount ?? 0}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Unassigned
                      </div>
                    </div>
                  </div>

                  {autoAssignResult.unassignedOrders &&
                    autoAssignResult.unassignedOrders.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-amber-400 mb-2">
                          Unassigned Orders (
                          {autoAssignResult.unassignedOrders.length})
                        </p>
                        <div className="max-h-48 overflow-y-auto space-y-1.5">
                          {autoAssignResult.unassignedOrders.map((uo) => (
                            <div
                              key={uo.id}
                              className="bg-white/5 rounded-lg p-2.5 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-gray-300 font-mono">
                                  {uo.orderId}
                                </span>
                              </div>
                              <p className="text-gray-500 truncate mt-0.5">
                                {uo.address}
                              </p>
                              {uo.reason && (
                                <p className="text-amber-500/70 mt-0.5">
                                  {uo.reason}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}

            {autoAssignResult?.error && (
              <div className="mt-5 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
                <p className="text-sm text-red-400">
                  {autoAssignResult.error}
                  {autoAssignResult.details && (
                    <span className="block text-xs text-red-500 mt-1">
                      {autoAssignResult.details}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SEED MASTER CITIES MODAL
         ═══════════════════════════════════════════════════════════════════ */}
      {seedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSeedModalOpen(false)}
          />
          <div
            className="relative z-10 w-full max-w-xl backdrop-blur-xl bg-gray-900/95 border border-white/10
                          rounded-2xl p-6 shadow-[0_0_30px_rgba(245,158,11,0.15)] max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-100">
                Seed Master Cities File
              </h3>
              <button
                onClick={() => setSeedModalOpen(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
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

            <p className="text-sm text-gray-400 mb-4">
              Upload your master{" "}
              <code className="text-amber-400 bg-amber-500/10 px-1 rounded">
                cities.xlsx
              </code>{" "}
              file with{" "}
              <code className="text-amber-400 bg-amber-500/10 px-1 rounded">
                City
              </code>{" "}
              and{" "}
              <code className="text-amber-400 bg-amber-500/10 px-1 rounded">
                Zone
              </code>{" "}
              columns. All cities will be upserted as verified trusted records
              with maximum occurrence count — no threshold gating.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Select File
              </label>
              <input
                ref={seedFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setSeedFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4
                           file:rounded-lg file:border-0 file:text-sm file:font-semibold
                           file:bg-amber-500/20 file:text-amber-300
                           hover:file:bg-amber-500/30 file:cursor-pointer
                           file:transition-all file:duration-200"
              />
              {seedFile && (
                <p className="text-xs text-amber-400 mt-2">
                  Selected: {seedFile.name} ({(seedFile.size / 1024).toFixed(1)}{" "}
                  KB)
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSeedUpload}
                disabled={seedLoading || !seedFile}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-amber-500 to-orange-600
                           hover:from-amber-400 hover:to-orange-500
                           disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-[0_0_10px_rgba(245,158,11,0.3)]
                           transition-all duration-200"
              >
                {seedLoading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Seeding...
                  </span>
                ) : (
                  "Upload & Seed"
                )}
              </button>
              <button
                type="button"
                onClick={() => setSeedModalOpen(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-400
                           bg-white/5 border border-white/10 hover:bg-white/10
                           transition-all duration-200"
              >
                Cancel
              </button>
            </div>

            {seedResult && (
              <div
                className={`mt-5 p-4 rounded-xl border ${seedResult.success ? "border-amber-500/30 bg-amber-500/5" : "border-red-500/30 bg-red-500/5"}`}
              >
                {seedResult.success ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-amber-400 font-semibold">
                      Seeding Complete ✓
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-gray-300">
                      <div>
                        <span className="text-gray-500">Total upserted:</span>{" "}
                        <span className="text-amber-400 font-mono">
                          {seedResult.upsertedCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Created:</span>{" "}
                        <span className="text-emerald-400 font-mono">
                          {seedResult.createdCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Updated:</span>{" "}
                        <span className="text-blue-400 font-mono">
                          {seedResult.updatedCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Total verified:</span>{" "}
                        <span className="text-cyan-400 font-mono">
                          {seedResult.totalVerifiedCount}
                        </span>
                      </div>
                    </div>
                    {seedResult.skippedRows &&
                      seedResult.skippedRows.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-amber-500 mb-2">
                            Skipped Rows ({seedResult.skippedCount})
                          </p>
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {seedResult.skippedRows.map((r, i) => (
                              <div
                                key={i}
                                className="text-xs text-gray-500 bg-white/5 rounded px-2 py-1"
                              >
                                Row {r.row}: "{r.city}" → "{r.zone}" —{" "}
                                {r.reason}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                ) : (
                  <p className="text-sm text-red-400">
                    {seedResult.error || "Unknown error"}
                    {seedResult.details && (
                      <span className="block text-xs text-red-500 mt-1">
                        {seedResult.details}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
