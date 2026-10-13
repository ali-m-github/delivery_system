"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

// Renders a "Download PDF" button just above the orders table (hidden when the
// page itself is printed, via the .no-print rule in page.tsx, and excluded
// from the capture via ignoreElements). The PDF is generated ONLY on click —
// links that used to pass ?pdf=true for an auto-download now rely on this
// button; the ?filename= param is still honored for the download name.
//
// Rendering uses html2canvas-pro + jsPDF directly instead of html2pdf.js:
// html2pdf bundles html2canvas@1.4.x, which throws on the oklch() colors that
// Tailwind v4 emits, so the worker silently rejected and nothing downloaded.
export function PdfDownloadTrigger() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPdf = useCallback(async () => {
    const element = document.getElementById("print-container");
    if (!element || busy) return;

    const rawName = searchParams.get("filename") || "Orders_Export";
    const filename = rawName.endsWith(".pdf") ? rawName : `${rawName}.pdf`;

    setBusy(true);
    setError(null);
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        // The button lives inside #print-container (so it sits directly above
        // the table); drop it from the capture so it never appears in the PDF.
        ignoreElements: (el) => el.classList?.contains("no-print"),
      });

      const pdf = new jsPDF({
        unit: "pt",
        format: "letter",
        orientation: "landscape",
        compress: true,
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 28;
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;

      // Canvas pixels per PDF point at the output scale, and the slice of the
      // canvas that fits on one page.
      const pxPerPt = canvas.width / contentW;
      const pageSliceH = Math.floor(contentH * pxPerPt);

      let y = 0;
      let page = 0;
      while (y < canvas.height) {
        const sliceH = Math.min(pageSliceH, canvas.height - y);

        // Copy the slice into its own canvas so addImage gets an exact page.
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = sliceH;
        const ctx = slice.getContext("2d");
        if (!ctx) break;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        if (page > 0) pdf.addPage();
        pdf.addImage(
          slice.toDataURL("image/jpeg", 0.95),
          "JPEG",
          margin,
          margin,
          contentW,
          sliceH / pxPerPt,
        );

        y += sliceH;
        page++;
      }

      pdf.save(filename);
    } catch (err) {
      console.error("[print/orders] PDF generation failed:", err);
      setError("PDF generation failed — see console for details.");
    } finally {
      setBusy(false);
    }
  }, [searchParams, busy]);

  return (
    <div className="no-print mb-2 flex items-center justify-end gap-3 print:hidden">
      {error && <span className="text-xs font-medium text-red-600">{error}</span>}
      <button
        onClick={runPdf}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded border border-gray-400 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
          <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
        {busy ? "Generating PDF…" : "Download PDF"}
      </button>
    </div>
  );
}
