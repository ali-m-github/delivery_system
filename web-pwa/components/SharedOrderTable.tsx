"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import OrderHistoryModal from "@/components/OrderHistoryModal";

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

// ─── Column sorting helpers (shared by SharedOrderTable and orders page) ──────
export function getOrderSortValue(order: any, key: string): string | number {
  switch (key) {
    case "orderId":
      return String(order.orderId || "");
    case "dateReceived":
      return order.createdAt ? new Date(order.createdAt).getTime() : 0;
    case "seller":
      return (
        order.merchant?.merchantName || order.merchant?.ownerFirstName || ""
      );
    case "customer":
      return order.customerName || "";
    case "phone":
      return order.customerPhone || "";
    case "address":
      return order.customerAddress || "";
    case "zone":
      return order.zone?.name || order.zoneId || "";
    case "driver":
      return order.driver
        ? `${order.driver.firstName} ${order.driver.lastName}`
        : "";
    case "location":
      return order.location || "";
    case "fin":
      return order.financialStatus || "";
    case "amountUsd":
      return order.amountUsd ?? 0;
    case "amountLbp":
      return order.amountLbp ?? 0;
    case "collectedUsd":
      return order.collectedUsd ?? 0;
    case "collectedLbp":
      return order.collectedLbp ?? 0;
    default:
      return "";
  }
}

export function compareSortValues(
  a: string | number,
  b: string | number,
): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// Clickable table header that toggles ascending / descending sort.
export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "text-left",
  className = "",
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  dir: "asc" | "desc";
  onSort: (key: string) => void;
  align?: "text-left" | "text-right" | "text-center";
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={`px-2 py-2 whitespace-nowrap ${align} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
          active ? "text-cyan-300" : "hover:text-cyan-300"
        }`}
      >
        {label}
        <span className="text-[9px] leading-none">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
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
  const [historyModalOrder, setHistoryModalOrder] = useState<{
    id: string;
    history: any[];
    payoutReference: string | null;
  } | null>(null);

  const hasPermission = (perm: string) =>
    currentUser?.role === "ADMIN" ||
    currentUser?.permissions?.includes(perm) ||
    false;

  // Select-all header checkbox. Reflects "all selected" and shows an
  // indeterminate state when only some rows are checked.
  const selectAllRef = useRef<HTMLInputElement>(null);
  const isIndeterminate = selectedOrderIds.length > 0 && !isAllSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate, isAllSelected, selectedOrderIds]);

  // ── Column sorting (click header to toggle asc/desc) ──
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "",
    dir: "asc",
  });

  const handleSort = (key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const sortedOrders = useMemo(() => {
    if (!sort.key) return orders;
    const dir = sort.dir;
    return [...orders].sort((a, b) => {
      const va = getOrderSortValue(a, sort.key);
      const vb = getOrderSortValue(b, sort.key);
      const cmp = compareSortValues(va, vb);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [orders, sort.key, sort.dir]);

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

    // Apply fallback logic: for delivered orders, if collected is 0 (not
    // explicitly recorded), default to the original order amount. The driver
    // may still override with a different collected price when it is non-zero.
    const isDelivered = order.location === "DELIVERED";
    const rawCollectedUsd = Number(order.collectedUsd ?? 0);
    const rawCollectedLbp = Number(order.collectedLbp ?? 0);
    const actualCollectedUsd =
      isDelivered && rawCollectedUsd === 0
        ? Number(order.amountUsd ?? 0)
        : rawCollectedUsd;
    const actualCollectedLbp =
      isDelivered && rawCollectedLbp === 0
        ? Number(order.amountLbp ?? 0)
        : rawCollectedLbp;

    const isMismatched =
      isDelivered &&
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

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">ID:</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                setHistoryModalOrder({
                  id: order.id,
                  history: order.history || [],
                  payoutReference: order.driverPayout?.payoutReference ?? null,
                })
              }
              title="Order History"
              className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
            >
              &#9776;
            </button>
            <span className="font-mono text-gray-300">#{order.orderId}</span>
          </div>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">
            Date Received:
          </span>
          <span className="text-gray-400">
            {formatDDMMYYYY(order.createdAt)}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Seller:</span>
          <span className="text-gray-300">{sellerName}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Customer:</span>
          <span className="text-white">{order.customerName}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Tel:</span>
          <span className="text-gray-400">{order.customerPhone}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Address:</span>
          <span className="text-gray-400 max-w-[200px] truncate">
            {order.customerAddress}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Zone:</span>
          <span className="text-gray-300">
            {order.zone?.name || order.zoneId || "—"}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
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

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Location:</span>
          <span className={locationBadge}>
            {LOCATION_LABELS[order.location] || order.location}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Fin:</span>
          <span className={finStatusBadge}>{order.financialStatus}</span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Amt $:</span>
          <span className="text-gray-300 text-right">
            ${(order.amountUsd ?? 0).toFixed(2)}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">Amt LL:</span>
          <span className="text-gray-300 text-right">
            {(order.amountLbp ?? 0).toLocaleString()}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
          <span className="lg:hidden font-bold text-gray-400">$ Coll:</span>
          <span className="text-gray-300 text-right">
            ${actualCollectedUsd.toFixed(2)}
          </span>
        </td>

        <td className="flex lg:table-cell justify-between items-center px-0.5 py-2 whitespace-nowrap">
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
              onClick={() => onCopyLink(order.orderId)}
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

    return mainRow;
  };

  if (sortedOrders.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-sm">No orders match this filter.</p>
      </div>
    );
  }

  return (
    <>
      <div className="w-full max-w-full rounded-xl border border-white/10 bg-[#121824] overflow-x-auto">
        <table className="w-full table-auto text-[10px] md:text-xs min-w-[1200px]">
          <thead className="hidden lg:table-header-group text-[10px] leading-tight">
            <tr className="border-b border-gray-700 text-left">
              <th className="px-0.5 py-2 whitespace-nowrap">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={onToggleSelectAll}
                  title="Select all"
                  className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                />
              </th>
              <SortableTh
                label="ID"
                sortKey="orderId"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="DATE RECEIVED"
                sortKey="dateReceived"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="SELLER"
                sortKey="seller"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="CUSTOMER"
                sortKey="customer"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="TEL NUMBER"
                sortKey="phone"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="ADDRESS"
                sortKey="address"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="ZONE"
                sortKey="zone"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="DRIVER"
                sortKey="driver"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="LOCATION"
                sortKey="location"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="FIN"
                sortKey="fin"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                className="px-0.5"
              />
              <SortableTh
                label="AMT $"
                sortKey="amountUsd"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                align="text-right"
                className="px-0.5"
              />
              <SortableTh
                label="AMT LL"
                sortKey="amountLbp"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                align="text-right"
                className="px-0.5"
              />
              <SortableTh
                label="$ COLL"
                sortKey="collectedUsd"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                align="text-right"
                className="px-0.5"
              />
              <SortableTh
                label="LL COLL"
                sortKey="collectedLbp"
                activeKey={sort.key}
                dir={sort.dir}
                onSort={handleSort}
                align="text-right"
                className="px-0.5"
              />
              <th className="px-0.5 py-2 whitespace-nowrap">WA</th>
              <th className="px-0.5 py-2 whitespace-nowrap">DOC</th>
              {onCopyLink && (
                <th className="px-0.5 py-2 whitespace-nowrap">LINK</th>
              )}
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {sortedOrders.flatMap(renderTableRow)}
          </tbody>
        </table>
      </div>

      {historyModalOrder && (
        <OrderHistoryModal
          orderId={historyModalOrder.id}
          orderHistory={historyModalOrder.history}
          payoutReference={historyModalOrder.payoutReference}
          onClose={() => setHistoryModalOrder(null)}
        />
      )}
    </>
  );
}
