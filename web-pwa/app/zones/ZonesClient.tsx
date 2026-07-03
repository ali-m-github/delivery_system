"use client";

import { useState, useCallback } from "react";

// ─── Zone Type ─────────────────────────────────────────────────────────────────
interface Zone {
  id: string;
  name: string;
  basePriceUsd: number;
  basePriceLbp: number;
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
      </div>
    </div>
  );
}
