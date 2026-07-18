"use client";

import { useState, useEffect, FormEvent } from "react";

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

interface CreateDriverModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const VEHICLE_OPTIONS = ["MOTORCYCLE", "CAR", "VAN"] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateDriverModal({
  onClose,
  onSuccess,
}: CreateDriverModalProps) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  // ── Form fields ──
  const [driverId, setDriverId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [bulkRate, setBulkRate] = useState("");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [assignedRates, setAssignedRates] = useState<Record<string, number>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Seller Exception state ──
  const [sellerExceptions, setSellerExceptions] = useState<SellerException[]>(
    [],
  );
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [exceptionRate, setExceptionRate] = useState("");

  // ── Fetch zones & merchants on mount ──
  useEffect(() => {
    fetch("/api/admin/zones")
      .then((r) => r.ok && r.json())
      .then((data) => setZones(data || []))
      .catch(() => {});
    fetch("/api/admin/merchants")
      .then((r) => r.ok && r.json())
      .then((data) => setMerchants(data || []))
      .catch(() => {});
  }, []);

  // ── Vehicle toggle ──
  const toggleVehicle = (v: string) => {
    setSelectedVehicles((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  // ── Reset form ──
  const resetForm = () => {
    setDriverId("");
    setUsername("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setPhotoFile(null);
    setSelectedVehicles([]);
    setBulkRate("");
    setSelectedZones([]);
    setAssignedRates({});
    setSellerExceptions([]);
    setSelectedMerchant("");
    setExceptionRate("");
  };

  // ── Submit ──
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !driverId.trim() ||
      !username.trim() ||
      !firstName.trim() ||
      !lastName.trim() ||
      !password
    )
      return;

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("driverId", driverId);
      formData.append("username", username);
      formData.append("password", password);
      formData.append("firstName", firstName);
      formData.append("lastName", lastName);
      if (photoFile) formData.append("photo", photoFile);
      formData.append("vehicles", JSON.stringify(selectedVehicles));
      const ratesArray = Object.entries(assignedRates).map(
        ([zoneId, rate]) => ({ zoneId, rate: Number(rate) }),
      );
      formData.append("zoneRates", JSON.stringify(ratesArray));
      if (sellerExceptions.length > 0) {
        formData.append(
          "sellerExceptions",
          JSON.stringify(
            sellerExceptions.map((ex) => ({
              merchantId: ex.merchantId,
              rate: ex.rate,
            })),
          ),
        );
      }

      const res = await fetch("/api/admin/drivers", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        resetForm();
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create driver");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0B0F17]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0B0F17]/95 backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-gray-200">
            Register New Driver
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Driver ID */}
          <div>
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
              placeholder="D-001"
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="driverUsername"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Username (Login)
              </label>
              <input
                id="driverUsername"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="janedoe"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="driverPassword"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Password
              </label>
              <input
                id="driverPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
          </div>

          {/* First Name & Last Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="driverFirstName"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                First Name
              </label>
              <input
                id="driverFirstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="driverLastName"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Last Name
              </label>
              <input
                id="driverLastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
          </div>

          {/* Profile Photo */}
          <div>
            <label
              htmlFor="driverPhoto"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Profile Photo
            </label>
            <input
              id="driverPhoto"
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4
                         file:rounded-lg file:border-0 file:text-sm file:font-semibold
                         file:bg-cyan-500/20 file:text-cyan-300
                         hover:file:bg-cyan-500/30 file:cursor-pointer file:transition-all file:duration-200
                         focus:outline-none"
            />
          </div>

          {/* Vehicles */}
          <div>
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

          {/* Commission Rates by Zone */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Commission Rates by Zone
            </span>
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
                                ? prev.filter((id) => id !== zone.id)
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
                                  prev.filter((id) => id !== zoneId),
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

          {/* Seller Rate Exceptions */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Seller Rate Exceptions
            </span>
            {merchants.length === 0 ? (
              <p className="text-sm text-gray-500">
                No merchants available. Create a seller first.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Add Exception Mini-Form */}
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px] max-w-xs">
                    <label
                      htmlFor="exceptionMerchant"
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Seller
                    </label>
                    <select
                      id="exceptionMerchant"
                      value={selectedMerchant}
                      onChange={(e) => setSelectedMerchant(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                                 transition-all duration-200 text-sm"
                    >
                      <option value="" disabled>
                        Select seller...
                      </option>
                      {merchants.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.merchantName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[120px] max-w-[160px]">
                    <label
                      htmlFor="exceptionRateInput"
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Rate ($)
                    </label>
                    <input
                      id="exceptionRateInput"
                      type="number"
                      step="0.01"
                      min="0"
                      value={exceptionRate}
                      onChange={(e) => setExceptionRate(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                                 transition-all duration-200 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const rate = parseFloat(exceptionRate);
                      if (!selectedMerchant || isNaN(rate) || rate <= 0) return;
                      const alreadyAdded = sellerExceptions.some(
                        (ex) => ex.merchantId === selectedMerchant,
                      );
                      if (alreadyAdded) {
                        setError("This seller already has an exception rate.");
                        return;
                      }
                      const merchant = merchants.find(
                        (m) => m.id === selectedMerchant,
                      );
                      setSellerExceptions((prev) => [
                        ...prev,
                        {
                          merchantId: selectedMerchant,
                          rate,
                          merchantName:
                            merchant?.merchantName ?? selectedMerchant,
                        },
                      ]);
                      setSelectedMerchant("");
                      setExceptionRate("");
                      setError("");
                    }}
                    disabled={!selectedMerchant || !exceptionRate.trim()}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600
                               hover:from-purple-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                               transition-all duration-200"
                  >
                    Add Exception
                  </button>
                </div>

                {/* Exceptions List */}
                {sellerExceptions.length > 0 && (
                  <div className="pt-2">
                    <span className="block text-xs font-medium text-gray-400 mb-2">
                      Current Exceptions ({sellerExceptions.length})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {sellerExceptions.map((ex) => (
                        <div
                          key={ex.merchantId}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20"
                        >
                          <span className="text-xs text-purple-300 font-medium">
                            {ex.merchantName}: ${ex.rate.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSellerExceptions((prev) =>
                                prev.filter(
                                  (e) => e.merchantId !== ex.merchantId,
                                ),
                              );
                            }}
                            className="text-red-400 hover:text-red-300 transition-colors text-sm leading-none"
                            title="Remove exception"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={
                loading ||
                !driverId.trim() ||
                !username.trim() ||
                !firstName.trim() ||
                !lastName.trim() ||
                !password
              }
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                         hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                         transition-all duration-200"
            >
              {loading ? "Creating..." : "Create Driver"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-300 bg-white/5 border border-white/10
                         hover:bg-white/10 hover:text-white transition-all duration-200"
            >
              Cancel
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  );
}
