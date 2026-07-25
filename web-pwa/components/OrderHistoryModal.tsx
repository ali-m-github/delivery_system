"use client";

import { useState, useEffect } from "react";

interface HistoryEntry {
  id: string;
  action: string;
  location: string | null;
  driverId: string | null;
  user?: { id: string; username: string } | null;
  createdAt: string;
}

interface OrderHistoryModalProps {
  orderId: string;
  orderHistory: HistoryEntry[];
  onClose: () => void;
}

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  WITH_DRIVER: "With Driver",
  DELIVERED: "Delivered",
  RETURN: "Returned",
  Re: "Returned",
  RTS: "Returned to Seller",
  ASSIGNED: "Assigned",
};

const LOCATION_COLORS: Record<string, string> = {
  WAREHOUSE: "text-yellow-400 bg-yellow-500/10",
  WITH_DRIVER: "text-cyan-400 bg-cyan-500/10",
  DELIVERED: "text-green-400 bg-green-500/10",
  RETURN: "text-red-400 bg-red-500/10",
  Re: "text-red-400 bg-red-500/10",
  RTS: "text-purple-400 bg-purple-500/10",
  ASSIGNED: "text-blue-400 bg-blue-500/10",
};

export default function OrderHistoryModal({
  orderId,
  orderHistory,
  onClose,
}: OrderHistoryModalProps) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(!orderHistory);

  useEffect(() => {
    if (orderHistory) {
      setHistory(orderHistory);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch("/api/orders")
      .then((res) => res.json())
      .then((orders: any[]) => {
        const found = orders.find((o) => o.id === orderId);
        if (found?.history) {
          setHistory(found.history);
        } else {
          setHistory([]);
        }
        setLoading(false);
      })
      .catch(() => {
        setHistory([]);
        setLoading(false);
      });
  }, [orderId, orderHistory]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // Sort oldest to newest
  const sortedHistory = (history || []).slice().sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const formatTimestamp = (iso: string) => {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "Asia/Beirut",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  };

  const formatAction = (action: string) => {
    if (!action) return "";
    // Format actions with arrows for better readability
    return action
      .replace(/ -> /g, " → ")
      .replace(/Price\$/g, "Price $")
      .replace(/PriceLL/g, "Price LL")
      .replace(/Collected:/g, "Collected:");
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a2235] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">Order History</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Complete action log for this order
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
              <span className="ml-3 text-gray-400 text-sm">
                Loading history...
              </span>
            </div>
          ) : sortedHistory.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-12 h-12 mx-auto text-gray-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-gray-500 text-sm">No history records found.</p>
            </div>
          ) : (
            <div className="space-y-0">
              {sortedHistory.map((entry, index) => {
                const locationLabel =
                  LOCATION_LABELS[entry.location || ""] ||
                  entry.location ||
                  "—";
                const locationColor =
                  LOCATION_COLORS[entry.location || ""] ||
                  "text-gray-400 bg-gray-500/10";

                return (
                  <div
                    key={entry.id}
                    className="relative flex gap-4 py-3 group"
                  >
                    {/* Timeline line */}
                    {index < sortedHistory.length - 1 && (
                      <div className="absolute left-[15px] top-[36px] bottom-[-12px] w-0.5 bg-white/10 group-hover:bg-cyan-500/30 transition-colors" />
                    )}

                    {/* Timeline dot */}
                    <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-cyan-400" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-1">
                      {/* Username + timestamp row */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs font-medium text-cyan-300">
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                          </svg>
                          {entry.user?.username || "System"}
                        </span>
                        <span className="text-[11px] text-gray-500">
                          {formatTimestamp(entry.createdAt)}
                        </span>
                      </div>

                      {/* Action description */}
                      <p className="text-sm text-gray-200 leading-relaxed">
                        {formatAction(entry.action)}
                      </p>

                      {/* Location badge */}
                      {entry.location && (
                        <span
                          className={`inline-block mt-1.5 px-2 py-0.5 rounded text-[10px] font-semibold ${locationColor}`}
                        >
                          {locationLabel}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
