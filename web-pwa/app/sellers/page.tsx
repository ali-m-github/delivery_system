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
  });
  const [submitting, setSubmitting] = useState(false);

  // Rates Modal State
  const [isRatesModalOpen, setIsRatesModalOpen] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<any | null>(null);
  const [stagedRates, setStagedRates] = useState<any[]>([]);
  const [zoneRangeInput, setZoneRangeInput] = useState("");
  const [rateInput, setRateInput] = useState("");

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
        }),
      });
      if (res.ok) {
        setNewSeller({
          merchantName: "",
          contactName: "",
          phone: "",
          address: "",
          socialMedia: "",
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
    const existing = (seller.zoneRates || [])
      .map((zr: any) => ({
        zone: zones.find((z) => z.id === zr.zoneId),
        rate: zr.rate,
      }))
      .filter((sr: any) => sr.zone);
    setStagedRates(existing);
    setIsRatesModalOpen(true);
  };

  const handleAddBatchRates = () => {
    if (!zoneRangeInput || !rateInput) return;
    const rVal = parseFloat(rateInput);
    if (isNaN(rVal)) return;

    let targetNames: string[] = [];
    const parts = zoneRangeInput.split(",");

    parts.forEach((p) => {
      const trimmed = p.trim();
      if (trimmed.includes("-")) {
        const [startStr, endStr] = trimmed.split("-");
        const start = parseInt(startStr.replace(/\D/g, ""));
        const end = parseInt(endStr.replace(/\D/g, ""));
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            targetNames.push(i.toString());
            targetNames.push(`Z${i}`);
          }
        }
      } else {
        targetNames.push(trimmed);
        targetNames.push(`Z${trimmed}`);
      }
    });

    const matched = zones.filter(
      (z) =>
        targetNames.includes(z.name) ||
        targetNames.includes(z.name.toUpperCase()),
    );

    if (matched.length === 0)
      return alert(`No zones found matching: ${zoneRangeInput}`);

    const updated = [...stagedRates];
    matched.forEach((mz) => {
      const idx = updated.findIndex((sr) => sr.zone.id === mz.id);
      if (idx > -1) updated[idx].rate = rVal;
      else updated.push({ zone: mz, rate: rVal });
    });

    setStagedRates(updated);
    setZoneRangeInput("");
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

  const handleSaveRates = async () => {
    try {
      const payload = {
        merchantId: selectedSeller.id,
        rates: stagedRates.map((sr) => ({ zoneId: sr.zone.id, rate: sr.rate })),
      };
      const res = await fetch("/api/sellers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsRatesModalOpen(false);
        fetchData(); // Refreshes the board to show updated data
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
                          Edit Rates
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

      {/* SMART RATES MODAL */}
      {isRatesModalOpen && selectedSeller && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] relative z-10">
            <div className="p-6 border-b border-gray-800 bg-slate-950 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white">
                  Zone Rates: {selectedSeller.merchantName}
                </h2>
                <p className="text-sm text-gray-400">
                  Batch add rates using ranges (e.g., 2-9) or specific zones.
                </p>
              </div>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              <div className="flex gap-3 items-end bg-slate-800/50 p-4 rounded-lg border border-gray-700 mb-6">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
                    Zone(s) or Range
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 1, 2-9, Z14"
                    value={zoneRangeInput}
                    onChange={(e) => setZoneRangeInput(e.target.value)}
                    className="w-full bg-slate-950 border border-gray-600 rounded p-2.5 text-white focus:border-cyan-500 focus:outline-none placeholder-gray-600"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
                    Rate ($)
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    className="w-full bg-slate-950 border border-gray-600 rounded p-2.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleAddBatchRates}
                  className="bg-cyan-700 hover:bg-cyan-600 text-white font-bold py-2.5 px-6 rounded transition-colors h-[46px]"
                >
                  Add
                </button>
              </div>

              <h3 className="text-sm font-bold text-gray-400 uppercase mb-3 border-b border-gray-800 pb-2">
                Configured Rates ({stagedRates.length})
              </h3>
              {stagedRates.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">
                  No rates configured yet. Use the batch tool above.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {stagedRates.map((sr, index) => (
                    <div
                      key={index}
                      className="flex justify-between items-center bg-slate-950 border border-gray-800 rounded p-3"
                    >
                      <span className="font-bold text-cyan-400">
                        {sr.zone.name}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-gray-300">
                          ${sr.rate.toFixed(2)}
                        </span>
                        <button
                          onClick={() =>
                            setStagedRates(
                              stagedRates.filter((_, i) => i !== index),
                            )
                          }
                          className="text-red-500 hover:text-red-400 font-bold"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                Save All Rates
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
