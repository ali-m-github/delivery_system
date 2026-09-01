"use client";

export interface CommissionLine {
  label: string;
  rateUsd: number;
  count: number;
}

interface ConfirmPayoutModalProps {
  orders: any[];
  totalUsd: number;
  totalLbp: number;
  carriedDebtUsd?: number;
  carriedDebtLbp?: number;
  /**
   * Per-rate commission lines, computed by the caller through the
   * authoritative commission module (seller exception, cash wins → zone
   * rate; an explicitly configured $0 is a valid line).
   */
  commissionLines: CommissionLine[];
  /** Sum of the configured rates across the selected orders. */
  totalCommissionUsd: number;
  /**
   * Number of selected orders with NO configured rate (neither seller
   * exception nor zone rate). While > 0 the payout cannot be created — the
   * backend rejects it with an actionable missing-rate error.
   */
  missingRateOrderCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}

export default function ConfirmPayoutModal({
  orders,
  totalUsd,
  totalLbp,
  carriedDebtUsd = 0,
  carriedDebtLbp: _carriedDebtLbp = 0,
  commissionLines,
  totalCommissionUsd,
  missingRateOrderCount,
  onConfirm,
  onCancel,
  submitting,
}: ConfirmPayoutModalProps) {
  // Net from the caller-provided (authoritative) commission total.
  const derivedNetPayout = totalUsd - totalCommissionUsd;

  const blocked = missingRateOrderCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
        <h2 className="text-xl font-bold text-white mb-1">
          Confirm Payout Batch
        </h2>
        <p className="text-gray-400 text-sm mb-6">
          You are about to create a payout for{" "}
          <span className="text-cyan-400 font-semibold">{orders.length}</span>{" "}
          delivered {orders.length === 1 ? "order" : "orders"}.
        </p>

        {/* Receipt-style breakdown */}
        <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-5 mb-6 space-y-3 font-mono">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total USD</span>
            <span className="text-green-400 font-bold">
              ${totalUsd.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total LBP</span>
            <span className="text-yellow-400 font-bold">
              {totalLbp.toLocaleString()} LL
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Order Count</span>
            <span className="text-white font-bold">{orders.length}</span>
          </div>

          {blocked && (
            <div className="border border-red-500/40 bg-red-500/10 rounded-md px-3 py-2 text-xs text-red-300">
              <span className="font-bold">Rate not configured</span> for{" "}
              {missingRateOrderCount} selected{" "}
              {missingRateOrderCount === 1 ? "order" : "orders"}. The payout
              cannot be created until every order has a seller or zone
              commission rate — a $0 rate is a valid explicit override.
            </div>
          )}

          <hr className="border-white/10" />
          <div className="py-2 border-b border-slate-700/50">
            <div className="flex justify-between text-sm">
              <p className="text-slate-400">Total Commission</p>
              <p className="text-red-400 font-bold">
                -${totalCommissionUsd.toFixed(2)}
              </p>
            </div>
            {/* Commission breakdown by rate (authoritative module output) */}
            <div className="mt-2 space-y-1">
              {commissionLines
                .slice()
                .sort((a, b) => b.rateUsd - a.rateUsd)
                .map((line, i) => (
                  <div
                    key={`${line.label}-${i}`}
                    className="flex justify-between text-xs text-slate-500"
                  >
                    <span>{line.label}</span>
                    <span>
                      {line.count} × ${line.rateUsd.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {carriedDebtUsd > 0.01 && (
            <>
              <hr className="border-white/10" />
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  Prev. Debt Carried Forward
                </span>
                <span className="text-red-400 font-bold">
                  +${carriedDebtUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between py-2 font-bold mt-2">
                <p className="text-white">Net Payout (incl. debt)</p>
                <p className="text-cyan-400">
                  ${(derivedNetPayout + carriedDebtUsd).toFixed(2)}
                </p>
              </div>
            </>
          )}
          {carriedDebtUsd <= 0.01 && (
            <div className="flex justify-between py-2 font-bold mt-2">
              <p className="text-white">Net Payout</p>
              <p className="text-cyan-400">${derivedNetPayout.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting || blocked}
            className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-cyan-500/20"
          >
            {blocked
              ? "Configure missing rate"
              : submitting
                ? "Submitting…"
                : "Confirm & Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
