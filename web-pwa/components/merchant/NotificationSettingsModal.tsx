"use client";

import NotificationSettingsPanel from "./NotificationSettingsPanel";

// ──────────────────────────────────────────────────────────────────────────────
// Merchant notification preferences modal (opened from the notification bell).
//
// Thin modal chrome around the shared NotificationSettingsPanel, which is also
// embedded in the sidebar SettingsModal under the "Notifications" tab.
// ──────────────────────────────────────────────────────────────────────────────

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function NotificationSettingsModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* ── Backdrop ──────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* ── Modal ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-md bg-[#121824] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span aria-hidden>🔔</span> Notification Preferences
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Choose how you want to be notified when drivers update your orders.
          </p>
        </div>

        {/* Body — shared panel (loads, toggles, and saves preferences) */}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
          <NotificationSettingsPanel />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
