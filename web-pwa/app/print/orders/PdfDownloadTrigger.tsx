"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Auto-downloads the rendered orders table as a PDF when ?pdf=true is present.
// Mirrors the waybill page's html2pdf download flow.
export function PdfDownloadTrigger() {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("pdf") !== "true") return;

    const timer = setTimeout(() => {
      const element = document.getElementById("print-container");
      if (!element) return;

      const filename =
        searchParams.get("filename") || "Orders_Export";

      import("html2pdf.js").then((html2pdf) => {
        const opt = {
          margin: 0.4,
          filename: `${filename}.pdf`,
          image: { type: "jpeg" as const, quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: {
            unit: "in" as const,
            format: "letter" as const,
            orientation: "landscape" as const,
          },
        };
        html2pdf
          .default()
          .set(opt)
          .from(element)
          .save()
          .then(() => window.close());
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [searchParams]);

  return null;
}
