"use client";

import { useMemo } from "react";

interface ConfirmPayoutModalProps {
  orders: any[];
  driverSellerRates?: any[];
  driverZoneRates?: any[];
  totalUsd: number;
  totalLbp: number;
  carriedDebtUsd?: number;
  carriedDebtLbp?: number;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}

export default function ConfirmPayoutModal({
  orders,
  driverSellerRates = [],
  driverZoneRates = [],
  totalUsd,
  totalLbp,
  carriedDebtUsd = 0,
  carriedDebtLbp: _carriedDebtLbp = 0,
  onConfirm,
  onCancel,
  submitting,
}: ConfirmPayoutModalProps) {
  // Compute commission per order and group by rate for breakdown display
  const commissionBreakdown = useMemo(() => {
    const groups: Record<string, { count: number; label: string }> = {};

    for (const order of orders) {
      const orderMerchantId = String(order.merchantId);
      const orderZoneId = String(order.zoneId);

      const exception = (driverSellerRates || []).find(
        (rate) => String(rate.merchantId) === orderMerchantId,
      );

      if (exception) {
        const rate = Number(exception.rateUsd || 0);
        const rateKey = rate.toFixed(2);
        const merchantName = order.merchant?.merchantName || orderMerchantId;
        const label = `Cash Seller: ${merchantName}`;
        if (!groups[rateKey]) {
          groups[rateKey] = { count: 0, label };
        }
        groups[rateKey].count++;
        continue;
      }

      const zoneRate = (driverZoneRates || []).find(
        (rate) => String(rate.zoneId) === orderZoneId,
      );
      const rate = Number(zoneRate?.rate || 0);
      const rateKey = rate.toFixed(2);
      const zoneName = zoneRate?.zoneName || orderZoneId;
      const label = `Zone: ${zoneName}`;
      if (!groups[rateKey]) {
        groups[rateKey] = { count: 0, label };
      }
      groups[rateKey].count++;
    }

    return groups;
  }, [orders, driverSellerRates, driverZoneRates]);

  // Calculate total commission from breakdown
  const derivedCommission = useMemo(() => {
    let sum = 0;
    for (const key of Object.keys(commissionBreakdown)) {
      sum += Number(key) * commissionBreakdown[key].count;
    }
    return sum;
  }, [commissionBreakdown]);

  // Calculate absolute net
  const derivedNetPayout = totalUsd - derivedCommission;

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
          <hr className="border-white/10" />
          <div className="py-2 border-b border-slate-700/50">
            <div className="flex justify-between text-sm">
              <p className="text-slate-400">Total Commission</p>
              <p className="text-red-400 font-bold">
                -${derivedCommission.toFixed(2)}
              </p>
            </div>
            {/* Commission breakdown by rate */}
            <div className="mt-2 space-y-1">
              {Object.entries(commissionBreakdown)
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([rate, { count, label }]) => (
                  <div
                    key={rate}
                    className="flex justify-between text-xs text-slate-500"
                  >
                    <span>{label}</span>
                    <span>
                      {count} × ${Number(rate).toFixed(2)}
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
            disabled={submitting}
            className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-cyan-500/20"
          >
            {submitting ? "Submitting…" : "Confirm & Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
