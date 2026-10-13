"use client";

import { useEffect, useState } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Shared merchant notification-preferences panel.
//
// Loads the merchant's saved preferences from /api/merchant/notification-settings
// (a null column returns the server-side defaults: everything enabled) and lets
// the merchant toggle delivery channels and per-event alerts. Saving writes a
// fully-materialized preferences object back via PATCH.
//
// Rendered inside NotificationSettingsModal (notification bell) and inside the
// sidebar SettingsModal (Notifications tab) — mount it once per open so every
// open starts from a clean state and immediately loads the saved preferences.
// ──────────────────────────────────────────────────────────────────────────────

interface NotificationPreferences {
  channels: {
    inApp: boolean;
    whatsapp: boolean;
  };
  events: {
    DELIVERED: boolean;
    POSTPONED: boolean;
    PRICE_DISCREPANCY: boolean;
    REJECTED: boolean;
  };
}

const EVENT_LABELS: Array<{
  key: keyof NotificationPreferences["events"];
  icon: string;
  label: string;
  description: string;
}> = [
  {
    key: "DELIVERED",
    icon: "✅",
    label: "Order delivered",
    description: "A driver marked an order as delivered",
  },
  {
    key: "POSTPONED",
    icon: "🕐",
    label: "Delivery postponed",
    description: "A driver postponed a delivery attempt",
  },
  {
    key: "PRICE_DISCREPANCY",
    icon: "⚠️",
    label: "COD price discrepancy",
    description: "Collected amount differs from the expected COD",
  },
  {
    key: "REJECTED",
    icon: "❌",
    label: "Order rejected / returned",
    description: "The customer rejected the order",
  },
];

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-40 ${
        checked ? "bg-cyan-500" : "bg-white/15"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function NotificationSettingsPanel() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/merchant/notification-settings")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Failed to load notification settings");
        } else {
          setPreferences(data.preferences);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Network error. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setChannel = (channel: "inApp" | "whatsapp", value: boolean) => {
    setSaved(false);
    setPreferences((prev) =>
      prev
        ? { ...prev, channels: { ...prev.channels, [channel]: value } }
        : prev,
    );
  };

  const setEvent = (
    event: keyof NotificationPreferences["events"],
    value: boolean,
  ) => {
    setSaved(false);
    setPreferences((prev) =>
      prev ? { ...prev, events: { ...prev.events, [event]: value } } : prev,
    );
  };

  const handleSave = async () => {
    if (!preferences) return;
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/merchant/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save notification settings");
        return;
      }
      setPreferences(data.preferences);
      setSaved(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
        </div>
      ) : !preferences ? (
        <p className="text-sm text-gray-400 py-4">
          {error || "Unable to load preferences."}
        </p>
      ) : (
        <>
          {/* ── Channels ───────────────────────────────────────────── */}
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
            Channels
          </h3>
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between gap-4 bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm text-gray-200">
                  🔔 In-app notifications
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Alerts in the notification bell on this dashboard
                </p>
              </div>
              <Toggle
                checked={preferences.channels.inApp}
                onChange={(v) => setChannel("inApp", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm text-gray-200">📞 WhatsApp</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sent to the phone number on your merchant profile
                </p>
              </div>
              <Toggle
                checked={preferences.channels.whatsapp}
                onChange={(v) => setChannel("whatsapp", v)}
              />
            </div>
          </div>

          {/* ── Events ─────────────────────────────────────────────── */}
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
            Events
          </h3>
          <div className="space-y-3">
            {EVENT_LABELS.map((evt) => (
              <div
                key={evt.key}
                className="flex items-center justify-between gap-4 bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3"
              >
                <div>
                  <p className="text-sm text-gray-200">
                    {evt.icon} {evt.label}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {evt.description}
                  </p>
                </div>
                <Toggle
                  checked={preferences.events[evt.key]}
                  onChange={(v) => setEvent(evt.key, v)}
                />
              </div>
            ))}
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="mt-4 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              Preferences saved.
            </p>
          )}

          {/* ── Save ───────────────────────────────────────────────── */}
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save preferences"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
