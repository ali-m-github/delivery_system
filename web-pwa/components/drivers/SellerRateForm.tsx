"use client";

import { useState } from "react";
import { addSellerException } from "@/app/actions/driverRates";

interface Merchant {
  id: string;
  merchantName: string;
}

interface SellerRateFormProps {
  driverId: string;
  merchants: Merchant[];
}

export default function SellerRateForm({
  driverId,
  merchants,
}: SellerRateFormProps) {
  const [merchantId, setMerchantId] = useState("");
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantId) return alert("Please select a seller.");
    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum < 0) {
      return alert("Please enter a valid rate.");
    }

    setSaving(true);
    try {
      await addSellerException(driverId, merchantId, rateNum);
      setMerchantId("");
      setRate("");
    } catch (err: any) {
      alert(err.message || "Failed to save rate exception");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 p-4 bg-white/[0.02] border border-white/5 rounded-lg mb-4"
    >
      <div className="flex-1 min-w-[200px]">
        <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
          Seller
        </label>
        <select
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 outline-none focus:border-cyan-500 text-sm"
        >
          <option value="" className="bg-slate-800 text-white">
            Select a seller…
          </option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id} className="bg-slate-800 text-white">
              {m.merchantName}
            </option>
          ))}
        </select>
      </div>

      <div className="w-40">
        <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
          Flat Rate USD
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="e.g. 4.00"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-2 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-cyan-500/20"
      >
        {saving ? "Saving…" : "Add Exception"}
      </button>
    </form>
  );
}
