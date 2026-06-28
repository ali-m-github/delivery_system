"use client";

import { useState } from "react";

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  WITH_DRIVER: "With Driver",
  DELIVERED: "Delivered",
  RETURN: "Returned",
  Re: "Returned",
};

const LOCATION_COLORS: Record<string, string> = {
  WAREHOUSE: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  WITH_DRIVER: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  DELIVERED: "text-green-400 bg-green-500/10 border-green-500/30",
  RETURN: "text-red-400 bg-red-500/10 border-red-500/30",
  Re: "text-red-400 bg-red-500/10 border-red-500/30",
};

export function formatDDMMYYYY(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

interface SharedOrderTableProps {
  orders: any[];
  selectedOrderIds: string[];
  onToggleSelectOrder: (id: string) => void;
  onToggleSelectAll: () => void;
  isAllSelected: boolean;
  availableDrivers?: any[];
  onUpdateOrder?: (id: string, payload: any) => void;
  currentUser?: any;
}

export default function SharedOrderTable({
  orders,
  selectedOrderIds,
  onToggleSelectOrder,
  onToggleSelectAll,
  isAllSelected,
  availableDrivers = [],
  onUpdateOrder,
  currentUser,
}: SharedOrderTableProps) {
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );

  const hasPermission = (perm: string) =>
    currentUser?.role === "ADMIN" ||
    currentUser?.permissions?.includes(perm) ||
    false;

  const renderTableRow = (order: any) => {
    const sellerName =
      order.merchant?.merchantName || order.merchant?.ownerFirstName || "—";

    const locationBadge = LOCATION_COLORS[order.location]
      ? `px-1.5 py-0.5 text-[10px] font-semibold rounded-full border ${LOCATION_COLORS[order.location]}`
      : "px-1.5 py-0.5 text-[10px] font-semibold rounded-full border text-gray-400 border-white/10 bg-white/5";

    const finStatusBadge = (() => {
      const fin = order.financialStatus;
      const colors: Record<string, string> = {
        UD: "text-orange-400 bg-orange-500/10 border-orange-500/30",
        WD: "text-blue-400 bg-blue-500/10 border-blue-500/30",
        WO: "text-green-400 bg-green-500/10 border-green-500/30",
        PS: "text-purple-400 bg-purple-500/10 border-purple-500/30",
      };
      return `px-1.5 py-0.5 text-[10px] font-semibold rounded-full border ${colors[fin] || "text-gray-400 border-white/10 bg-white/5"}`;
    })();

    // Apply strict fallback logic: if collected is 0, default to original amount.
    const actualCollectedUsd = order.collectedUsd || order.amountUsd || 0;
    const actualCollectedLbp = order.collectedLbp || order.amountLbp || 0;

    const isMismatched =
      order.location === "DELIVERED" &&
      (Number(order.amountUsd) !== Number(actualCollectedUsd) ||
        Number(order.amountLbp) !== Number(actualCollectedLbp));

    const mainRow = (
      <tr
        key={order.id}
        className={
          isMismatched
            ? "bg-yellow-500/20 border-b border-white/5 transition-colors"
            : "border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
        }
      >
        <td className="px-2 py-1.5">
          <input
            type="checkbox"
            checked={selectedOrderIds.includes(order.id)}
            onChange={() => onToggleSelectOrder(order.id)}
            className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
          />
        </td>

        <td className="px-2 py-1.5 text-xs font-mono text-gray-300 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                setExpandedHistoryId(
                  expandedHistoryId === order.id ? null : order.id,
                )
              }
              title="Order History"
              className={`text-[10px] px-1 py-0.5 rounded border transition-all ${
                expandedHistoryId === order.id
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                  : "bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
              }`}
            >
              &#9776;
            </button>
            <span>#{order.orderId}</span>
          </div>
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-400 whitespace-nowrap">
          {formatDDMMYYYY(order.createdAt)}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap">
          {sellerName}
        </td>

        <td className="px-2 py-1.5 text-xs text-white whitespace-nowrap">
          {order.customerName}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-400 whitespace-nowrap">
          {order.customerPhone}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-400 max-w-[120px] truncate">
          {order.customerAddress}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap">
          {order.zone?.name || order.zoneId || "—"}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap">
          {order.driverId && order.driver ? (
            <span className="text-cyan-300 font-medium">
              {order.driver.firstName} {order.driver.lastName} (
              {order.driver.driverId})
            </span>
          ) : onUpdateOrder ? (
            <div className="relative">
              <input
                type="text"
                list={`driver-list-${order.id}`}
                defaultValue=""
                placeholder="Assign driver..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = e.currentTarget.value;
                    const matchedDriver = availableDrivers.find(
                      (d: any) =>
                        `${d.firstName} ${d.lastName} (${d.driverId})` === val,
                    );
                    if (matchedDriver) {
                      onUpdateOrder(order.id, {
                        driverId: matchedDriver.id,
                        location: "ASSIGNED",
                      });
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
                className="w-28 text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-sky-500/50 transition-all duration-150"
              />
              <datalist id={`driver-list-${order.id}`}>
                {availableDrivers.map((driver: any) => (
                  <option
                    key={driver.id}
                    value={`${driver.firstName} ${driver.lastName} (${driver.driverId})`}
                  />
                ))}
              </datalist>
            </div>
          ) : (
            <span className="text-gray-500 italic">Unassigned</span>
          )}
        </td>

        <td className="px-2 py-1.5 whitespace-nowrap">
          <span className={locationBadge}>
            {LOCATION_LABELS[order.location] || order.location}
          </span>
        </td>

        <td className="px-2 py-1.5 whitespace-nowrap">
          <span className={finStatusBadge}>{order.financialStatus}</span>
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
          ${(order.amountUsd || 0).toFixed(2)}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
          {(order.amountLbp || 0).toLocaleString()}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
          ${actualCollectedUsd.toFixed(2)}
        </td>

        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
          {actualCollectedLbp.toLocaleString()}
        </td>

        <td className="px-2 py-1.5 whitespace-nowrap text-center">
          <a
            href={`https://wa.me/${order.customerPhone?.replace(/[^0-9]/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            title="WhatsApp"
            className="inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all duration-150"
          >
            WA
          </a>
        </td>
      </tr>
    );

    const historyRow = expandedHistoryId === order.id && (
      <tr key={`${order.id}-history`} className="border-b border-white/5">
        <td colSpan={16} className="px-4 py-3 bg-white/[0.02]">
          <div className="text-xs font-semibold text-cyan-400 mb-2 uppercase tracking-wider">
            ORDER HISTORY
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1 pr-3 font-medium whitespace-nowrap">
                  Stamp
                </th>
                <th className="text-left py-1 pr-3 font-medium whitespace-nowrap">
                  Location
                </th>
                <th className="text-left py-1 pr-3 font-medium whitespace-nowrap">
                  Driver
                </th>
                <th className="text-left py-1 pr-3 font-medium whitespace-nowrap">
                  Note
                </th>
                <th className="text-left py-1 font-medium whitespace-nowrap">
                  Entered By
                </th>
              </tr>
            </thead>
            <tbody>
              {order.history && order.history.length > 0 ? (
                order.history.map((h: any) => (
                  <tr
                    key={h.id}
                    className="border-b border-white/5 text-gray-400"
                  >
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {new Date(h.createdAt).toLocaleString("en-US", {
                        timeZone: "Asia/Beirut",
                      })}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {h.location || "—"}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {h.driverId || "—"}
                    </td>
                    <td className="py-1 pr-3">{h.action}</td>
                    <td className="py-1 whitespace-nowrap">
                      {h.user?.username || "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-2 text-gray-500 text-center">
                    No history records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </td>
      </tr>
    );

    return [mainRow, historyRow].filter(Boolean);
  };

  if (orders.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-sm">No orders match this filter.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#121824]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
            <th className="px-2 py-2 text-left font-medium w-8">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
                className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
              />
            </th>
            <th className="px-2 py-2 text-left font-medium">Order ID</th>
            <th className="px-2 py-2 text-left font-medium">Date</th>
            <th className="px-2 py-2 text-left font-medium">Seller</th>
            <th className="px-2 py-2 text-left font-medium">Customer</th>
            <th className="px-2 py-2 text-left font-medium">Tel Number</th>
            <th className="px-2 py-2 text-left font-medium">Address</th>
            <th className="px-2 py-2 text-left font-medium">Zone</th>
            <th className="px-2 py-2 text-left font-medium">Driver</th>
            <th className="px-2 py-2 text-left font-medium">Location</th>
            <th className="px-2 py-2 text-left font-medium">Fin Status</th>
            <th className="px-2 py-2 text-right font-medium">Amt $</th>
            <th className="px-2 py-2 text-right font-medium">Amt LL</th>
            <th className="px-2 py-2 text-right font-medium">$ Coll</th>
            <th className="px-2 py-2 text-right font-medium">LL Coll</th>
            <th className="px-2 py-2 text-center font-medium">WA</th>
          </tr>
        </thead>
        <tbody>{orders.flatMap(renderTableRow)}</tbody>
      </table>
    </div>
  );
}
