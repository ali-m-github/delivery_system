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
  onCopyLink?: (orderId: string) => void;
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
  onCopyLink,
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
        RWD: "text-orange-400 bg-orange-500/10 border-orange-500/30",
        Re: "text-red-400 bg-red-500/10 border-red-500/30",
        RTS: "text-purple-400 bg-purple-500/10 border-purple-500/30",
      };
      return `px-1.5 py-0.5 text-[10px] font-semibold rounded-full border ${colors[fin] || "text-gray-400 border-white/10 bg-white/5"}`;
    })();

    // Apply strict fallback logic: if collected is 0, default to original amount.
    const actualCollectedUsd = order.collectedUsd ?? order.amountUsd ?? 0;
    const actualCollectedLbp = order.collectedLbp ?? order.amountLbp ?? 0;

    const isMismatched =
      order.location === "DELIVERED" &&
      (Number(order.amountUsd) !== Number(actualCollectedUsd) ||
        Number(order.amountLbp) !== Number(actualCollectedLbp));

    const rowClasses = isMismatched
      ? "bg-yellow-500/20 transition-colors"
      : "hover:bg-cyan-500/[0.03] transition-colors";

    const mainRow = (
      <tr
        key={order.id}
        className={`block lg:table-row border-b border-gray-800 lg:border-none mb-4 lg:mb-0 p-2 lg:p-0 ${rowClasses}`}
      >
        <td className="flex lg:table-cell items-center px-0.5 py-2 whitespace-nowrap">
          <input
            type="checkbox"
            checked={selectedOrderIds.includes(order.id)}
            onChange={() => onToggleSelectOrder(order.id)}
            className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
          />
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">ID:</span>
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
            <span className="font-mono text-gray-300">#{order.orderId}</span>
          </div>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Date:</span>
          <span className="text-gray-400">
            {formatDDMMYYYY(order.createdAt)}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Seller:</span>
          <span className="text-gray-300">{sellerName}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Customer:</span>
          <span className="text-white">{order.customerName}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Tel:</span>
          <span className="text-gray-400">{order.customerPhone}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Address:</span>
          <span className="text-gray-400 truncate">
            {order.customerAddress}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Zone:</span>
          <span className="text-gray-300">
            {order.zone?.name || order.zoneId || "—"}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Driver:</span>
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
                        financialStatus: "UD",
                        collectedUsd: 0,
                        collectedLbp: 0,
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

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Location:</span>
          <span className={locationBadge}>
            {LOCATION_LABELS[order.location] || order.location}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Fin:</span>
          <span className={finStatusBadge}>{order.financialStatus}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Amt $:</span>
          <span className="text-gray-300 text-right">
            ${(order.amountUsd ?? 0).toFixed(2)}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Amt LL:</span>
          <span className="text-gray-300 text-right">
            {(order.amountLbp ?? 0).toLocaleString()}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">$ Coll:</span>
          <span className="text-gray-300 text-right">
            ${actualCollectedUsd.toFixed(2)}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 truncate whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">LL Coll:</span>
          <span className="text-gray-300 text-right">
            {actualCollectedLbp.toLocaleString()}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">WA:</span>
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

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Waybill:</span>
          {order.waybillUrl ? (
            <a
              href={order.waybillUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View Waybill"
              className="inline-block text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </a>
          ) : (
            <span
              className="inline-block opacity-50"
              title="No waybill uploaded"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </span>
          )}
        </td>

        {onCopyLink && (
          <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
            <span className="lg:hidden font-bold text-gray-400">Link:</span>
            <button
              onClick={() =>
                navigator.clipboard.writeText(
                  window.location.origin + "/track/" + order.orderId,
                )
              }
              className="p-1 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
              title="Copy Link"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                />
              </svg>
            </button>
          </td>
        )}
      </tr>
    );

    const historyRow = expandedHistoryId === order.id && (
      <tr key={`${order.id}-history`} className="border-b border-white/5">
        <td
          colSpan={onCopyLink ? 18 : 17}
          className="px-4 py-3 bg-white/[0.02]"
        >
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
    <div className="w-full max-w-full rounded-xl border border-white/10 bg-[#121824] overflow-x-auto">
      <table className="w-full table-fixed text-[10px] md:text-xs min-w-[1000px] lg:min-w-full">
        <thead className="hidden lg:table-header-group text-[10px] leading-tight">
          <tr className="border-b border-gray-700 text-left">
            <th className="w-[3%] px-0.5 py-2">SEL</th>
            <th className="w-[5%] px-0.5 py-2">ID</th>
            <th className="w-[6%] px-0.5 py-2">DATE</th>
            <th className="w-[8%] px-0.5 py-2">SELLER</th>
            <th className="w-[9%] px-0.5 py-2">CUSTOMER</th>
            <th className="w-[7%] px-0.5 py-2">TEL NUMBER</th>
            <th className="w-[12%] px-0.5 py-2">ADDRESS</th>
            <th className="w-[4%] px-0.5 py-2">ZONE</th>
            <th className="w-[8%] px-0.5 py-2">DRIVER</th>
            <th className="w-[6%] px-0.5 py-2">LOCATION</th>
            <th className="w-[4%] px-0.5 py-2">FIN</th>
            <th className="w-[5%] px-0.5 py-2">AMT $</th>
            <th className="w-[5%] px-0.5 py-2">AMT LL</th>
            <th className="w-[5%] px-0.5 py-2">$ COLL</th>
            <th className="w-[5%] px-0.5 py-2">LL COLL</th>
            <th className="w-[3%] px-0.5 py-2">WA</th>
            <th className="w-[2%] px-0.5 py-2">DOC</th>
            {onCopyLink && <th className="w-[3%] px-0.5 py-2">LINK</th>}
          </tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {orders.flatMap(renderTableRow)}
        </tbody>
      </table>
    </div>
  );
}
