"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export default function SellersPage() {
  const [sellers, setSellers] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newSeller, setNewSeller] = useState({
    merchantName: "",
    contactName: "",
    phone: "",
    address: "",
    socialMedia: "",
    isCashSeller: false,
    defaultSellerRate: "",
    defaultCompanyRate: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // Zone Overrides Modal State
  const [isRatesModalOpen, setIsRatesModalOpen] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<any | null>(null);
  // stagedRates now includes: { zone, rateUsd, rateLbp, overridden }
  const [stagedRates, setStagedRates] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sellersRes, zonesRes] = await Promise.all([
        fetch("/api/sellers"),
        fetch("/api/admin/zones"),
      ]);
      if (sellersRes.ok) setSellers(await sellersRes.json());
      if (zonesRes.ok) setZones(await zonesRes.json());
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSeller.merchantName.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantName: newSeller.merchantName.trim(),
          contactName: newSeller.contactName.trim() || null,
          phone: newSeller.phone.trim() || null,
          address: newSeller.address?.trim() || null,
          socialMedia: newSeller.socialMedia?.trim() || null,
          isCashSeller: newSeller.isCashSeller,
          defaultSellerRate: newSeller.isCashSeller
            ? parseFloat(newSeller.defaultSellerRate) || null
            : null,
          defaultCompanyRate: newSeller.isCashSeller
            ? parseFloat(newSeller.defaultCompanyRate) || null
            : null,
        }),
      });
      if (res.ok) {
        setNewSeller({
          merchantName: "",
          contactName: "",
          phone: "",
          address: "",
          socialMedia: "",
          isCashSeller: false,
          defaultSellerRate: "",
          defaultCompanyRate: "",
        });
        setIsAddModalOpen(false);
        await fetchData();
      } else {
        alert("Failed to create seller.");
      }
    } catch (err) {
      alert("Failed to create seller.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRates = (seller: any) => {
    setSelectedSeller(seller);
    // Build override map from existing merchant zone rates
    const overrideMap = new Map();
    (seller.zoneRates || []).forEach((zr: any) => {
      overrideMap.set(zr.zoneId, {
        rateUsd: zr.rate,
        rateLbp: zr.rateLbp || 0,
      });
    });
    // Build staged rates from ALL zones, marking which have overrides
    const allRates = zones.map((z: any) => {
      const existing = overrideMap.get(z.id);
      return {
        zone: z,
        rateUsd: existing ? existing.rateUsd : z.basePriceUsd,
        rateLbp: existing ? existing.rateLbp : z.basePriceLbp,
        overridden: !!existing,
      };
    });
    setStagedRates(allRates);
    setIsRatesModalOpen(true);
  };

  const handleDeleteSeller = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${name}? This will also delete their custom rates.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/sellers?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchData(); // Refresh the board
      } else {
        alert("Failed to delete seller.");
      }
    } catch (e) {
      alert("Error deleting seller.");
    }
  };

  const handleUpdateRate = (
    index: number,
    field: "rateUsd" | "rateLbp",
    value: string,
  ) => {
    const updated = [...stagedRates];
    const numVal = value === "" ? 0 : parseFloat(value);
    updated[index] = {
      ...updated[index],
      [field]: isNaN(numVal) ? 0 : numVal,
      overridden: true,
    };
    setStagedRates(updated);
  };

  const handleResetRate = (index: number) => {
    const z = stagedRates[index].zone;
    const updated = [...stagedRates];
    updated[index] = {
      ...updated[index],
      rateUsd: z.basePriceUsd,
      rateLbp: z.basePriceLbp,
      overridden: false,
    };
    setStagedRates(updated);
  };

  const handleApplyUniversal = () => {
    const updated = stagedRates.map((sr: any) => ({
      ...sr,
      rateUsd: sr.zone.basePriceUsd,
      rateLbp: sr.zone.basePriceLbp,
      overridden: false,
    }));
    setStagedRates(updated);
  };

  const handleSaveRates = async () => {
    try {
      const payload = {
        merchantId: selectedSeller.id,
        rates: stagedRates
          .filter((sr: any) => sr.overridden)
          .map((sr: any) => ({
            zoneId: sr.zone.id,
            rate: sr.rateUsd,
            rateLbp: sr.rateLbp,
          })),
      };
      const res = await fetch("/api/sellers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsRatesModalOpen(false);
        fetchData();
      } else {
        alert("Failed to save rates");
      }
    } catch (e) {
      alert("Error saving rates");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400">Sellers List</h1>
            <p className="text-gray-400">
              Manage sellers and their zone-based shipping rates.
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-cyan-800 hover:bg-cyan-700 text-cyan-100 px-4 py-2 rounded font-bold transition-colors"
            >
              + Add New Seller
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-gray-400">Loading sellers...</p>
        ) : (
          <div className="overflow-x-auto bg-slate-900 border border-gray-800 rounded-md shadow-xl">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-950 border-b border-gray-800 text-gray-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="p-4">ID</th>
                  <th className="p-4">Business Name</th>
                  <th className="p-4">Contact</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4">Address</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {sellers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-gray-500">
                      No sellers found.
                    </td>
                  </tr>
                ) : (
                  sellers.map((seller) => (
                    <tr
                      key={seller.id}
                      className="hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="p-4 font-mono text-cyan-500">
                        {seller.merchantId}
                      </td>
                      <td className="p-4 font-bold text-white">
                        {seller.merchantName}
                      </td>
                      <td className="p-4 text-gray-300">
                        {seller.contactName || "—"}
                      </td>
                      <td className="p-4 text-gray-300">
                        {seller.phone || "—"}
                      </td>
                      <td className="p-4 text-gray-300 truncate max-w-xs">
                        {seller.address || "—"}
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <Link
                          href={`/sellers/${seller.id}`}
                          className="inline-block bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 border border-blue-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold mr-2"
                        >
                          View Profile
                        </Link>
                        <button
                          onClick={() => handleOpenRates(seller)}
                          className="bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 border border-purple-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold mr-2"
                        >
                          Zone Overrides
                        </button>
                        <button
                          onClick={() =>
                            handleDeleteSeller(seller.id, seller.merchantName)
                          }
                          className="bg-red-600/20 text-red-400 hover:bg-red-600/40 border border-red-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADD NEW SELLER MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsAddModalOpen(false)}
          />
          <div className="bg-black/80 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden backdrop-blur-xl">
            <div className="p-6 border-b border-gray-800">
              <h2 className="text-xl font-bold text-white">Add New Seller</h2>
              <p className="text-sm text-gray-500 mt-1">
                Fill in the details to register a new seller.
              </p>
            </div>
            <form onSubmit={handleAddSeller} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Business Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. HiCart"
                    value={newSeller.merchantName}
                    onChange={(e) =>
                      setNewSeller({
                        ...newSeller,
                        merchantName: e.target.value,
                      })
                    }
                    className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={newSeller.contactName}
                    onChange={(e) =>
                      setNewSeller({
                        ...newSeller,
                        contactName: e.target.value,
                      })
                    }
                    className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Phone
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +1 (555) 123-4567"
                    value={newSeller.phone}
                    onChange={(e) =>
                      setNewSeller({ ...newSeller, phone: e.target.value })
                    }
                    className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Address
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 123 Main St, Beirut"
                    value={newSeller.address}
                    onChange={(e) =>
                      setNewSeller({ ...newSeller, address: e.target.value })
                    }
                    className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Social Media / Website
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. @merchant_ig or website.com"
                    value={newSeller.socialMedia}
                    onChange={(e) =>
                      setNewSeller({
                        ...newSeller,
                        socialMedia: e.target.value,
                      })
                    }
                    className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors"
                  />
                </div>

                {/* ── Cash Seller Toggle ── */}
                <div className="border-t border-gray-800 pt-4 mt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newSeller.isCashSeller}
                      onChange={(e) =>
                        setNewSeller({
                          ...newSeller,
                          isCashSeller: e.target.checked,
                        })
                      }
                      className="rounded border-gray-700 bg-[#111318] text-cyan-500 focus:ring-cyan-500/50 cursor-pointer w-4 h-4"
                    />
                    <span className="text-xs font-medium text-gray-300">
                      Enable Prepaid (Cash Seller) Factoring
                    </span>
                  </label>
                  <p className="text-[10px] text-gray-600 mt-1 ml-7">
                    When enabled, you can advance cash to this seller before
                    delivery, deducting a per-order fee.
                  </p>
                </div>

                {/* ── Conditional Rate Inputs ── */}
                {newSeller.isCashSeller && (
                  <div className="grid grid-cols-2 gap-3 mt-3 ml-7 p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-400 mb-1">
                        Default Seller Rate ($USD)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="$4.00"
                        value={newSeller.defaultSellerRate}
                        onChange={(e) =>
                          setNewSeller({
                            ...newSeller,
                            defaultSellerRate: e.target.value,
                          })
                        }
                        className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                      />
                      <p className="text-[10px] text-gray-600 mt-1">
                        Fee charged to seller per order
                      </p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-400 mb-1">
                        Default Company Cost Rate ($USD)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="$3.00"
                        value={newSeller.defaultCompanyRate}
                        onChange={(e) =>
                          setNewSeller({
                            ...newSeller,
                            defaultCompanyRate: e.target.value,
                          })
                        }
                        className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                      />
                      <p className="text-[10px] text-gray-600 mt-1">
                        Baseline delivery cost / target margin
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end space-x-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#232529] text-white hover:bg-gray-700 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#124046] text-[#42d4e6] px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50 hover:brightness-110"
                >
                  {submitting ? "Saving..." : "Create Seller"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ZONE OVERRIDES MODAL */}
      {isRatesModalOpen && selectedSeller && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] relative z-10">
            <div className="p-6 border-b border-gray-800 bg-slate-950 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white">
                  Zone Overrides: {selectedSeller.merchantName}
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  Override universal zone rates for this seller. Edit USD/LBP
                  values to set custom rates.
                </p>
              </div>
              <div className="flex gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  Overridden
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-600" />
                  Default (Universal)
                </span>
              </div>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 z-10">
                    <tr className="border-b border-gray-700 text-xs text-gray-400 uppercase tracking-wider">
                      <th className="py-3 px-3 text-left font-medium">Zone</th>
                      <th className="py-3 px-3 text-center font-medium">
                        Universal USD
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Universal LBP
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Seller USD
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Seller LBP
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Status
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {stagedRates.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-8 text-center text-gray-500"
                        >
                          No zones configured yet.
                        </td>
                      </tr>
                    ) : (
                      stagedRates.map((sr: any, index: number) => (
                        <tr
                          key={sr.zone.id}
                          className={`hover:bg-slate-800/30 transition-colors ${sr.overridden ? "bg-emerald-500/5" : ""}`}
                        >
                          {/* Zone Name */}
                          <td className="py-3 px-3 font-semibold text-white">
                            {sr.zone.name}
                          </td>

                          {/* Universal USD */}
                          <td className="py-3 px-3 text-center text-gray-400 font-mono text-xs">
                            ${sr.zone.basePriceUsd?.toFixed(2) ?? "0.00"}
                          </td>

                          {/* Universal LBP */}
                          <td className="py-3 px-3 text-center text-gray-400 font-mono text-xs">
                            {(sr.zone.basePriceLbp ?? 0).toLocaleString()}
                          </td>

                          {/* Seller USD - editable */}
                          <td className="py-3 px-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={sr.rateUsd ?? ""}
                              onChange={(e) =>
                                handleUpdateRate(
                                  index,
                                  "rateUsd",
                                  e.target.value,
                                )
                              }
                              className="w-24 mx-auto block bg-slate-950 border border-gray-700 rounded px-2 py-1 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                            />
                          </td>

                          {/* Seller LBP - editable */}
                          <td className="py-3 px-3">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={sr.rateLbp ?? ""}
                              onChange={(e) =>
                                handleUpdateRate(
                                  index,
                                  "rateLbp",
                                  e.target.value,
                                )
                              }
                              className="w-28 mx-auto block bg-slate-950 border border-gray-700 rounded px-2 py-1 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                            />
                          </td>

                          {/* Status Badge */}
                          <td className="py-3 px-3 text-center">
                            {sr.overridden ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                Custom
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-700/50 text-gray-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                                Default
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-center">
                            {sr.overridden && (
                              <button
                                onClick={() => handleResetRate(index)}
                                className="text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-2 py-1 rounded transition-colors"
                                title="Reset to universal rate"
                              >
                                Reset
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <span>
                  {stagedRates.filter((s: any) => s.overridden).length} of{" "}
                  {stagedRates.length} zones overridden
                </span>
                <button
                  onClick={handleApplyUniversal}
                  className="text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Apply Universal Rates to All
                </button>
              </div>
            </div>

            <div className="p-6 border-t border-gray-800 bg-slate-950 flex justify-end space-x-3 shrink-0">
              <button
                onClick={() => setIsRatesModalOpen(false)}
                className="px-6 py-2.5 rounded text-gray-400 hover:bg-slate-800 font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRates}
                className="bg-green-600 hover:bg-green-500 text-white px-8 py-2.5 rounded font-bold transition-colors shadow-lg shadow-green-900/20"
              >
                Save Overrides
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
