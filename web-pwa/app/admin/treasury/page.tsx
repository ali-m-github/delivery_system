"use client";

import { useState, useEffect } from "react";
import { createTreasuryBox } from "@/app/actions/treasury";

interface TreasuryBox {
  id: string;
  name: string;
  isPositive: boolean;
  balanceUsd: number;
  balanceLbp: number;
  transactions: TreasuryTransaction[];
  createdAt: string;
  updatedAt: string;
}

interface TreasuryTransaction {
  id: string;
  boxId: string;
  type: string;
  amountUsd: number;
  amountLbp: number;
  description: string | null;
  referenceId: string | null;
  createdAt: string;
}

export default function TreasuryAdminPage() {
  const [boxes, setBoxes] = useState<TreasuryBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // ── Create Form State ──
  const [newName, setNewName] = useState("");
  const [newIsPositive, setNewIsPositive] = useState(true);

  // ── Expanded Box ──
  const [expandedBoxId, setExpandedBoxId] = useState<string | null>(null);

  const fetchBoxes = async () => {
    try {
      const res = await fetch("/api/admin/treasury");
      const data = await res.json();
      if (Array.isArray(data)) {
        setBoxes(data);
      }
    } catch (error) {
      console.error("Failed to fetch treasury boxes", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoxes();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const formData = new FormData();
      formData.set("name", newName.trim());
      if (newIsPositive) formData.set("isPositive", "on");
      await createTreasuryBox(formData);
      setNewName("");
      setNewIsPositive(true);
      await fetchBoxes(); // Refresh list after creation
    } catch (error) {
      console.error(error);
      alert("Failed to create treasury box");
    } finally {
      setCreating(false);
    }
  };

  // Calculate totals
  const totalAssetUsd = boxes
    .filter((b) => b.isPositive)
    .reduce((sum, b) => sum + b.balanceUsd, 0);
  const totalLiabilityUsd = boxes
    .filter((b) => !b.isPositive)
    .reduce((sum, b) => sum + b.balanceUsd, 0);
  const netWorth = totalAssetUsd - totalLiabilityUsd;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 p-8 text-cyan-400 font-mono">
        Loading Treasury...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-gray-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400">
              Treasury Management
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Manage cash boxes, track balances, and reconcile transactions.
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-1">Total Assets</p>
            <p className="text-2xl font-bold text-green-400 font-mono">
              ${totalAssetUsd.toFixed(2)}
            </p>
          </div>
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-1">Total Liabilities</p>
            <p className="text-2xl font-bold text-red-400 font-mono">
              ${totalLiabilityUsd.toFixed(2)}
            </p>
          </div>
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-1">Net Treasury</p>
            <p
              className={`text-2xl font-bold font-mono ${
                netWorth >= 0 ? "text-cyan-400" : "text-red-400"
              }`}
            >
              ${netWorth.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Create New Box */}
        <div className="bg-slate-900 border border-gray-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-bold text-white mb-4">
            Create New Treasury Box
          </h2>
          <div className="flex flex-col md:flex-row gap-4">
            <input
              type="text"
              placeholder="Box Name (e.g. Main Cash Register)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 bg-slate-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsPositive}
                  onChange={(e) => setNewIsPositive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                />
                <span className="text-sm text-gray-300">
                  {newIsPositive ? "Asset (Income)" : "Liability (Expense)"}
                </span>
              </label>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/40 border border-cyan-500/30 px-6 py-2.5 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Creating..." : "Create Box"}
            </button>
          </div>
        </div>

        {/* Treasury Boxes List */}
        {boxes.length === 0 ? (
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 font-mono">
            No treasury boxes found. Create one above.
          </div>
        ) : (
          <div className="space-y-4">
            {boxes.map((box) => (
              <div
                key={box.id}
                className="bg-slate-900 border border-gray-800 rounded-xl overflow-hidden"
              >
                {/* Box Header */}
                <div
                  className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
                  onClick={() =>
                    setExpandedBoxId(expandedBoxId === box.id ? null : box.id)
                  }
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-3 h-3 rounded-full ${
                        box.isPositive ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {box.name}
                      </h3>
                      <span
                        className={`text-xs font-mono ${
                          box.isPositive ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {box.isPositive
                          ? "Asset / Income"
                          : "Liability / Expense"}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-6 text-right">
                    <div>
                      <p className="text-xs text-gray-500">USD Balance</p>
                      <p className="text-lg font-bold text-green-400 font-mono">
                        ${box.balanceUsd.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">LBP Balance</p>
                      <p className="text-lg font-bold text-yellow-400 font-mono">
                        LL {box.balanceLbp.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Expanded: Recent Transactions */}
                {expandedBoxId === box.id && (
                  <div className="border-t border-gray-800 p-5 bg-slate-950/50">
                    <h4 className="text-sm font-bold text-gray-400 mb-3">
                      Recent Transactions
                    </h4>
                    {box.transactions.length === 0 ? (
                      <p className="text-sm text-gray-600 font-mono">
                        No transactions yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {box.transactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="flex justify-between items-center bg-slate-900 rounded-lg p-3 border border-gray-800"
                          >
                            <div>
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded ${
                                  tx.type === "IN"
                                    ? "bg-green-900/40 text-green-400"
                                    : "bg-red-900/40 text-red-400"
                                }`}
                              >
                                {tx.type}
                              </span>
                              <span className="text-sm text-gray-400 ml-2">
                                {tx.description || "—"}
                              </span>
                              {tx.referenceId && (
                                <span className="text-xs text-gray-600 ml-2 font-mono">
                                  ref: {tx.referenceId.slice(0, 8)}...
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-mono text-white">
                                ${tx.amountUsd.toFixed(2)}
                              </p>
                              <p className="text-xs text-gray-500">
                                {new Date(tx.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
