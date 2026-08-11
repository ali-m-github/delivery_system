"use client";

import { useEffect, useState } from "react";
import { BrowserQRCodeSvgWriter } from "@zxing/library";

interface WaybillQRCodeProps {
  /** The string encoded inside the QR matrix (e.g. the order ID). */
  value: string;
  /** Render size in pixels. */
  size?: number;
}

/**
 * Renders a scannable QR code as a data-URL <img> so it survives both browser
 * printing and html2canvas/PDF capture. Uses the already-bundled
 * `@zxing/library` SVG writer to avoid introducing a new dependency.
 */
export function WaybillQRCode({ value, size = 110 }: WaybillQRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    try {
      const writer = new BrowserQRCodeSvgWriter();
      const svg = writer.write(value || "NO-ORDER", size, size);
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
  }, [value, size]);

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
