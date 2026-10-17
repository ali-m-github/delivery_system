"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import WarehouseIntakePanel from "@/components/orders/WarehouseIntakePanel";

// ─── Types ────────────────────────────────────────────────────────────────────
// Mirrors the payloads of:
//   POST /api/orders/bulk/lookup        → { found: TrayOrder[], notFound: [] }
//   POST /api/admin/orders/universal-scan → { success, count, batchNumber?, ... }
//   GET  /api/admin/drivers             → DriverOption[] (id = DriverProfile.id)

interface TrayMerchant {
  id: string;
  merchantName: string;
  merchantId: number;
}

interface TrayDriver {
  id: string;
  firstName: string;
  lastName: string;
  driverId: string;
}

interface TrayOrder {
  id: string;
  orderId: string;
  location: string;
  financialStatus: string;
  driverId: string | null;
  customerName: string | null;
  merchant: TrayMerchant | null;
  driver: TrayDriver | null;
}

interface DriverOption {
  id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  isAvailable: boolean;
  drCount: number;
  trCount: number;
}

type ScannerAction =
  | "RECEIVE_PICKUP"
  | "ASSIGN_DRIVER"
  | "RETURNS_WAREHOUSE"
  | "RETURN_TO_SELLER"
  | "MARK_DELIVERED";

type Panel = null | "assign" | "returns";

export interface UniversalStaffScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after any successful action so the host page can refetch orders */
  onRefresh?: () => void;
}

// ─── Feedback helpers (WebAudio beep + haptics — no audio assets in repo) ─────

let sharedAudioCtx: AudioContext | null = null;

function playTone(freq: number, durationMs: number, type: OscillatorType) {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    sharedAudioCtx = sharedAudioCtx ?? new Ctor();
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + durationMs / 1000,
    );
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Audio feedback is best-effort only
  }
}

function feedbackSuccess() {
  playTone(880, 120, "sine");
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(80);
  }
}

function feedbackError() {
  playTone(220, 260, "square");
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([120, 60, 120]);
  }
}

// ─── Location label map (tray chips) ─────────────────────────────────────────

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  WITH_DRIVER: "With Driver",
  ASSIGNED: "Assigned",
  ASSIGNED_TR: "Transit",
  DELIVERED: "Delivered",
  RETURN: "Returns",
  RTS: "Return to Seller",
  CP: "Cash Pickup",
};

function locationLabel(loc: string): string {
  return LOCATION_LABELS[loc] ?? loc;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UniversalStaffScannerModal({
  isOpen,
  onClose,
  onRefresh,
}: UniversalStaffScannerModalProps) {
  // ── Camera refs (same lifecycle pattern as BarcodeScannerModal) ──────────
  const html5QrRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  // ── Scanned tray ─────────────────────────────────────────────────────────
  const [tray, setTray] = useState<TrayOrder[]>([]);
  // Ref mirror so the camera/USB callbacks never see a stale tray closure.
  const trayRef = useRef<TrayOrder[]>([]);
  useEffect(() => {
    trayRef.current = tray;
  }, [tray]);

  // Debounce identical codes re-read by the camera within a short window.
  const lastScanRef = useRef<{ code: string; time: number }>({
    code: "",
    time: 0,
  });

  // ── USB HID (keyboard-wedge) buffer ──────────────────────────────────────
  const usbBufferRef = useRef("");

  // ── UI state ─────────────────────────────────────────────────────────────
  const [flash, setFlash] = useState<string | null>(null);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [manualCode, setManualCode] = useState("");

  // ── Tabs: the tray scanner and the embedded warehouse-intake panel ───────
  const [activeTab, setActiveTab] = useState<"tray" | "intake">("tray");

  // ── Driver picker ────────────────────────────────────────────────────────
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [assignmentType, setAssignmentType] = useState<"DR" | "TR">("DR");

  // ── Load drivers when the modal opens (ids are DriverProfile.id) ─────────
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await fetch("/api/admin/drivers");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setDrivers(data);
        }
      } catch {
        // Picker stays empty; ASSIGN_DRIVER will surface the server error.
      }
    })();
  }, [isOpen]);

  // ── Resolve a scanned/typed code into a tray entry ───────────────────────
  const resolveCode = useCallback(async (raw: string) => {
    const code = raw.trim().replace(/^#/, "");
    if (!code) return;

    // Ignore the camera re-reading the same code back-to-back.
    const now = Date.now();
    if (
      lastScanRef.current.code === code &&
      now - lastScanRef.current.time < 1500
    ) {
      return;
    }
    lastScanRef.current = { code, time: now };

    if (trayRef.current.some((o) => o.orderId === code)) {
      feedbackError();
      setFlash(`#${code} is already in the tray`);
      return;
    }

    setResolving(true);
    try {
      const res = await fetch("/api/orders/bulk/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [code] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        feedbackError();
        setErrorAlert(
          typeof data.error === "string" ? data.error : "Lookup failed",
        );
        return;
      }

      const found: TrayOrder | undefined = (data.found ?? [])[0];
      if (!found) {
        feedbackError();
        setFlash(`#${code} — order not found`);
        return;
      }

      setTray((prev) =>
        prev.some((o) => o.id === found.id) ? prev : [...prev, found],
      );
      feedbackSuccess();
      setFlash(`#${found.orderId} added to tray`);
    } catch {
      feedbackError();
      setErrorAlert("Could not reach the lookup service. Check your network.");
    } finally {
      setResolving(false);
    }
  }, []);

  // Keep the latest resolveCode in a ref so startCamera's identity never
  // changes when the parent re-renders (same trick as BarcodeScannerModal).
  const resolveCodeRef = useRef(resolveCode);
  useEffect(() => {
    resolveCodeRef.current = resolveCode;
  }, [resolveCode]);

  // ── USB HID keyboard-wedge capture ───────────────────────────────────────
  // Hardware scanners type the code and finish with Enter. When focus is not
  // in an editable field, buffer printable keys and flush on Enter.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "Enter") {
        const code = usbBufferRef.current;
        usbBufferRef.current = "";
        if (code.trim()) {
          e.preventDefault();
          resolveCodeRef.current(code);
        }
        return;
      }
      if (editable) return; // real typing — leave it to the focused field
      if (e.key.length === 1) usbBufferRef.current += e.key;
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  // Auto-clear the transient flash line.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Stop and clean up camera ─────────────────────────────────────────────
  const stopCamera = useCallback(async () => {
    if (html5QrRef.current) {
      try {
        if (html5QrRef.current.isScanning) {
          await html5QrRef.current.stop();
        }
        html5QrRef.current.clear();
      } catch {
        // Camera may already be stopped — ignore
      }
      html5QrRef.current = null;
    }
  }, []);

  // ── Start camera (continuous — does NOT stop after the first hit) ────────
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setInitializing(true);
    await stopCamera();

    const viewportId = "universal-staff-scanner-viewport";
    const viewportEl = document.getElementById(viewportId);
    if (!viewportEl) {
      setCameraError("Scanner viewport not found.");
      setInitializing(false);
      return;
    }

    try {
      const html5QrCode = new Html5Qrcode(viewportId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        useBarCodeDetectorIfSupported: true,
      });
      html5QrRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText: string) => {
          // Continuous scanning: resolveCode itself debounces repeats, so the
          // camera keeps running and parcels can be scanned back-to-back.
          resolveCodeRef.current(decodedText);
        },
        () => {},
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("NotAllowedError") ||
        message.includes("Permission denied") ||
        message.includes("permission")
      ) {
        setCameraError(
          "Camera permission denied. Allow camera access, or use a USB scanner / manual entry below.",
        );
      } else if (
        message.includes("NotFoundError") ||
        message.includes("No available")
      ) {
        setCameraError(
          "No camera found. A USB barcode scanner or manual entry still works.",
        );
      } else {
        setCameraError(`Failed to start camera: ${message}`);
      }
    } finally {
      setInitializing(false);
    }
  }, [stopCamera]);

  // ── React to isOpen changes ───────────────────────────────────────────────
  // Reset to the tray tab whenever the modal is (re)opened.
  useEffect(() => {
    if (isOpen) setActiveTab("tray");
  }, [isOpen]);

  // The tray camera only runs on the "tray" tab; the intake tab uses the panel's
  // own per-batch scanner, so the tray camera is released when switching tabs.
  useEffect(() => {
    if (isOpen && activeTab === "tray") {
      const timeout = setTimeout(() => {
        startCamera();
      }, 150);
      return () => clearTimeout(timeout);
    } else {
      stopCamera();
    }
  }, [isOpen, activeTab, startCamera, stopCamera]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  // ── Run one of the four scanner actions against the whole tray ───────────
  const runAction = useCallback(
    async (
      action: ScannerAction,
      extra?: { driverId?: string; assignmentType?: "DR" | "TR" },
    ) => {
      if (trayRef.current.length === 0) {
        setErrorAlert("Scan at least one parcel before running an action.");
        return;
      }

      setBusy(true);
      setErrorAlert(null);
      setSuccessMsg(null);
      try {
        const res = await fetch("/api/admin/orders/universal-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            orderIds: trayRef.current.map((o) => o.id),
            ...extra,
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
          feedbackError();
          setErrorAlert(
            typeof data.error === "string"
              ? data.error
              : "The action failed. Please try again.",
          );
          return;
        }

        feedbackSuccess();
        switch (action) {
          case "RECEIVE_PICKUP":
            setSuccessMsg(
              `Received ${data.count} parcel(s) at the warehouse` +
                (data.reconciledBatches
                  ? ` — ${data.reconciledBatches} pickup batch(es) reconciled`
                  : ""),
            );
            break;
          case "ASSIGN_DRIVER":
            setSuccessMsg(
              `Assigned ${data.count} parcel(s) to ${data.driverName ?? "driver"} (${
                data.location === "ASSIGNED_TR" ? "Tr run" : "Dr run"
              })`,
            );
            break;
          case "RETURNS_WAREHOUSE":
            setSuccessMsg(
              `Moved ${data.count} parcel(s) to the returns warehouse`,
            );
            break;
          case "RETURN_TO_SELLER":
            setSuccessMsg(
              `Return batch ${data.batchNumber} created with ${data.count} parcel(s)`,
            );
            break;
          case "MARK_DELIVERED":
            setSuccessMsg(`Marked ${data.count} parcel(s) as delivered`);
            break;
        }
        setTray([]);
        setPanel(null);
        setSelectedDriverId("");
        onRefresh?.();
      } catch {
        feedbackError();
        setErrorAlert("Could not reach the server. Check your network.");
      } finally {
        setBusy(false);
      }
    },
    [onRefresh],
  );

  // ── RTS client-side pre-check (server enforces this too) ─────────────────
  const merchantIdsInTray = Array.from(
    new Set(tray.map((o) => o.merchant?.id).filter(Boolean)),
  );

  const handleReturnToSeller = () => {
    if (merchantIdsInTray.length > 1) {
      feedbackError();
      setErrorAlert(
        `Mixed merchants detected (${merchantIdsInTray.length} merchants). All parcels in a Return to Seller batch must belong to the SAME merchant — remove the foreign parcels from the tray first.`,
      );
      return;
    }
    void runAction("RETURN_TO_SELLER");
  };

  const removeTrayItem = (id: string) => {
    setTray((prev) => prev.filter((o) => o.id !== id));
  };

  const clearTray = () => {
    setTray([]);
    setPanel(null);
    setErrorAlert(null);
    setSuccessMsg(null);
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    void resolveCode(manualCode);
    setManualCode("");
  };

  // ── Don't render if not open ─────────────────────────────────────────────
  if (!isOpen) return null;

  const trayEmpty = tray.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      {/* ── Dark backdrop ── */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* ── Panel ── */}
      <div className="relative z-10 w-full max-w-5xl max-h-[95vh] overflow-y-auto bg-[#0d1220] border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10 sticky top-0 bg-[#0d1220] z-10">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              📷 Universal Staff Scanner
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Scan parcels into the tray and apply an action, or reconcile
              pickup batches in the Batch Intake tab.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close scanner"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Tabs: tray scanner / warehouse batch intake ── */}
        <div className="flex items-center gap-1 px-4 sm:px-6 pt-4">
          <button
            onClick={() => setActiveTab("tray")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "tray"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            📷 Scan Tray
          </button>
          <button
            onClick={() => setActiveTab("intake")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "intake"
                ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40"
                : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            📦 Batch Intake
          </button>
        </div>

        {activeTab === "tray" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4 p-4 sm:p-6">
          {/* ═══ Left: camera + manual entry ═══ */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-full max-w-[320px] aspect-square">
              <div
                id="universal-staff-scanner-viewport"
                className="absolute inset-0 rounded-2xl overflow-hidden bg-black/40"
              />
              <div className="absolute inset-0 rounded-2xl pointer-events-none">
                <div className="absolute top-0 left-0 w-10 h-10 border-t-2 border-l-2 border-cyan-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-10 h-10 border-t-2 border-r-2 border-cyan-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-10 h-10 border-b-2 border-l-2 border-cyan-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-10 h-10 border-b-2 border-r-2 border-cyan-400 rounded-br-lg" />
                <div className="absolute -inset-[2px] rounded-2xl border-2 border-cyan-500/40 shadow-[0_0_24px_rgba(6,182,212,0.25)]" />
              </div>
            </div>

            {initializing && (
              <div className="flex items-center gap-2 text-cyan-400 text-sm">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Starting camera...</span>
              </div>
            )}

            {cameraError && !initializing && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs text-center">
                {cameraError}
              </div>
            )}

            {/* Live scan feedback line */}
            <div className="h-5 text-xs text-center">
              {resolving && <span className="text-cyan-400">Resolving…</span>}
              {!resolving && flash && <span className="text-gray-400">{flash}</span>}
            </div>

            {/* Manual entry (also useful with a USB scanner in fallback mode) */}
            <form onSubmit={submitManual} className="flex w-full gap-2">
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Or type an order ID…"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors"
              >
                Add
              </button>
            </form>
          </div>

          {/* ═══ Right: tray + actions ═══ */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Alerts */}
            {errorAlert && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-300 text-sm flex items-start justify-between gap-3">
                <span>⚠️ {errorAlert}</span>
                <button
                  onClick={() => setErrorAlert(null)}
                  className="text-red-400 hover:text-white shrink-0"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}
            {successMsg && (
              <div className="px-4 py-3 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-start justify-between gap-3">
                <span>✅ {successMsg}</span>
                <button
                  onClick={() => setSuccessMsg(null)}
                  className="text-emerald-400 hover:text-white shrink-0"
                  aria-label="Dismiss success"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Tray */}
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
                <span className="text-xs uppercase tracking-wider text-gray-500 font-medium">
                  Scanned Tray — {tray.length} parcel(s)
                  {tray.length > 0 && (
                    <span className="ml-2 normal-case text-gray-400">
                      ({merchantIdsInTray.length} merchant
                      {merchantIdsInTray.length === 1 ? "" : "s"})
                    </span>
                  )}
                </span>
                {tray.length > 0 && (
                  <button
                    onClick={clearTray}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {trayEmpty ? (
                <div className="px-4 py-10 text-center text-gray-600 text-sm">
                  Nothing scanned yet. Point the camera at a waybill QR /
                  barcode, wave a USB scanner, or type an order ID above.
                  Parcels from multiple merchants can be scanned together.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 text-[10px] uppercase tracking-wider border-b border-white/10">
                        <th className="px-3 py-2 text-left">Order</th>
                        <th className="px-3 py-2 text-left">Merchant</th>
                        <th className="px-3 py-2 text-left">Recipient</th>
                        <th className="px-3 py-2 text-left">Location</th>
                        <th className="px-2 py-2 text-center">✕</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tray.map((o) => (
                        <tr key={o.id}>
                          <td className="px-3 py-2 font-mono text-gray-300 whitespace-nowrap">
                            #{o.orderId}
                          </td>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                            {o.merchant
                              ? `${o.merchant.merchantName} (M${o.merchant.merchantId})`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap max-w-[160px] truncate">
                            {o.customerName || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                              {locationLabel(o.location)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              onClick={() => removeTrayItem(o.id)}
                              className="text-gray-500 hover:text-red-400 transition-colors"
                              aria-label={`Remove #${o.orderId}`}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => void runAction("RECEIVE_PICKUP")}
                disabled={busy || trayEmpty}
                className="px-3 py-3 rounded-xl text-sm font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                📥 Receive Pickup
              </button>
              <button
                onClick={() => {
                  setErrorAlert(null);
                  setPanel(panel === "assign" ? null : "assign");
                }}
                disabled={busy || trayEmpty}
                className="px-3 py-3 rounded-xl text-sm font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                🚚 Assign Driver
              </button>
              <button
                onClick={() => {
                  setErrorAlert(null);
                  setPanel(panel === "returns" ? null : "returns");
                }}
                disabled={busy || trayEmpty}
                className="px-3 py-3 rounded-xl text-sm font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                🔄 Returns
              </button>
              <button
                onClick={() => void runAction("MARK_DELIVERED")}
                disabled={busy || trayEmpty}
                className="px-3 py-3 rounded-xl text-sm font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ✅ Mark Delivered
              </button>
            </div>

            {/* Assign Driver sub-panel */}
            {panel === "assign" && (
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 space-y-3">
                <div className="text-xs text-amber-300 font-medium">
                  Assign {tray.length} parcel(s) to a driver
                </div>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">Select a driver…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.driverId} — {d.firstName} {d.lastName}
                      {d.isAvailable ? "" : " (unavailable)"} · Dr {d.drCount} / Tr {d.trCount}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="assignment-type"
                      checked={assignmentType === "DR"}
                      onChange={() => setAssignmentType("DR")}
                    />
                    Dr — delivery run
                  </label>
                  <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="assignment-type"
                      checked={assignmentType === "TR"}
                      onChange={() => setAssignmentType("TR")}
                    />
                    Tr — transfer run
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      void runAction("ASSIGN_DRIVER", {
                        driverId: selectedDriverId,
                        assignmentType,
                      })
                    }
                    disabled={busy || !selectedDriverId}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Confirm Assignment
                  </button>
                  <button
                    onClick={() => setPanel(null)}
                    className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Returns sub-panel */}
            {panel === "returns" && (
              <div className="border border-purple-500/30 bg-purple-500/5 rounded-xl p-4 space-y-3">
                <div className="text-xs text-purple-300 font-medium">
                  Returns — choose where the {tray.length} scanned parcel(s) go
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => void runAction("RETURNS_WAREHOUSE")}
                    disabled={busy}
                    className="px-4 py-3 rounded-lg text-sm font-semibold bg-purple-500/15 text-purple-200 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    🏪 Move to Returns Warehouse
                  </button>
                  <button
                    onClick={handleReturnToSeller}
                    disabled={busy}
                    className="px-4 py-3 rounded-lg text-sm font-semibold bg-purple-500/15 text-purple-200 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    🔄 Return to Seller (RTS)
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  Return to Seller creates a batch per merchant — all parcels in
                  the tray must belong to the same merchant, otherwise the
                  action is blocked.
                </p>
              </div>
            )}
          </div>
        </div>
        )}

        {activeTab === "intake" && (
          <div className="p-4 sm:p-6">
            <WarehouseIntakePanel availableDrivers={drivers} />
          </div>
        )}
      </div>
    </div>
  );
}
