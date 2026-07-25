"use client";

import { useState, useEffect, FormEvent, use } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Zone {
  id: string;
  name: string;
}

interface Merchant {
  id: string;
  merchantName: string;
}

interface SellerException {
  merchantId: string;
  rate: number;
  merchantName: string;
}

interface ExistingSellerRate {
  id: number;
  merchantId: string;
  rateUsd: number;
  merchant: {
    id: string;
    merchantName: string;
    merchantId: string;
  };
}

interface DriverData {
  id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  vehicles: string[];
  user: { username: string; email: string } | null;
  zoneRates: { id: string; zoneId: string; rate: number; zone: Zone }[];
  driverSellerRates: ExistingSellerRate[];
  payouts: unknown[];
}

const VEHICLE_OPTIONS = ["MOTORCYCLE", "CAR", "VAN"] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminDriverProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // ── Data state ──
  const [driver, setDriver] = useState<DriverData | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Form fields ──
  const [driverId, setDriverId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [bulkRate, setBulkRate] = useState("");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [assignedRates, setAssignedRates] = useState<Record<string, number>>(
    {},
  );

  // ── Seller Rate Exceptions state (field array pattern) ──
  const [sellerRates, setSellerRates] = useState<SellerException[]>([]);
  const [selectedSeller, setSelectedSeller] = useState("");
  const [selectedRate, setSelectedRate] = useState("");

  // ── Fetch driver data, zones & merchants on mount ──
  useEffect(() => {
    async function loadData() {
      try {
        const [driverRes, zonesRes, merchantsRes] = await Promise.all([
          fetch(`/api/admin/drivers/${id}`),
          fetch("/api/admin/zones"),
          fetch("/api/admin/merchants"),
        ]);

        if (!driverRes.ok) {
          if (driverRes.status === 404) {
            setLoading(false);
            return;
          }
          throw new Error("Failed to load driver");
        }

        const driverData: DriverData = await driverRes.json();
        setDriver(driverData);

        // Populate form fields
        setDriverId(driverData.driverId);
        setFirstName(driverData.firstName);
        setLastName(driverData.lastName);
        setSelectedVehicles(driverData.vehicles || []);

        // Populate zone rates
        const ratesMap: Record<string, number> = {};
        for (const zr of driverData.zoneRates) {
          ratesMap[zr.zoneId] = zr.rate;
        }
        setAssignedRates(ratesMap);

        // Populate seller rate exceptions from existing data
        const existingExceptions: SellerException[] =
          driverData.driverSellerRates.map((sr) => ({
            merchantId: sr.merchantId,
            rate: sr.rateUsd,
            merchantName: sr.merchant.merchantName,
          }));
        setSellerRates(existingExceptions);

        if (zonesRes.ok) {
          const zonesData = await zonesRes.json();
          setZones(zonesData || []);
        }
        if (merchantsRes.ok) {
          const merchantsData = await merchantsRes.json();
          setMerchants(merchantsData || []);
        }
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id]);

  // ── Vehicle toggle ──
  const toggleVehicle = (v: string) => {
    setSelectedVehicles((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  // ── Submit ──
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!driverId.trim() || !firstName.trim() || !lastName.trim()) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("driverId", driverId);
      formData.append("firstName", firstName);
      formData.append("lastName", lastName);
      formData.append("vehicles", JSON.stringify(selectedVehicles));
      const ratesArray = Object.entries(assignedRates).map(
        ([zoneId, rate]) => ({ zoneId, rate: Number(rate) }),
      );
      formData.append("zoneRates", JSON.stringify(ratesArray));
      if (sellerRates.length > 0) {
        formData.append(
          "sellerExceptions",
          JSON.stringify(
            sellerRates.map((ex) => ({
              merchantId: ex.merchantId,
              rate: ex.rate,
            })),
          ),
        );
      }

      const res = await fetch(`/api/admin/drivers/${driver!.id}`, {
        method: "PUT",
        body: formData,
      });

      if (res.ok) {
        setSuccess("Driver updated successfully.");
        // Refresh driver data
        const updated = await res.json();
        setDriver(updated);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update driver");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-8 w-64 bg-white/5 rounded-lg" />
          <div className="h-4 w-48 bg-white/5 rounded-lg" />
          <p className="text-gray-500 text-sm">Loading driver profile…</p>
        </div>
      </div>
    );
  }

  // ── Not found state ──
  if (!driver) return notFound();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Background grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] pointer-events-none z-0" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
              Edit: {driver.firstName} {driver.lastName}
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              <span className="bg-white/5 px-2 py-1 rounded border border-white/10 font-mono text-cyan-400 mr-2">
                ID: {driver.driverId}
              </span>
              {driver.user?.username && (
                <span className="text-gray-500">@{driver.user.username}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-white/5 border border-white/10 transition-colors"
            >
              ← Back to Admin
            </Link>
            <Link
              href={`/drivers/${driver.driverId.toLowerCase()}`}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
            >
              Full Profile & Ledger →
            </Link>
          </div>
        </div>

        {/* Status messages */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Edit Form Section */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-6">
              Driver Details
            </h2>

            {/* Driver ID */}
            <div className="mb-4">
              <label
                htmlFor="driverId"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Driver ID
              </label>
              <input
                id="driverId"
                type="text"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>

            {/* First Name & Last Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="lastName"
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                />
              </div>
            </div>

            {/* Vehicles */}
            <div className="mb-4">
              <span className="block text-xs font-medium text-gray-400 mb-3">
                Vehicles
              </span>
              <div className="flex flex-wrap gap-4">
                {VEHICLE_OPTIONS.map((v) => (
                  <label
                    key={v}
                    className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedVehicles.includes(v)}
                      onChange={() => toggleVehicle(v)}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500
                                 focus:ring-cyan-500/40 focus:ring-offset-0
                                 cursor-pointer accent-cyan-500"
                    />
                    <span className="group-hover:text-white transition-colors duration-200">
                      {v.charAt(0) + v.slice(1).toLowerCase()}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Zone Rates */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-4">
              Zone Commission Rates
            </h2>
            {zones.length === 0 ? (
              <p className="text-sm text-gray-500">
                No zones available. Create a zone first.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Bulk Rate Input */}
                <div className="flex items-end gap-4">
                  <div className="flex-1 max-w-xs">
                    <label
                      htmlFor="bulkRate"
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Bulk Rate Amount ($)
                    </label>
                    <input
                      id="bulkRate"
                      type="number"
                      step="0.01"
                      min="0"
                      value={bulkRate}
                      onChange={(e) => setBulkRate(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                                 transition-all duration-200 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const amount = parseFloat(bulkRate);
                      if (
                        isNaN(amount) ||
                        amount <= 0 ||
                        selectedZones.length === 0
                      )
                        return;
                      setAssignedRates((prev) => {
                        const next = { ...prev };
                        selectedZones.forEach((zId) => {
                          next[zId] = amount;
                        });
                        return next;
                      });
                      setSelectedZones([]);
                      setBulkRate("");
                    }}
                    disabled={selectedZones.length === 0 || !bulkRate.trim()}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600
                               hover:from-purple-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                               transition-all duration-200"
                  >
                    Apply Rate
                  </button>
                </div>

                {/* Zone Checkboxes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {zones.map((zone) => {
                    const checked = selectedZones.includes(zone.id);
                    return (
                      <label
                        key={zone.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                          checked
                            ? "bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                            : "bg-white/5 border-white/10 hover:border-white/20"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedZones((prev) =>
                              prev.includes(zone.id)
                                ? prev.filter((zid) => zid !== zone.id)
                                : [...prev, zone.id],
                            );
                          }}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500
                                     focus:ring-cyan-500/40 focus:ring-offset-0
                                     cursor-pointer accent-cyan-500"
                        />
                        <span className="text-sm text-gray-300 min-w-0 flex-1 truncate">
                          {zone.name}
                        </span>
                        {assignedRates[zone.id] !== undefined && (
                          <span className="text-[10px] font-medium text-cyan-400 whitespace-nowrap">
                            ${assignedRates[zone.id].toFixed(2)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Assigned Rates Summary */}
                {Object.keys(assignedRates).length > 0 && (
                  <div className="pt-2">
                    <span className="block text-xs font-medium text-gray-400 mb-2">
                      Assigned Rates ({Object.keys(assignedRates).length})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(assignedRates).map(([zoneId, rate]) => {
                        const zone = zones.find((z) => z.id === zoneId);
                        return (
                          <div
                            key={zoneId}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20"
                          >
                            <span className="text-xs text-cyan-300 font-medium">
                              {zone?.name ?? zoneId}: ${rate.toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setAssignedRates((prev) => {
                                  const next = { ...prev };
                                  delete next[zoneId];
                                  return next;
                                });
                                setSelectedZones((prev) =>
                                  prev.filter((zid) => zid !== zoneId),
                                );
                              }}
                              className="text-red-400 hover:text-red-300 transition-colors text-sm leading-none"
                              title="Remove rate"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Seller Rate Exceptions Block */}
          <div className="mt-8 border-t border-gray-800 pt-6">
            <h3 className="text-lg font-medium mb-4 text-gray-200">
              Seller Rate Exceptions
            </h3>
            <div className="flex gap-4 items-end mb-4">
              <div className="flex-1">
                <label className="block text-sm mb-2 text-gray-400">
                  Seller
                </label>
                <select
                  value={selectedSeller}
                  onChange={(e) => setSelectedSeller(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-[#0b1329] border border-gray-800 text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                >
                  <option
                    value=""
                    disabled
                    style={{ background: "#0b1329", color: "#9ca3af" }}
                  >
                    Select seller...
                  </option>
                  {merchants.map((s) => (
                    <option
                      key={s.id}
                      value={s.id}
                      style={{ background: "#0b1329", color: "#e5e7eb" }}
                    >
                      {s.merchantName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm mb-2 text-gray-400">
                  Rate ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={selectedRate}
                  onChange={(e) => setSelectedRate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const rate = parseFloat(selectedRate);
                  if (!selectedSeller || isNaN(rate) || rate <= 0) return;
                  const alreadyAdded = sellerRates.some(
                    (ex) => ex.merchantId === selectedSeller,
                  );
                  if (alreadyAdded) {
                    setError("This seller already has an exception rate.");
                    return;
                  }
                  const merchant = merchants.find(
                    (m) => m.id === selectedSeller,
                  );
                  setSellerRates((prev) => [
                    ...prev,
                    {
                      merchantId: selectedSeller,
                      rate,
                      merchantName: merchant?.merchantName ?? selectedSeller,
                    },
                  ]);
                  setSelectedSeller("");
                  setSelectedRate("");
                  setError("");
                }}
                disabled={!selectedSeller || !selectedRate.trim()}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-purple-700 hover:bg-purple-600
                           disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                Add Exception
              </button>
            </div>

            {/* Render existing/appended rates */}
            <div className="space-y-2">
              {sellerRates.map((field, index) => (
                <div
                  key={field.merchantId}
                  className="flex justify-between p-3 bg-gray-900 rounded border border-gray-800"
                >
                  <span>{field.merchantName}</span>
                  <span>${field.rate.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSellerRates((prev) =>
                        prev.filter((_, i) => i !== index),
                      )
                    }
                    className="text-red-500 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={
                saving ||
                !driverId.trim() ||
                !firstName.trim() ||
                !lastName.trim()
              }
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                         hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                         transition-all duration-200"
            >
              {saving ? "Updating..." : "Update Driver"}
            </button>
            <Link
              href="/admin"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-300 bg-white/5 border border-white/10
                         hover:bg-white/10 hover:text-white transition-all duration-200"
            >
              Cancel
            </Link>
          </div>
        </form>

        {/* Recent Payouts */}
        <div className="mt-6 backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            Recent Payouts ({driver.payouts.length})
          </h2>
          {driver.payouts.length === 0 ? (
            <p className="text-sm text-gray-500">No payout history.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4 font-medium">#</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">
                      Total USD
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      Commission
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      Net USD
                    </th>
                    <th className="py-3 px-4 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(
                    driver.payouts as Array<{
                      id: string;
                      sequentialIndex: number;
                      status: string;
                      totalUsd: number;
                      commissionUsd: number;
                      netUsd: number;
                      createdAt: string;
                    }>
                  ).map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-cyan-400">
                        #{p.sequentialIndex}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                            p.status === "CLEARED"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-green-400 font-mono">
                        ${p.totalUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-red-400 font-mono">
                        -${p.commissionUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-cyan-400 font-mono font-bold">
                        ${p.netUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-xs">
                        {new Date(p.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
