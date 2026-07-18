"use client";

import { useState, useEffect, FormEvent } from "react";

interface ImportGoogleSheetsModalProps {
  merchantId: string;
  savedConfig?: {
    startRow?: number;
    colMapping?: Record<string, number>;
  } | null;
  onSuccess: () => void;
  onClose: () => void;
}

interface ColumnMapping {
  orderId: number;
  customerName: number;
  phone: number;
  address: number;
  amountUsd: number;
  packages: number;
}

interface ImportResult {
  totalRowsParsed: number;
  successfullyInserted: number;
  skippedDuplicates: number;
}

const DEFAULT_COL_MAPPING: ColumnMapping = {
  orderId: 0,
  customerName: 1,
  phone: 2,
  address: 3,
  amountUsd: 4,
  packages: 5,
};

const DEFAULT_START_ROW = 1;

function mergeSavedConfig(
  savedConfig: ImportGoogleSheetsModalProps["savedConfig"],
): { startRow: number; colMapping: ColumnMapping } {
  if (!savedConfig) {
    return {
      startRow: DEFAULT_START_ROW,
      colMapping: { ...DEFAULT_COL_MAPPING },
    };
  }

  const mergedMapping: ColumnMapping = { ...DEFAULT_COL_MAPPING };
  if (savedConfig.colMapping) {
    for (const key of Object.keys(
      DEFAULT_COL_MAPPING,
    ) as (keyof ColumnMapping)[]) {
      const val = savedConfig.colMapping[key];
      if (typeof val === "number" && !isNaN(val)) {
        mergedMapping[key] = val;
      }
    }
  }

  const startRow =
    typeof savedConfig.startRow === "number" && !isNaN(savedConfig.startRow)
      ? savedConfig.startRow
      : DEFAULT_START_ROW;

  return { startRow, colMapping: mergedMapping };
}

export default function ImportGoogleSheetsModal({
  merchantId,
  savedConfig,
  onSuccess,
  onClose,
}: ImportGoogleSheetsModalProps) {
  const initial = mergeSavedConfig(savedConfig);
  const [url, setUrl] = useState("");
  const [startRow, setStartRow] = useState(initial.startRow);
  const [receivedDate, setReceivedDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [colMapping, setColMapping] = useState<ColumnMapping>(
    initial.colMapping,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saveTemplate, setSaveTemplate] = useState(!savedConfig);

  // ── Sync local state when savedConfig prop changes ──
  useEffect(() => {
    if (savedConfig && Object.keys(savedConfig).length > 0) {
      if (savedConfig.startRow !== undefined) setStartRow(savedConfig.startRow);
      if (savedConfig.colMapping) {
        // Merge saved mapping into defaults to ensure all keys exist
        const merged = { ...DEFAULT_COL_MAPPING };
        for (const key of Object.keys(
          DEFAULT_COL_MAPPING,
        ) as (keyof ColumnMapping)[]) {
          const val = savedConfig.colMapping[key];
          if (typeof val === "number" && !isNaN(val)) {
            merged[key] = val;
          }
        }
        setColMapping(merged);
      }
    }
  }, [savedConfig]);

  const handleResetDefaults = () => {
    setStartRow(DEFAULT_START_ROW);
    setColMapping({ ...DEFAULT_COL_MAPPING });
    setSaveTemplate(true);
    setError(null);
    setResult(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/orders/import-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          merchantId: Number(merchantId),
          startRow: Number(startRow),
          colMapping,
          receivedDate: receivedDate || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`);
      }

      const data: ImportResult = await res.json();
      setResult(data);

      // Optionally save the template to the merchant profile
      if (saveTemplate) {
        try {
          const saveRes = await fetch(`/api/admin/merchants/${merchantId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sheetImportConfig: {
                startRow: Number(startRow),
                colMapping,
              },
            }),
          });
          if (!saveRes.ok) {
            console.warn(
              "Failed to save sheet config template, but import succeeded.",
            );
          }
        } catch (err) {
          console.error("Failed to save sheet config template:", err);
        }
      }

      // Only close and refresh after the save completes:
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to import orders");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMappingChange = (key: keyof ColumnMapping, value: string) => {
    setColMapping((prev) => ({
      ...prev,
      [key]: parseInt(value, 10) ?? 0,
    }));
  };

  const hasSavedConfig = !!savedConfig;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#121824] border border-white/10 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">
            Import Orders from Google Sheets
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Saved Template Badge */}
        {hasSavedConfig && (
          <div className="mx-5 mt-5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <span className="text-cyan-400 text-sm font-semibold">
              Loaded Saved Template for this Seller
            </span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Google Sheets URL */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Google Sheets URL
            </label>
            <input
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full bg-[#0B0F17] border border-gray-700 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
            />
            <p className="text-[10px] text-gray-600 mt-1">
              Use the link-shared URL from your Google Spreadsheet.
            </p>
          </div>

          {/* Start Row */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Start Row (0-indexed)
            </label>
            <input
              type="number"
              min={0}
              value={startRow}
              onChange={(e) => setStartRow(parseInt(e.target.value, 10) ?? 1)}
              className="w-full bg-[#0B0F17] border border-gray-700 rounded-lg p-2.5 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
            />
            <p className="text-[10px] text-gray-600 mt-1">
              Row index where order data begins (0 = first row).
            </p>
          </div>

          {/* Date Received (Optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Date Received (Optional)
            </label>
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="w-full bg-[#0B0F17] border border-gray-700 rounded-lg p-2.5 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
            />
            <p className="text-[10px] text-gray-600 mt-1">
              Leave as today's date or pick a custom date for when orders were
              received.
            </p>
          </div>

          {/* Column Mapping */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Column Mapping (0-indexed)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(
                [
                  { key: "orderId", label: "Tracking Number" },
                  { key: "customerName", label: "Customer Name" },
                  { key: "phone", label: "Phone Number" },
                  { key: "address", label: "Delivery Address" },
                  { key: "amountUsd", label: "Order Amount ($)" },
                  { key: "packages", label: "Package Count" },
                ] as const
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">
                    {label}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={colMapping[key]}
                    onChange={(e) => handleMappingChange(key, e.target.value)}
                    className="w-full bg-[#0B0F17] border border-gray-700 rounded-lg p-2 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Success Metrics */}
          {result && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-2">
              <p className="text-green-400 font-semibold text-sm">
                Import Complete
              </p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Parsed
                  </p>
                  <p className="text-white font-mono font-bold text-lg">
                    {result.totalRowsParsed}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Inserted
                  </p>
                  <p className="text-green-400 font-mono font-bold text-lg">
                    {result.successfullyInserted}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Skipped
                  </p>
                  <p className="text-yellow-400 font-mono font-bold text-lg">
                    {result.skippedDuplicates}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Save Template Checkbox + Reset Row */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={saveTemplate}
                onChange={(e) => setSaveTemplate(e.target.checked)}
                className="rounded border-gray-600 bg-[#0B0F17] text-cyan-500 focus:ring-cyan-500/50 cursor-pointer w-4 h-4"
              />
              <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
                Save / Overwrite these mapping parameters as default template
                for this seller
              </span>
            </label>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-xs text-gray-500 hover:text-orange-400 transition-colors px-2 py-1 hover:bg-orange-500/10 rounded"
            >
              Reset to System Defaults
            </button>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] font-bold px-5 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isLoading ? "Importing..." : "Import Orders"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
