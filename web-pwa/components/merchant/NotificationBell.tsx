"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NotificationSettingsModal from "@/components/merchant/NotificationSettingsModal";

// ──────────────────────────────────────────────────────────────────────────────
// Merchant notification bell.
//
// Polls /api/merchant/notifications every 60s (same cadence as the rest of the
// portal's live data). Shows an unread-count badge, a dropdown of recent
// notifications with per-row / mark-all read actions, and a gear button that
// opens the notification preferences modal. Newly arrived unread rows are
// reported to the parent via onNewNotifications so it can raise a toast.
// ──────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;

interface NotificationMeta {
  orderRef?: string;
  driverName?: string | null;
  reasonCode?: string | null;
  discrepancy?: number;
}

interface NotificationRow {
  id: string;
  orderId: string | null;
  type: "DELIVERED" | "POSTPONED" | "PRICE_DISCREPANCY" | "REJECTED";
  title: string;
  message: string;
  meta: NotificationMeta | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<NotificationRow["type"], string> = {
  DELIVERED: "✅",
  POSTPONED: "🕐",
  PRICE_DISCREPANCY: "⚠️",
  REJECTED: "❌",
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type Props = {
  /** Called with rows that just appeared (unread, never seen this session). */
  onNewNotifications?: (notifications: NotificationRow[]) => void;
};

export default function NotificationBell({ onNewNotifications }: Props) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Ids already surfaced to the parent, so a page-load fetch never toasts.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/merchant/notifications", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        unreadCount: number;
        notifications: NotificationRow[];
      };

      setUnreadCount(data.unreadCount ?? 0);
      setNotifications(data.notifications ?? []);

      // First successful load only seeds the seen set; later diffs toast.
      if (seenIdsRef.current === null) {
        seenIdsRef.current = new Set(
          (data.notifications ?? [])
            .filter((n) => !n.isRead)
            .map((n) => n.id),
        );
      } else {
        const fresh = (data.notifications ?? []).filter(
          (n) => !n.isRead && !seenIdsRef.current!.has(n.id),
        );
        if (fresh.length > 0) {
          fresh.forEach((n) => seenIdsRef.current!.add(n.id));
          onNewNotifications?.(fresh);
        }
      }
    } catch {
      // Transient network hiccup — the next poll will retry.
    }
  }, [onNewNotifications]);

  useEffect(() => {
    // Defer the first fetch out of the effect body (react-hooks/set-state-in-effect);
    // the interval then keeps the badge fresh at the portal's usual ~60s cadence.
    const initial = setTimeout(fetchNotifications, 0);
    const timer = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [fetchNotifications]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (ids: string[]) => {
    // Optimistically update local state, then persist.
    setNotifications((prev) =>
      prev.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - ids.length));

    try {
      await fetch("/api/merchant/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // Next poll reconciles.
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/merchant/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // Next poll reconciles.
    }
  };

  const handleOpenDropdown = () => {
    setOpen((prev) => !prev);
    if (!open) {
      setLoading(true);
      fetchNotifications().finally(() => setLoading(false));
    }
  };

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          onClick={handleOpenDropdown}
          className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] bg-[#121824] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* Dropdown header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <p className="text-sm font-semibold text-white">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-red-400">
                    {unreadCount} unread
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs text-gray-400 hover:text-cyan-400 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => {
                    setOpen(false);
                    setSettingsOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Notification settings"
                  title="Notification settings"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="max-h-[420px] overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <div className="animate-spin rounded-full h-7 w-7 border-2 border-cyan-500 border-t-transparent" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-2xl mb-2" aria-hidden>
                    🔕
                  </p>
                  <p className="text-sm text-gray-500">
                    No notifications yet. Alerts appear here when drivers update
                    your orders.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.isRead) markRead([n.id]);
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors hover:bg-white/[0.04] ${
                      n.isRead ? "opacity-60" : "bg-cyan-500/[0.04]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-base leading-5 shrink-0" aria-hidden>
                        {TYPE_ICONS[n.type] ?? "🔔"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-sm truncate ${
                              n.isRead ? "text-gray-400" : "text-white font-medium"
                            }`}
                          >
                            {n.title}
                          </p>
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {timeAgo(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 break-words">
                          {n.message}
                        </p>
                      </div>
                      {!n.isRead && (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Conditional mount: each open starts from a clean state. */}
      {settingsOpen && (
        <NotificationSettingsModal
          isOpen
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
