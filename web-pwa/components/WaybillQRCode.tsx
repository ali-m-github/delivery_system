"use client";

import { useEffect, useState } from "react";
import { BrowserQRCodeSvgWriter, EncodeHintType } from "@zxing/library";

interface WaybillQRCodeProps {
  /** The string encoded inside the QR matrix (e.g. the order ID). */
  value: string;
  /** Render size in pixels. */
  size?: number;
  /**
   * QR error correction level. "M" (~15%) is the default: enough
   * tolerance for glare / thermal-printer specks without densifying
   * the module matrix (keeps modules large → fast phone-camera focus).
   */
  level?: "L" | "M" | "Q" | "H";
}

/**
 * Renders a scannable QR code as a data-URL <img> so it survives both browser
 * printing and html2canvas/PDF capture. Uses the already-bundled
 * `@zxing/library` SVG writer to avoid introducing a new dependency.
 */
export function WaybillQRCode({ value, size = 110, level = "M" }: WaybillQRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    try {
      const writer = new BrowserQRCodeSvgWriter();
      // BrowserQRCodeSvgWriter defaults to error correction "L" (~7%).
      // Explicitly request the chosen level (default "M", ~15%) so the
      // matrix stays readable under glare or partial damage while remaining
      // sparse enough for low-light phone cameras to resolve quickly.
      const hints = new Map([[EncodeHintType.ERROR_CORRECTION, level]]);
      const svg = writer.write(value || "NO-ORDER", size, size, hints);
      const xml = new XMLSerializer().serializeToString(svg);
      // btoa() is Latin-1 only, so percent-decode the UTF-8 XML before encoding.
      const svg64 = btoa(
        encodeURIComponent(xml).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        ),
      );
      // The QR must be generated post-hydration: BrowserQRCodeSvgWriter calls
      // document.createElementNS, which cannot run during SSR/render. Writing the
      // derived data URL into state from the effect is the documented pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataUrl(`data:image/svg+xml;base64,${svg64}`);
    } catch (err) {
      console.error("[WaybillQRCode] Failed to render QR code:", err);
      setDataUrl("");
    }
  }, [value, size, level]);

  if (!dataUrl) {
    // Reserve the exact space so the card layout stays stable even if QR
    // generation fails (e.g. an unusually long payload).
    return (
      <div
        className="waybill-qr-placeholder"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt={`QR code for ${value}`}
      width={size}
      height={size}
      className="waybill-qr-img"
    />
  );
}
