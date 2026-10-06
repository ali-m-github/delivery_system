"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

// ─── TypeScript Interfaces ────────────────────────────────────────────────────

export interface BarcodeScannerModalProps {
  /** Controls visibility of the modal */
  isOpen: boolean;
  /** Called when the user closes the modal (camera stops) */
  onClose: () => void;
  /** Called when a barcode/QR is successfully decoded */
  onScanSuccess: (decodedText: string) => void;
  /** Optional heading text shown above the scanner viewport */
  heading?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BarcodeScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
  heading = "Scan Barcode / QR Code",
}: BarcodeScannerModalProps) {
  const html5QrRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef(false);
  // Keep the latest onScanSuccess in a ref so startCamera's identity never
  // changes when the parent re-renders — otherwise every parent state change
  // (toasts, spinners, router.refresh) tears down and restarts the camera.
  const onScanSuccessRef = useRef(onScanSuccess);
  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
  }, [onScanSuccess]);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  // ── Stop and clean up camera ──────────────────────────────────────────
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
    isScanningRef.current = false;
  }, []);

  // ── Start camera ───────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setError(null);
    setInitializing(true);

    // Ensure any previous instance is fully cleaned
    await stopCamera();

    const viewportId = "barcode-scanner-viewport";
    const viewportEl = document.getElementById(viewportId);
    if (!viewportEl) {
      setError("Scanner viewport not found.");
      setInitializing(false);
      return;
    }

    try {
      // Use the browser's native BarcodeDetector when available (hardware
      // accelerated on Android Chrome) and restrict decoding to the
      // symbologies we actually print: QR on waybills, Code 128 on packages.
      // Fewer decoders per frame = noticeably faster scans on low-end phones.
      const html5QrCode = new Html5Qrcode(viewportId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        useBarCodeDetectorIfSupported: true,
      });
      html5QrRef.current = html5QrCode;

      // Start the rear camera directly — skips the slow getCameras()
      // enumeration round-trip. Non-"exact" facingMode lets browsers without
      // a rear camera (e.g. desktop webcams) fall back to the default camera.
      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText: string) => {
          // Prevent duplicate callbacks from rapid re-scans
          if (isScanningRef.current) return;
          isScanningRef.current = true;

          // Call success handler
          onScanSuccessRef.current(decodedText);

          // The parent will call onClose, which triggers stopCamera via useEffect
        },
        // Ignore scan errors (e.g., partial reads, blurry frames)
        () => {},
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      if (
        message.includes("NotAllowedError") ||
        message.includes("Permission denied") ||
        message.includes("permission")
      ) {
        setError(
          "Camera permission denied. Please allow camera access in your browser settings and try again.",
        );
      } else if (
        message.includes("NotFoundError") ||
        message.includes("No available")
      ) {
        setError("No camera found on this device.");
      } else {
        setError(`Failed to start camera: ${message}`);
      }
    } finally {
      setInitializing(false);
    }
  }, [stopCamera]);

  // ── React to isOpen changes ────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure the DOM element is rendered
      const timeout = setTimeout(() => {
        startCamera();
      }, 150);
      return () => clearTimeout(timeout);
    } else {
      stopCamera();
    }
  }, [isOpen, startCamera, stopCamera]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // ── Handle manual close ────────────────────────────────────────────────
  const handleClose = () => {
    stopCamera();
    onClose();
  };

  // ── Don't render if not open ───────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center">
      {/* ── Dark backdrop ── */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-sm px-4">
        {/* Heading */}
        <h2 className="text-lg font-bold text-white mb-4 text-center">
          {heading}
        </h2>

        {/* ── Scan viewfinder ── */}
        <div className="relative w-[280px] h-[280px] sm:w-[320px] sm:h-[320px]">
          {/* Camera viewport — fills the scan area */}
          <div
            id="barcode-scanner-viewport"
            className="absolute inset-0 rounded-2xl overflow-hidden"
          />

          {/* ── Viewfinder overlay (on top of camera) ── */}
          <div className="absolute inset-0 rounded-2xl pointer-events-none">
            {/* Corner brackets */}
            {/* Top-left */}
            <div className="absolute top-0 left-0 w-10 h-10 border-t-2 border-l-2 border-cyan-400 rounded-tl-lg" />
            {/* Top-right */}
            <div className="absolute top-0 right-0 w-10 h-10 border-t-2 border-r-2 border-cyan-400 rounded-tr-lg" />
            {/* Bottom-left */}
            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-2 border-l-2 border-cyan-400 rounded-bl-lg" />
            {/* Bottom-right */}
            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-2 border-r-2 border-cyan-400 rounded-br-lg" />

            {/* ── Animated scan line ── */}
            <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan-line" />

            {/* ── Outer dark overlay (creates the "cutout" effect) — using box-shadow ── */}
            <div className="absolute -inset-[2px] rounded-2xl border-2 border-cyan-500/40 shadow-[0_0_24px_rgba(6,182,212,0.25)]" />
          </div>
        </div>

        {/* ── Initializing spinner ── */}
        {initializing && (
          <div className="mt-4 flex items-center gap-2 text-cyan-400 text-sm">
            <svg
              className="animate-spin h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span>Starting camera...</span>
          </div>
        )}

        {/* ── Error message ── */}
        {error && !initializing && (
          <div className="mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center max-w-xs">
            {error}
          </div>
        )}

        {/* ── Help text (shown when no error) ── */}
        {!error && !initializing && (
          <p className="mt-4 text-gray-500 text-xs text-center max-w-xs">
            Position the barcode or QR code within the frame. The scanner will
            detect it automatically.
          </p>
        )}

        {/* ── Close button ── */}
        <button
          onClick={handleClose}
          className="mt-6 px-8 py-3 rounded-xl text-sm font-semibold
                     bg-white/10 text-gray-300 border border-white/10
                     hover:bg-white/20 hover:text-white
                     transition-all duration-200"
        >
          Close Scanner
        </button>
      </div>
    </div>
  );
}
