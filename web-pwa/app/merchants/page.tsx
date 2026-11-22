"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export default function SellersPage() {
  const [sellers, setSellers] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    defaultProfitRate: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSeller, setEditingSeller] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    merchantName: "",
    contactName: "",
    phone: "",
    address: "",
    socialMedia: "",
    isCashSeller: false,
    defaultSellerRate: "",
    defaultProfitRate: "",
  });
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);

  // Zone Rate Rules Modal State (zone-range + rate + effective date rules;
  // resolution lives in lib/merchantRates.ts, CRUD in
  // /api/admin/merchants/[id]/rate-rules)
  const [isRatesModalOpen, setIsRatesModalOpen] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<any | null>(null);
  const [rateRules, setRateRules] = useState<any[]>([]);
  const [rateRulesLoading, setRateRulesLoading] = useState(false);
  const [rateRulesSaving, setRateRulesSaving] = useState(false);
  const [rateRuleError, setRateRuleError] = useState<string | null>(null);
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const emptyRuleForm = () => ({
    id: null as string | null,
    zoneFrom: "",
    zoneTo: "",
    rateUsd: "",
    rateLbp: "",
    effectiveFrom: todayStr(),
  });
  const [ruleForm, setRuleForm] = useState(emptyRuleForm());
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  // Inline delete confirmation: ruleId currently awaiting confirmation
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<
    string | null
  >(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sellersRes, zonesRes] = await Promise.all([
        fetch("/api/admin/merchants"),
        fetch("/api/admin/zones"),
      ]);

      if (!sellersRes.ok) {
        const errBody = await sellersRes.json().catch(() => null);
        setError(
          `Failed to load merchants (${sellersRes.status}): ${
            (errBody as { error?: string } | null)?.error ??
            sellersRes.statusText
          }`,
        );
      } else {
        setSellers(await sellersRes.json());
      }

      if (!zonesRes.ok) {
        setError((prev) => prev ?? `Failed to load zones (${zonesRes.status})`);
      } else {
        setZones(await zonesRes.json());
      }
    } catch (err: any) {
      console.error("Failed to fetch data", err);
      setError(`Data fetch error: ${err?.message ?? String(err)}`);
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
      const payload: Record<string, string | number | boolean | null> = {
        merchantName: newSeller.merchantName.trim(),
        contactName: newSeller.contactName.trim() || null,
        phone: newSeller.phone.trim() || null,
        address: newSeller.address?.trim() || null,
        socialMedia: newSeller.socialMedia?.trim() || null,
        isCashSeller: newSeller.isCashSeller,
        defaultSellerRate: newSeller.isCashSeller
          ? parseFloat(newSeller.defaultSellerRate) || null
          : null,
        defaultProfitRate: newSeller.isCashSeller
          ? parseFloat(newSeller.defaultProfitRate) || null
          : null,
      };

      let res: Response;
      if (logoFile) {
        // Use FormData (multipart) when a file is attached so the image can be uploaded
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== null && value !== undefined)
            formData.append(key, String(value));
        });
        formData.append("logo", logoFile);
        res = await fetch("/api/admin/merchants", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/admin/merchants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        setNewSeller({
          merchantName: "",
          contactName: "",
          phone: "",
          address: "",
          socialMedia: "",
          isCashSeller: false,
          defaultSellerRate: "",
          defaultProfitRate: "",
        });
        setLogoFile(null);
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

  const handleOpenEdit = (seller: any) => {
    setEditingSeller(seller);
    setEditForm({
      merchantName: seller.merchantName ?? "",
      contactName: seller.contactName ?? "",
      phone: seller.phone ?? "",
      address: seller.address ?? "",
      socialMedia: seller.socialMedia ?? "",
      isCashSeller: !!seller.isCashSeller,
      defaultSellerRate: seller.defaultSellerRate != null ? String(seller.defaultSellerRate) : "",
      defaultProfitRate: seller.defaultProfitRate != null ? String(seller.defaultProfitRate) : "",
    });
    setEditLogoFile(null);
    setIsEditModalOpen(true);
  };

  const handleUpdateSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSeller || !editForm.merchantName.trim()) return;

    setSubmitting(true);
    try {
      const payload: Record<string, string | number | boolean | null> = {
        merchantName: editForm.merchantName.trim(),
        contactName: editForm.contactName.trim() || null,
        phone: editForm.phone.trim() || null,
        address: editForm.address?.trim() || null,
        socialMedia: editForm.socialMedia?.trim() || null,
        isCashSeller: editForm.isCashSeller,
        defaultSellerRate: editForm.isCashSeller
          ? parseFloat(editForm.defaultSellerRate) || null
          : null,
        defaultProfitRate: editForm.isCashSeller
          ? parseFloat(editForm.defaultProfitRate) || null
          : null,
      };

      let res: Response;
      if (editLogoFile) {
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== null && value !== undefined)
            formData.append(key, String(value));
        });
        formData.append("logo", editLogoFile);
        res = await fetch(`/api/admin/merchants/${editingSeller.id}`, {
          method: "PATCH",
          body: formData,
        });
      } else {
        res = await fetch(`/api/admin/merchants/${editingSeller.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        setIsEditModalOpen(false);
        setEditingSeller(null);
        setEditLogoFile(null);
        await fetchData();
      } else {
        const errBody = await res.json().catch(() => null);
        alert(
          `Failed to update seller: ${
            (errBody as { error?: string } | null)?.error ?? res.statusText
          }`,
        );
      }
    } catch (err) {
      alert("Error updating seller.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Zone Rate Rules modal handlers ─────────────────────────────────────
  // Rules charge a merchant per order for a span of zones (e.g. 2–9) on
  // orders received on/after the rule's effective date. Orders matching no
  // rule are charged the universal zone price (lib/merchantRates.ts).
  const loadRateRules = async (sellerId: string) => {
    setRateRulesLoading(true);
    try {
      const res = await fetch(
        `/api/admin/merchants/${sellerId}/rate-rules`,
      );
      if (res.ok) {
        setRateRules(await res.json());
      } else {
        setRateRules([]);
        alert("Failed to load zone rate rules.");
      }
    } catch (e) {
      setRateRules([]);
      alert("Error loading zone rate rules.");
    } finally {
      setRateRulesLoading(false);
    }
  };

  const handleOpenRates = (seller: any) => {
    setSelectedSeller(seller);
    setRateRules([]);
    setRateRuleError(null);
    setEditingRuleId(null);
    setConfirmDeleteRuleId(null);
    setRuleForm(emptyRuleForm());
    setIsRatesModalOpen(true);
    loadRateRules(seller.id);
  };

  const closeRatesModal = () => {
    setIsRatesModalOpen(false);
    setSelectedSeller(null);
    setRateRules([]);
    setRateRuleError(null);
    setEditingRuleId(null);
    setConfirmDeleteRuleId(null);
  };

  const startEditRule = (rule: any) => {
    setEditingRuleId(rule.id);
    setConfirmDeleteRuleId(null);
    setRateRuleError(null);
    setRuleForm({
      id: rule.id,
      zoneFrom: String(rule.zoneFrom),
      zoneTo: String(rule.zoneTo),
      rateUsd: String(rule.rate ?? ""),
      rateLbp: String(rule.rateLbp ?? ""),
      effectiveFrom: rule.effectiveFrom
        ? new Date(rule.effectiveFrom).toISOString().slice(0, 10)
        : todayStr(),
    });
  };

  const cancelEditRule = () => {
    setEditingRuleId(null);
    setRuleForm(emptyRuleForm());
    setRateRuleError(null);
  };

  const handleSaveRule = async () => {
    if (!selectedSeller) return;
    setRateRuleError(null);

    const zoneFrom = parseInt(ruleForm.zoneFrom, 10);
    const zoneTo = parseInt(ruleForm.zoneTo, 10);
    const rateUsd = parseFloat(ruleForm.rateUsd);
    const rateLbp =
      ruleForm.rateLbp === "" ? 0 : parseFloat(ruleForm.rateLbp);

    if (
      !Number.isInteger(zoneFrom) ||
      !Number.isInteger(zoneTo) ||
      zoneFrom < 0 ||
      zoneTo < 0 ||
      zoneFrom > zoneTo
    ) {
      setRateRuleError("Zone range must be whole numbers ≥ 0 with from ≤ to.");
      return;
    }
    if (!Number.isFinite(rateUsd) || rateUsd < 0) {
      setRateRuleError("USD rate must be a number ≥ 0.");
      return;
    }
    if (!Number.isFinite(rateLbp) || rateLbp < 0) {
      setRateRuleError("LBP rate must be a number ≥ 0.");
      return;
    }
    if (!ruleForm.effectiveFrom) {
      setRateRuleError("Effective-from date is required.");
      return;
    }

    setRateRulesSaving(true);
    try {
      const res = await fetch(
        `/api/admin/merchants/${selectedSeller.id}/rate-rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingRuleId ?? undefined,
            zoneFrom,
            zoneTo,
            rate: rateUsd,
            rateLbp,
            effectiveFrom: ruleForm.effectiveFrom,
          }),
        },
      );
      if (res.ok) {
        await loadRateRules(selectedSeller.id);
        cancelEditRule();
      } else {
        const body = await res.json().catch(() => null);
        setRateRuleError(body?.error || "Failed to save rule.");
      }
    } catch (e) {
      setRateRuleError("Error saving rule.");
    } finally {
      setRateRulesSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedSeller) return;
    setRateRuleError(null);
    try {
      const res = await fetch(
        `/api/admin/merchants/${selectedSeller.id}/rate-rules?ruleId=${encodeURIComponent(ruleId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        if (editingRuleId === ruleId) cancelEditRule();
        setConfirmDeleteRuleId(null);
        await loadRateRules(selectedSeller.id);
      } else {
        setRateRuleError("Failed to delete rule.");
      }
    } catch (e) {
      setRateRuleError("Error deleting rule.");
    }
  };

  const handleDeleteSeller = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${name}? This will also delete their custom rates.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/admin/merchants?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchData(); // Refresh the board
      } else {
        alert("Failed to delete seller.");
      }
    } catch (e) {
      alert("Error deleting seller.");
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

        {/* Inline error state — surface the exact failure reason instead of a silent/looping redirect */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <strong>Access Denied or Data Mismatch:</strong> {error}
          </div>
        )}

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
                        <div className="flex items-center gap-2">
                          <span>{seller.merchantName}</span>
                          {seller.user ? (
                            <span
                              title={`Login: ${seller.user.username} (${seller.user.email})`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20"
                           >
                              has account
                            </span>
                          ) : (
                            <span
                              title="No login account linked yet"
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            >
                              no account
                            </span>
                          )}
                        </div>
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
                          href={`/merchants/${seller.id}`}
                          className="inline-block bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 border border-blue-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold mr-2"
                        >
                          View Profile
                        </Link>
                        <button
                          onClick={() => handleOpenEdit(seller)}
                          className="bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/40 border border-cyan-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold mr-2"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleOpenRates(seller)}
                          className="bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 border border-purple-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold mr-2"
                        >
                          Zone Rates
                        </button>
                        {!seller.user && (
                          <Link
                            href={`/admin?tab=merchants&merchantId=${seller.id}`}
                            title="Create a login account linked to this seller"
                            className="bg-green-600/20 text-green-400 hover:bg-green-600/40 border border-green-500/30 px-3 py-1.5 rounded transition-colors text-xs font-bold mr-2"
                          >
                            Create account
                          </Link>
                        )}
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
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Logo
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#124046] file:text-[#42d4e6] file:font-bold file:cursor-pointer cursor-pointer"
                  />
                  <p className="text-[10px] text-gray-600 mt-1">
                    Optional. Upload a square PNG/JPG/WebP logo (displayed as a
                    rounded avatar).
                  </p>
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
                        Default Profit Rate ($USD)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="$1.00"
                        value={newSeller.defaultProfitRate}
                        onChange={(e) =>
                          setNewSeller({
                            ...newSeller,
                            defaultProfitRate: e.target.value,
                          })
                        }
                        className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                      />
                      <p className="text-[10px] text-gray-600 mt-1">
                        Company profit per order. Total fee = seller rate +
                        profit.
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

      {/* EDIT SELLER MODAL */}
      {isEditModalOpen && editingSeller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsEditModalOpen(false)}
          />
          <div className="bg-black/80 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden backdrop-blur-xl">
            <div className="p-6 border-b border-gray-800">
              <h2 className="text-xl font-bold text-white">Edit Seller</h2>
              <p className="text-sm text-gray-500 mt-1">
                Update the details for {editingSeller.merchantName}.
              </p>
            </div>
            <form onSubmit={handleUpdateSeller} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Business Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. HiCart"
                    value={editForm.merchantName}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
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
                    value={editForm.contactName}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
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
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm({ ...editForm, phone: e.target.value })
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
                    value={editForm.address}
                    onChange={(e) =>
                      setEditForm({ ...editForm, address: e.target.value })
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
                    value={editForm.socialMedia}
                    onChange={(e) =>
                      setEditForm({ ...editForm, socialMedia: e.target.value })
                    }
                    className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Logo
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setEditLogoFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#124046] file:text-[#42d4e6] file:font-bold file:cursor-pointer cursor-pointer"
                  />
                  <p className="text-[10px] text-gray-600 mt-1">
                    Optional. Upload a new square PNG/JPG/WebP logo to replace
                    the current one.
                  </p>
                </div>

                {/* ── Cash Seller Toggle ── */}
                <div className="border-t border-gray-800 pt-4 mt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.isCashSeller}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
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
                {editForm.isCashSeller && (
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
                        value={editForm.defaultSellerRate}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
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
                        Default Profit Rate ($USD)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="$1.00"
                        value={editForm.defaultProfitRate}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            defaultProfitRate: e.target.value,
                          })
                        }
                        className="w-full bg-[#111318] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                      />
                      <p className="text-[10px] text-gray-600 mt-1">
                        Company profit per order. Total fee = seller rate +
                        profit.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end space-x-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#232529] text-white hover:bg-gray-700 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#124046] text-[#42d4e6] px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50 hover:brightness-110"
                >
                  {submitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ZONE RATE RULES MODAL */}
      {isRatesModalOpen && selectedSeller && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] relative z-10">
            <div className="p-6 border-b border-gray-800 bg-slate-950 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white">
                  Zone Rate Rules: {selectedSeller.merchantName}
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  Charge this seller per order for a range of zones, effective
                  from a date. Orders outside every rule (or received before
                  its effective date) are charged the universal zone price.
                </p>
              </div>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              {/* Add / Edit rule form */}
              <div className="rounded-xl border border-gray-800 bg-slate-950 p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-3">
                  {editingRuleId ? "Edit Rule" : "Add Rule"}
                </h3>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                      Zones from
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="2"
                      value={ruleForm.zoneFrom}
                      onChange={(e) =>
                        setRuleForm({ ...ruleForm, zoneFrom: e.target.value })
                      }
                      className="w-20 bg-slate-900 border border-gray-700 rounded px-2 py-1.5 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                      Zones to
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="9"
                      value={ruleForm.zoneTo}
                      onChange={(e) =>
                        setRuleForm({ ...ruleForm, zoneTo: e.target.value })
                      }
                      className="w-20 bg-slate-900 border border-gray-700 rounded px-2 py-1.5 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                      USD
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="$2.50"
                      value={ruleForm.rateUsd}
                      onChange={(e) =>
                        setRuleForm({ ...ruleForm, rateUsd: e.target.value })
                      }
                      className="w-24 bg-slate-900 border border-gray-700 rounded px-2 py-1.5 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                      LBP
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={ruleForm.rateLbp}
                      onChange={(e) =>
                        setRuleForm({ ...ruleForm, rateLbp: e.target.value })
                      }
                      className="w-28 bg-slate-900 border border-gray-700 rounded px-2 py-1.5 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                      Effective from
                    </label>
                    <input
                      type="date"
                      value={ruleForm.effectiveFrom}
                      onChange={(e) =>
                        setRuleForm({
                          ...ruleForm,
                          effectiveFrom: e.target.value,
                        })
                      }
                      className="bg-slate-900 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2 ml-auto">
                    {editingRuleId && (
                      <button
                        type="button"
                        onClick={cancelEditRule}
                        className="px-4 py-1.5 rounded-lg bg-[#232529] text-white hover:bg-gray-700 text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveRule}
                      disabled={rateRulesSaving}
                      className="bg-[#124046] text-[#42d4e6] px-5 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 hover:brightness-110"
                    >
                      {rateRulesSaving
                        ? "Saving..."
                        : editingRuleId
                          ? "Save Changes"
                          : "Add Rule"}
                    </button>
                  </div>
                </div>
                {rateRuleError && (
                  <p className="text-xs text-red-400 mt-2">{rateRuleError}</p>
                )}
              </div>

              {/* Rules list */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 z-10">
                    <tr className="border-b border-gray-700 text-xs text-gray-400 uppercase tracking-wider">
                      <th className="py-3 px-3 text-left font-medium">
                        Zones
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        USD
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        LBP
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Effective from
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {rateRulesLoading ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-500"
                        >
                          Loading rules...
                        </td>
                      </tr>
                    ) : rateRules.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-gray-500"
                        >
                          No rules yet — this seller is charged the universal
                          zone price for every order.
                        </td>
                      </tr>
                    ) : (
                      rateRules.map((rule: any) => (
                        <tr
                          key={rule.id}
                          className={`hover:bg-slate-800/30 transition-colors ${editingRuleId === rule.id ? "bg-cyan-500/5" : ""}`}
                        >
                          <td className="py-3 px-3 font-semibold text-white">
                            {rule.zoneFrom === rule.zoneTo
                              ? `Zone ${rule.zoneFrom}`
                              : `Zones ${rule.zoneFrom}–${rule.zoneTo}`}
                          </td>
                          <td className="py-3 px-3 text-center text-white font-mono text-xs">
                            ${(Number(rule.rate) || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-center text-white font-mono text-xs">
                            {(Number(rule.rateLbp) || 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-center text-gray-300 text-xs">
                            {rule.effectiveFrom
                              ? new Date(
                                  rule.effectiveFrom,
                                ).toLocaleDateString()
                              : "—"}
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => startEditRule(rule)}
                              className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 px-2 py-1 rounded transition-colors mr-2"
                            >
                              Edit
                            </button>
                            {confirmDeleteRuleId === rule.id ? (
                              <>
                                <button
                                  onClick={() => handleDeleteRule(rule.id)}
                                  className="text-xs text-white bg-red-600 hover:bg-red-500 px-2 py-1 rounded transition-colors mr-1"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() =>
                                    setConfirmDeleteRuleId(null)
                                  }
                                  className="text-xs text-gray-400 hover:text-white bg-slate-800 px-2 py-1 rounded transition-colors"
                                >
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() =>
                                  setConfirmDeleteRuleId(rule.id)
                                }
                                className="text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-2 py-1 rounded transition-colors"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 text-xs text-gray-500">
                When several rules match an order, the one with the latest
                effective date wins. Older orders keep the rate that applied
                when they were received.
              </p>
            </div>

            <div className="p-6 border-t border-gray-800 bg-slate-950 flex justify-end space-x-3 shrink-0">
              <button
                onClick={closeRatesModal}
                className="px-6 py-2.5 rounded text-gray-400 hover:bg-slate-800 font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
