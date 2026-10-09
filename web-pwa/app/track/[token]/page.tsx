"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";

// ──────────────────────────────────────────────
// Types
//
// Legacy /track/<orderId> response. The API deliberately degrades to a
// minimal, non-sensitive payload: NO trackToken (a redirect would reveal
// the secret token to anyone who knows a predictable orderId), NO phone /
// address / merchant / driver, NO raw history entries (raw actions contain
// amounts and internal notes). The timeline is already mapped and
// financially filtered server-side with the same rules as the tokenized
// endpoint.
// ──────────────────────────────────────────────

interface TimelineEntry {
  status: string;
  detail: string | null;
  at: string;
}

interface OrderData {
  orderId: string;
  customerName: string;
  status: string;
  timeline: TimelineEntry[];
  createdAt: string;
  updatedAt: string;
  // Customer delivery actions (prefill for the "Delivery Assistance"
  // card). Sent by the customer themselves, so not treated as PII.
  latitude: number | null;
  longitude: number | null;
  deliveryPreference: string | null;
  deliveryNotes: string | null;
}
// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// The API now returns an already-masked customer name (PII hardening).
// Display it as-is; nothing here may re-introduce unmasked PII.

function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getDateString(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0B0F17]">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
    </div>
  );
}

function InlineSpinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0B0F17] px-4 text-center">
      <div className="text-red-400 text-5xl mb-4">!</div>
      <h2 className="text-xl font-semibold text-white mb-2">Tracking Error</h2>
      <p className="text-gray-400">{message}</p>
    </div>
  );
}

function ExceptionBanner({ label }: { label: string }) {
  return (
    <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 mb-6 flex items-center gap-3">
      <span className="text-red-400 text-lg">⚠</span>
      <div>
        <p className="text-red-300 text-sm font-semibold">Delivery Exception</p>
        <p className="text-red-200 text-sm">{label}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Delivery Assistance card
//
// Lets the customer pin their exact GPS location, pick a delivery
// preference, and add building/floor/gate details without logging in.
// Writes go to PATCH /api/track/<token>, which rejects updates once the
// order is delivered/cancelled (the card hides itself on that 409).
// ──────────────────────────────────────────────

const DELIVERY_PREFERENCE_OPTIONS = [
  "Leave with concierge / guard",
  "Call upon arrival",
  "Leave at doorstep",
  "Ring intercom / gate",
] as const;

interface SavedDelivery {
  latitude: number | null;
  longitude: number | null;
  deliveryPreference: string | null;
  deliveryNotes: string | null;
}

function DeliveryAssistanceCard({
  token,
  saved,
  onLocked,
}: {
  token: string;
  saved: SavedDelivery;
  onLocked: () => void;
}) {
  // Prefill from any values the customer saved previously.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    saved.latitude !== null && saved.longitude !== null
      ? { lat: saved.latitude, lng: saved.longitude }
      : null,
  );
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [preference, setPreference] = useState(saved.deliveryPreference ?? "");
  const [notes, setNotes] = useState(saved.deliveryNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  // Auto-dismiss feedback banners.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function shareLocation() {
    if (!("geolocation" in navigator)) {
      setGeoError("Your browser doesn't support location sharing.");
      return;
    }
    setGeoLoading(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in your browser settings, or just enter your building details below."
            : "Couldn't get your location. Please try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  async function savePreferences() {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/track/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: coords ? coords.lat : null,
          longitude: coords ? coords.lng : null,
          deliveryPreference: preference || null,
          deliveryNotes: notes || null,
        }),
      });
      if (res.ok) {
        setToast({
          tone: "success",
          message: "Delivery preferences saved. Your courier will see them.",
        });
      } else if (res.status === 409) {
        // The order moved to delivered/cancelled while this page was
        // open — the card no longer applies.
        onLocked();
      } else {
        const json = await res.json().catch(() => null);
        setToast({
          tone: "error",
          message: json?.error ?? "Unable to save. Please try again.",
        });
      }
    } catch {
      setToast({ tone: "error", message: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">
        Delivery Assistance
      </h2>
      <p className="text-gray-500 text-xs mb-5">
        Help your courier find you — pin your exact location and add delivery
        instructions.
      </p>

      {/* ── GPS pin ── */}
      <div className="mb-5">
        {coords ? (
          <div className="flex items-center justify-between gap-3 bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-green-400 flex-shrink-0">📍</span>
              <span className="text-green-300 text-xs font-medium truncate">
                Location pinned (Lat: {coords.lat.toFixed(5)}, Lng:{" "}
                {coords.lng.toFixed(5)})
              </span>
            </div>
            <button
              type="button"
              onClick={shareLocation}
              disabled={geoLoading}
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-green-200 border border-green-700/60 rounded-md px-2 py-1 hover:bg-green-800/40 disabled:opacity-50 transition-colors"
            >
              {geoLoading && <InlineSpinner />}
              Update
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={shareLocation}
            disabled={geoLoading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
          >
            {geoLoading && <InlineSpinner />}
            {geoLoading
              ? "Getting your location…"
              : "Share My Exact Location (GPS Pin)"}
          </button>
        )}
        {geoError && (
          <p className="text-amber-400 text-xs mt-2" role="alert">
            {geoError}
          </p>
        )}
      </div>

      {/* ── Quick preference chips (single-select) ── */}
      <div className="mb-5">
        <span className="block text-gray-500 text-xs uppercase tracking-wider mb-2">
          Delivery preference
        </span>
        <div className="flex flex-wrap gap-2">
          {DELIVERY_PREFERENCE_OPTIONS.map((opt) => {
            const active = preference === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                onClick={() => setPreference(active ? "" : opt)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-[#0B0F17] border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Building / floor / gate code ── */}
      <div className="mb-5">
        <label
          htmlFor="delivery-notes"
          className="block text-gray-500 text-xs uppercase tracking-wider mb-2"
        >
          Building, Floor, or Gate Code (optional)
        </label>
        <input
          id="delivery-notes"
          type="text"
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Al Manara Tower, Floor 12, Gate Code 4421"
          className="w-full bg-[#0B0F17] border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <button
        type="button"
        onClick={savePreferences}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
      >
        {saving && <InlineSpinner />}
        {saving ? "Saving…" : "Save Delivery Preferences"}
      </button>

      {toast && (
        <div
          role="status"
          className={`mt-4 rounded-lg border px-3 py-2.5 text-xs ${
            toast.tone === "success"
              ? "bg-green-900/30 border-green-700/50 text-green-300"
              : "bg-red-900/30 border-red-700/50 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────

export default function TrackOrderPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Set when the server reports the order became locked (delivered /
  // cancelled) while the page was open — hides the assistance card.
  const [deliveryLocked, setDeliveryLocked] = useState(false);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/track/${params.token}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Order not found. Please check your tracking ID.");
          } else {
            setError("Unable to load tracking information.");
          }
          return;
        }
        const json: OrderData = await res.json();
        setData(json);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [params.token]);

  // Timeline arrives pre-mapped and financially filtered from the server
  // (same rules as the tokenized endpoint).
  const timelineEntries = useMemo(
    () => (data ? data.timeline : []),
    [data],
  );

  // Group entries by date
  const grouped = useMemo(() => {
    const groups: { date: string; entries: TimelineEntry[] }[] = [];
    for (const entry of timelineEntries) {
      const dateKey = getDateString(entry.at);
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ date: dateKey, entries: [entry] });
      }
    }
    return groups;
  }, [timelineEntries]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Order not found." />;

  const exception = data.status === "Returned" || data.status === "Postponed";
  // The assistance card is pointless (and the API rejects it) once the
  // order is delivered or cancelled.
  const orderLocked =
    data.status === "Delivered" || data.status === "Cancelled";

  return (
    <div className="max-w-md mx-auto min-h-screen p-4 bg-[#0B0F17]">
      {/* ── Header ── */}
      <div className="mb-8 pt-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Track Order
        </h1>
        <p className="text-gray-500 text-sm mt-1">Real-time delivery updates</p>
      </div>

      {/* ── Exception Banner ── */}
      {exception && <ExceptionBanner label={data.status} />}

      {/* ── Order Card ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        {/* Status */}
        <div className="mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Status
          </span>
          <p
            className={`text-lg font-semibold mt-1 ${
              exception
                ? "text-red-400"
                : data.status === "Delivered"
                  ? "text-green-400"
                  : "text-white"
            }`}
          >
            {data.status}
          </p>
        </div>

        {/* Order ID */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Order ID
          </span>
          <span className="text-white text-sm font-mono">{data.orderId}</span>
        </div>

        {/* Customer (masked) */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Customer
          </span>
          <span className="text-white text-sm">
            {data.customerName}
          </span>
        </div>

        {/* Dates */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Placed
          </span>
          <span className="text-white text-sm">
            {new Date(data.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Last Update
          </span>
          <span className="text-white text-sm">
            {new Date(data.updatedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        </div>
      </div>

      {/* ── FedEx-style Timeline ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-5">
          Progress
        </h2>

        {timelineEntries.length === 0 ? (
          <p className="text-gray-500 text-sm">No updates yet.</p>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.date}>
                {/* Date header */}
                <p className="text-xs font-semibold text-gray-400 mb-2">
                  {formatDayHeader(group.entries[0].at)}
                </p>

                {/* Entries for this date */}
                <div className="space-y-0">
                  {group.entries.map((entry, idx) => (
                    <div key={idx} className="flex gap-3">
                      {/* Time column */}
                      <div className="w-16 flex-shrink-0 pt-0.5">
                        <span className="text-xs text-gray-500">
                          {formatTime(entry.at)}
                        </span>
                      </div>

                      {/* Timeline dot + line */}
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            idx === 0 ? "bg-indigo-500" : "bg-gray-600"
                          }`}
                        />
                        {idx < group.entries.length - 1 ||
                        grouped.indexOf(group) < grouped.length - 1 ? (
                          <div className="w-px h-8 bg-gray-700" />
                        ) : null}
                      </div>

                      {/* Status text */}
                      <div className="flex-1 pb-3">
                        <p className="text-sm text-white font-medium">
                          {entry.status}
                        </p>
                        {entry.detail && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {entry.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Delivery Assistance ── */}
      {!orderLocked && !deliveryLocked && (
        <DeliveryAssistanceCard
          token={params.token}
          saved={{
            latitude: data.latitude,
            longitude: data.longitude,
            deliveryPreference: data.deliveryPreference,
            deliveryNotes: data.deliveryNotes,
          }}
          onLocked={() => setDeliveryLocked(true)}
        />
      )}

      {/* ── Footer ── */}
      <p className="text-center text-gray-600 text-xs mt-8 pb-8">
        Jet Delivery &middot; Tracking Portal
      </p>
    </div>
  );
}
