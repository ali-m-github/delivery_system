"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { WaybillQRCode } from "@/components/WaybillQRCode";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Order {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  city: string | null;
  location: string;
  hasExchange: boolean;
  openParcelAllowed: boolean;
  isFragile: boolean;
  amountUsd: number;
  amountLbp: number;
  notes: string | null;
  packages: number;
  merchant: {
    merchantName: string | null;
    phone: string | null;
    logoUrl: string | null;
  } | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Print timestamp for the waybill footer. Always rendered in Beirut local
 *  time (GMT+2/GMT+3 with DST) regardless of the viewer's machine timezone.
 *  en-GB for the date, en-US for the time so the AM/PM marker is uppercase. */
function formatPrintTimestamp(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Beirut",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Beirut",
  });
  return `${date} ${time}`;
}

function formatLbp(value: number): string {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Builds a 1px solid black border from the given sides (collapses the shared
 *  edges of adjacent grid cells into a single line, like table borders). */
function B(sides: Array<"t" | "r" | "b" | "l">): React.CSSProperties {
  const s: React.CSSProperties = {};
  for (const side of sides) {
    if (side === "t") s.borderTop = "1px solid #000";
    if (side === "r") s.borderRight = "1px solid #000";
    if (side === "b") s.borderBottom = "1px solid #000";
    if (side === "l") s.borderLeft = "1px solid #000";
  }
  return s;
}

const TITLE_BAND: React.CSSProperties = {
  background: "#e9e9e9",
  fontWeight: 700,
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  padding: "5px 7px",
  whiteSpace: "nowrap",
  overflow: "hidden",
};

const BODY: React.CSSProperties = { padding: "6px 7px 4px" };

// ─── Checkbox cell (Exchange / Open Parcel Allowed / Fragile) ─────────────────
// Renders stacked checkbox rows inside a grid cell. The waybill uses a single
// instance spanning the address + special-instructions rows (rowStart/rowSpan)
// with `distribute`, so all three checkboxes share identical vertical spacing.
// `border` controls which edges draw a line — the spanning cell keeps only its
// bottom edge so no divider cuts between the checkboxes.
function CheckboxCell({
  items,
  colStart,
  colSpan,
  rowStart,
  rowSpan,
  distribute = false,
  border = ["b"],
}: {
  items: Array<{ label: string; checked: boolean }>;
  colStart: number;
  colSpan: number;
  rowStart?: number;
  rowSpan?: number;
  distribute?: boolean;
  border?: Array<"t" | "r" | "b" | "l">;
}) {
  return (
    <div
      style={{
        ...B(border),
        gridColumnStart: colStart,
        gridColumnEnd: colStart + colSpan,
        ...(rowStart
          ? { gridRowStart: rowStart, gridRowEnd: rowStart + (rowSpan ?? 1) }
          : {}),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 6px",
        fontSize: "10.5px",
        fontWeight: 700,
      }}
    >
      {/* Inner wrapper: `distribute` stretches it to the full cell height and
          spaces the rows evenly; otherwise rows sit flush (gap 0). The small
          vertical padding insets the first/last rows so they don't crowd the
          cell's top/bottom borders while keeping all gaps identical. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          ...(distribute
            ? { flex: 1, justifyContent: "space-between", paddingTop: 3, paddingBottom: 3 }
            : {}),
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              // Space-between mirrors the reference: short labels ("Exchange")
              // leave the box right-aligned; long labels ("Open Parcel Allowed")
              // push the box to sit right after the label.
              justifyContent: "space-between",
              gap: 4,
            }}
          >
            <span style={{ whiteSpace: "nowrap", letterSpacing: "-0.2px" }}>{item.label}</span>
            <span
              style={{
                width: 14,
                height: 14,
                border: "2px solid #000",
                display: "inline-block",
                flexShrink: 0,
                background: item.checked ? "#000" : "#fff",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Waybill card — one 6×4 inch label per order (matches Jett-Delivery-Waybill-6x4.pdf) ──
function WaybillCard({ order, printedAt }: { order: Order; printedAt: string }) {
  const merchantName = order.merchant?.merchantName || "—";
  const merchantPhone = order.merchant?.phone || "—";
  const logoUrl = order.merchant?.logoUrl || null;
  const codUsd = Number(order.amountUsd) || 0;
  const codLbp = Number(order.amountLbp) || 0;
  const packages = Number(order.packages) || 1;
  const address = (order.customerAddress || "").trim();
  // Internal import markers (e.g. bulk Excel/CSV imports) are metadata, not
  // merchant/user notes — never print them as Special Instructions.
  const AUTO_IMPORT_NOTE = "Imported via Bulk Excel/CSV tool";
  const rawNotes = (order.notes || "").trim();
  const notes = rawNotes === AUTO_IMPORT_NOTE ? "" : rawNotes;

  return (
    <div
      className="waybill-card"
      style={{
        position: "relative",
        width: "6in",
        height: "4in",
        boxSizing: "border-box",
        background: "#fff",
        // Inset margins matching the reference label: the bordered frame
        // (5.77in × 3.36in) sits 0.115in from the left/right edges and
        // 0.305in from the top, leaving a white band along the bottom edge.
        padding: "0.305in 0.115in 0.335in",
        fontFamily:
          "var(--font-geist-sans), Arial, 'Helvetica Neue', sans-serif",
        color: "#000",
        // 10.5px body: matches the reference's text density and keeps
        // "Name: <longest receiver>" on a single line in the 1.44fr column.
        fontSize: "10.5px",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "3.36in",
          boxSizing: "border-box",
          border: "1px solid #000",
          display: "grid",
          // Column 2 is a touch wider than the reference's 1.455in so the
          // receiver name stays on one line with a regular-width font.
          gridTemplateColumns: "1.34fr 1.5fr 1.44fr 1.51fr",
          // Row 1 grew 0.89in → 1.24in so the 110px waybill QR fits without
          // clipping. The address row (row 3) is a minmax track: it keeps its
          // 0.33in single-line height for short addresses but grows to fit
          // wrapped multi-line addresses. The declaration/signature row (row 5)
          // is minmax(0, 1fr): it absorbs the leftover space normally and
          // shrinks (down to its content height) only when the address row
          // grows — so long addresses are never truncated.
          gridTemplateRows: "1.24in 0.97in minmax(0.33in, auto) 0.47in minmax(0, 1fr)",
          overflow: "hidden",
          // The reference label is typeset in a condensed face (Arial Narrow);
          // request a condensed stretch so body text fits the same way.
          fontStretch: "condensed",
        }}
      >
      {/* ── ROW 1: header — merchant logo | JETT DELIVERY / WAYBILL | QR ── */}
      <div
        style={{
          ...B(["r", "b"]),
          padding: "0.09in",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Merchant logo"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        )}
        {/* No logo uploaded → the cell stays intentionally empty. */}
      </div>
      <div
        style={{
          ...B(["r", "b"]),
          gridColumn: "2 / 4",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            fontSize: "31px",
            letterSpacing: "1px",
            lineHeight: 1,
          }}
        >
          JET DELIVERY
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "73%",
            marginTop: 6,
          }}
        >
          <div style={{ flex: 1, height: 1, background: "#000" }} />
          <span style={{ fontWeight: 500, fontSize: "13px", letterSpacing: "6px", marginRight: 6 }}>
            WAYBILL
          </span>
          <div style={{ flex: 1, height: 1, background: "#000" }} />
        </div>
      </div>
      <div
        style={{
          ...B(["b"]),
          // Tightened padding: 110px QR + 2×0.04in (3.84px) = 117.7px, which
          // fits the 1.24in (119px) header row with ~1px of headroom.
          padding: "0.04in",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WaybillQRCode value={order.orderId} size={110} level="M" />
      </div>

      {/* ── ROW 2: SHIPMENT DETAILS | SHIP TO (RECEIVER) | SELLER / MERCHANT | TOTAL C.O.D. DUE ── */}
      <div
        style={{
          ...B(["r", "b"]),
          display: "grid",
          gridTemplateRows: "1fr auto",
          overflow: "hidden",
        }}
      >
        <div>
          <div style={TITLE_BAND}>SHIPMENT DETAILS</div>
          <div style={BODY}>
            <div style={{ fontWeight: 700 }}>
              Order ID: <span style={{ fontWeight: 400 }}>{order.orderId}</span>
            </div>
            <div style={{ marginTop: 3 }}>
              <span style={{ fontWeight: 700 }}>Date:</span> {formatDate(order.createdAt)}
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #000", padding: "5px 7px", fontWeight: 700 }}>
          Packages: <span style={{ fontWeight: 400 }}>{packages}</span>
        </div>
      </div>
      <div style={{ ...B(["r", "b"]), overflow: "hidden" }}>
        <div style={TITLE_BAND}>SHIP TO (RECEIVER)</div>
        <div style={BODY}>
          <div>
            <span style={{ fontWeight: 700 }}>Name:</span> {order.customerName || "—"}
          </div>
          <div style={{ marginTop: 3 }}>
            <span style={{ fontWeight: 700 }}>Phone:</span> {order.customerPhone || "—"}
          </div>
        </div>
      </div>
      <div style={{ ...B(["r", "b"]), overflow: "hidden" }}>
        <div style={TITLE_BAND}>SELLER / MERCHANT</div>
        <div style={BODY}>
          <div>
            <span style={{ fontWeight: 700 }}>Name:</span> {merchantName}
          </div>
          <div style={{ marginTop: 3 }}>
            <span style={{ fontWeight: 700 }}>Phone:</span> {merchantPhone}
          </div>
        </div>
      </div>
      <div style={{ ...B(["b"]), overflow: "hidden" }}>
        <div style={TITLE_BAND}>TOTAL C.O.D. DUE</div>
        <div style={{ ...BODY, fontWeight: 700, fontSize: "15px", lineHeight: 1.45 }}>
          <div>USD: {codUsd.toFixed(2)}</div>
          <div>LBP: {formatLbp(codLbp)}</div>
        </div>
      </div>

      {/* ── ROW 3: Address | Ex-Change ── */}
      <div
        style={{
          ...B(["r", "b"]),
          gridColumn: "1 / 4",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          fontSize: "13px",
          overflow: "hidden",
        }}
      >
        <b>Address:</b>
        {address ? (
          // Wraps onto as many lines as needed (the grid row grows with it);
          // break-word/anywhere prevents a single long token from overflowing.
          <span style={{ flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", lineHeight: 1.35 }}>
            {address}
          </span>
        ) : (
          <span style={{ flex: 1, height: 0, borderBottom: "1px solid #000" }} />
        )}
      </div>
      {/* ── ROW 4: Special Instructions | Open Parcel Allowed ── */}
      <div
        style={{
          ...B(["r", "b"]),
          gridColumn: "1 / 4",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          fontSize: "13px",
          overflow: "hidden",
        }}
      >
        <b>Special Instructions:</b>
        {notes ? (
          <span style={{ whiteSpace: "pre-wrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {notes}
          </span>
        ) : (
          <span style={{ flex: 1, height: 0, borderBottom: "1px solid #000" }} />
        )}
      </div>
      {/* Single spanning cell for all three checkboxes (rows 3–4, column 4):
          `distribute` gives Exchange / Open Parcel Allowed / Fragile identical
          vertical spacing, and border={["b"]} keeps only the closing line. */}
      <CheckboxCell
        items={[
          { label: "Exchange", checked: !!order.hasExchange },
          { label: "Open Parcel Allowed", checked: !!order.openParcelAllowed },
          { label: "Fragile", checked: !!order.isFragile },
        ]}
        colStart={4}
        colSpan={1}
        rowStart={3}
        rowSpan={2}
        distribute
      />

      {/* ── ROW 5: Arabic declaration + Signature (single full-width cell) ── */}
      <div
        style={{
          gridColumn: "1 / 5",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "0 6px",
          overflow: "hidden",
        }}
      >
        <span dir="rtl" lang="ar" style={{ fontSize: "12px", whiteSpace: "nowrap", lineHeight: 1.2 }}>
          يؤكد المرسل أن هذا الطرد لا يحتوي على أية مواد محظورة أو ممنوعة قانوناً.
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 1 auto", minWidth: 0 }}>
          <b style={{ fontSize: "13px", flexShrink: 0 }}>Signature:</b>
          <span style={{ flex: 1, minWidth: "1.2in", height: 0, borderBottom: "1px solid #000" }} />
        </span>
      </div>
      </div>
      {/* ── Footer: print date/time (Beirut time) in the white band below the frame ── */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "0.09in",
          textAlign: "center",
          fontSize: "8px",
          letterSpacing: "0.2px",
          color: "#000",
        }}
      >
        Printed: {printedAt}
      </div>
    </div>
  );
}

// ─── Print page ───────────────────────────────────────────────────────────────
// Two paper modes, selected via the ?paper= URL parameter:
//   label (default) — one 6×4in thermal sticker per waybill (unchanged behaviour)
//   a5              — waybills uniformly scaled down, exactly 2 per A5 portrait
//                     sheet, minimal gap (for merchants printing on A5 paper)
// Everything is layout-only: the WaybillCard markup is identical in both modes,
// so the waybill design itself never changes.
const A5_PAPER = {
  pageWidthIn: 5.83,
  pageHeightIn: 8.27,
  // The print dialog must use Margins: None (the on-screen hint says so) —
  // Chrome's "Default" margins eat ~0.4in per side and cap the usable width.
  // With Margins: None the whole sheet is usable, so @page margin is 0.
  pageMarginIn: 0,
  // Small separator between the two waybills on one sheet.
  gapIn: 0.2,
  // Uniform scale applied to the 6×4 card, filling the sheet like the
  // merchant's reference photo: width constraint 5.83 / 6 = 0.972 max; 0.9
  // prints each waybill 5.4in wide (≈93% of the sheet, a 0.215in side band —
  // outside a laser jet's ~0.2in non-printable edge). Height:
  // 2 × 3.6 + 0.2 gap = 7.4in ≤ 8.27in sheet. If the dialog keeps the
  // "Default" margins instead, Chrome just scales the page down a few percent
  // — still one pair per sheet, only slightly smaller.
  scale: 0.9,
  contentWidthIn: 6 * 0.9, // 5.4in
  contentHeightIn: 4 * 0.9, // 3.6in
} as const;

export default function PrintPage() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Paper mode is URL-driven so the print page stays a plain link target for
  // every existing caller (they simply get the default label mode).
  const paper = searchParams.get("paper") === "a5" ? "a5" : "label";

  // Computed once per render so every waybill in the batch shares the same
  // print timestamp (the cards only render after the client-side fetch).
  const printedAt = formatPrintTimestamp();

  // Switch paper mode: rewrite ?paper= in place. `auto` is replaced by an
  // explicit `print=1` flag so the print dialog re-opens for the new layout
  // (in either direction) without looping; `pdf` is kept so the PDF export
  // follows the selected paper.
  const switchPaper = (mode: "label" | "a5") => {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "a5") {
      params.set("paper", "a5");
    } else {
      params.delete("paper");
    }
    params.delete("auto");
    params.set("print", "1");
    window.location.search = params.toString();
  };

  useEffect(() => {
    const idsParam = searchParams.get("ids");

    if (!idsParam) {
      // Guard: no IDs selected — resolve the loading state synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    const ids = idsParam.split(",").filter(Boolean);

    // Ask the API for exactly the selected order IDs (?ids=…) instead of
    // downloading the entire order table and filtering client-side. The GET
    // handler includes the `merchant` relation (merchantName + logoUrl) plus
    // `notes`, `packages` and `hasExchange`, so each card renders fully.
    // Normalize both the legacy array format and the current { data, meta }
    // response shape returned by GET /api/orders.
    fetch(`/api/orders?ids=${encodeURIComponent(ids.join(","))}`)
      .then((res) => res.json())
      .then((result) => {
        const filtered: Order[] = Array.isArray(result)
          ? result
          : (result.data ?? []);
        setOrders(filtered);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [searchParams]);

  // ── Auto-handle: browser print (triggered by "Save & Print" in order entry) ──
  // Also re-opens the print dialog after the paper selector changes mode
  // (`print=1` is set by the switch handler), so the merchant sees the new
  // layout immediately.
  useEffect(() => {
    if (orders.length === 0) return;
    const shouldPrint =
      searchParams.get("auto") === "true" || searchParams.get("print") === "1";
    if (!shouldPrint) return;
    // Delay briefly so the QR data-URL <img>s finish rendering before the
    // print dialog opens.
    const timer = setTimeout(() => window.print(), 800);
    return () => clearTimeout(timer);
  }, [orders, searchParams]);

  // ── Auto-handle: PDF generation ──
  // label mode: one 6×4in landscape page per waybill (unchanged).
  // a5 mode: one A5 portrait page per pair, two scaled waybills per page,
  // matching the browser print layout.
  useEffect(() => {
    if (orders.length > 0 && searchParams.get("pdf") === "true") {
      import("html2pdf.js").then(async (html2pdf) => {
        const element = document.getElementById("print-container");
        if (!element) return;

        // Grab the exact waybill cards (skip the on-screen spacing/toolbar).
        const cards = Array.from(
          element.querySelectorAll<HTMLElement>(".waybill-label"),
        );
        if (cards.length === 0) return;

        // The html2pdf.js bundle is CJS — the callable factory is exposed on
        // the `default` property of the dynamic-import module namespace.
        const jsPDF = (await import("jspdf")).jsPDF;
        const isA5 = paper === "a5";
        const doc = new jsPDF({
          orientation: isA5 ? "portrait" : "landscape",
          unit: "in",
          format: isA5 ? "a5" : [6, 4],
          compress: true,
        });

        // A5 placement: mirrors the @page CSS above — page margins, the first
        // card at the top, the gap, then the second card.
        const imgW = isA5 ? A5_PAPER.contentWidthIn : 6;
        const imgH = isA5 ? A5_PAPER.contentHeightIn : 4;
        const marginX = isA5
          ? (A5_PAPER.pageWidthIn - imgW) / 2
          : 0;
        const rowY = isA5
          ? [
              A5_PAPER.pageMarginIn,
              A5_PAPER.pageMarginIn + imgH + A5_PAPER.gapIn,
            ]
          : [0, 0];

        for (let i = 0; i < cards.length; i++) {
          // toCanvas() resolves to the rendered <canvas> at runtime; the
          // library types it as the worker chain, hence the cast.
          const canvas = (await html2pdf.default()
            .set({
              margin: 0,
              image: { type: "jpeg" },
              html2canvas: {
                scale: 2,
                useCORS: true,
                backgroundColor: "#ffffff",
                logging: false,
              },
            })
            .from(cards[i])
            .toCanvas()) as unknown as HTMLCanvasElement;

          const imgData = canvas.toDataURL("image/jpeg", 0.95);
          if (isA5) {
            const slot = i % 2;
            if (i > 0 && slot === 0) doc.addPage("a5", "portrait");
            doc.addImage(imgData, "JPEG", marginX, rowY[slot], imgW, imgH);
          } else {
            if (i > 0) doc.addPage([6, 4], "landscape");
            doc.addImage(imgData, "JPEG", 0, 0, 6, 4);
          }
        }

        doc.save("Waybills.pdf");
        window.close();
      }).catch((err) => {
        console.error("[orders/print] PDF generation failed:", err);
      });
    }
  }, [orders, searchParams, paper]);

  if (loading) {
    return <div className="bg-white text-black p-8">Loading orders...</div>;
  }

  if (orders.length === 0) {
    return <div className="bg-white text-black p-8">No orders selected.</div>;
  }

  // Screen container width mirrors the paper so the preview matches the print.
  const containerWidth =
    paper === "a5" ? `${A5_PAPER.pageWidthIn}in` : "6in";

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* ── Label mode: 6×4 inch thermal label — exact page size, no browser margins. ── */
        @page { size: 6in 4in; margin: 0; }
        .print-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; font-size: 14px; }
        .print-toolbar button { padding: 6px 14px; border: 1px solid #000; background: #fff; cursor: pointer; border-radius: 6px; }
        .print-toolbar button.active { background: #000; color: #fff; }

        @media print {
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 6in;
            height: auto;
          }
          body * { visibility: hidden; }
          #print-container, #print-container * { visibility: visible; }
          #print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 6in;
          }
          /* Toolbar is screen-only in every mode. */
          .no-print { display: none !important; }
          .waybill-label {
            width: 6in !important;
            height: 4in !important;
            margin: 0 !important;
            box-shadow: none !important;
            page-break-after: always;
            page-break-inside: avoid;
          }
          .waybill-label:last-child { page-break-after: auto; }
        }
      `,
        }}
      />
      {paper === "a5" && (
        <style
          dangerouslySetInnerHTML={{
            __html: `
        /* ── A5 mode: exactly 2 scaled waybills per A5 portrait sheet. ──
           Each .waybill-label is a fixed-size box (contentWidth × contentHeight)
           with the unmodified 6×4 card scaled down inside it, so the design is
           identical to label mode — just smaller and packed tightly. */
        @page { size: A5 portrait; margin: ${A5_PAPER.pageMarginIn}in; }

        @media print {
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            width: ${A5_PAPER.pageWidthIn}in;
            height: auto;
          }
          body * { visibility: hidden; }
          #print-container, #print-container * { visibility: visible; }
          #print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: ${A5_PAPER.pageWidthIn}in;
            /* Drop the on-screen preview padding so the pair is positioned
               exactly by the @page margins above. */
            padding: 0 !important;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .no-print { display: none !important; }
          .waybill-label {
            position: relative;
            width: ${A5_PAPER.contentWidthIn}in !important;
            height: ${A5_PAPER.contentHeightIn}in !important;
            margin: 0 0 ${A5_PAPER.gapIn}in !important;
            box-shadow: none !important;
            page-break-inside: avoid;
            overflow: hidden;
            /* Undo the label-mode rule that forces a break after EVERY
               waybill — in A5 mode pairs must share one sheet. */
            page-break-after: auto !important;
            break-after: auto !important;
          }
          /* Deterministic 2-per-sheet pagination: the card handler tags the
             second card of each pair with .pair-end, so exactly two waybills
             land on every sheet no matter which margins the printer applies. */
          .waybill-label.pair-end {
            page-break-after: always !important;
            break-after: page !important;
          }
          /* Don't emit a trailing blank sheet when the batch ends on a pair. */
          .waybill-label.pair-end:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          /* Tighten the card's decorative white sticker bands for A5 paper:
             the bordered frame starts 0.12in from the top instead of 0.305in.
             The "Printed:" footer is absolutely positioned against the card's
             bottom edge, so it stays below the frame in either mode. Label
             mode keeps the original sticker bands untouched. */
          .waybill-label .waybill-card {
            padding: 0.12in 0.115in 0.16in !important;
          }
        }
      `,
          }}
        />
      )}
      <div
        id="print-container"
        className="bg-white text-black"
        style={{
          width: containerWidth,
          margin: "0 auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        <div className="print-toolbar no-print">
          <span>Paper:</span>
          <button
            type="button"
            className={paper === "label" ? "active" : ""}
            onClick={() => switchPaper("label")}
          >
            6×4 label
          </button>
          <button
            type="button"
            className={paper === "a5" ? "active" : ""}
            onClick={() => switchPaper("a5")}
          >
            A5 (2 per page)
          </button>
          {paper === "a5" && (
            // The page already packs two waybills per sheet and uses the full
            // sheet, so the dialog settings matter — tell the merchant exactly
            // what to pick.
            <span style={{ color: "#666" }}>
              In the print dialog, set: Paper&nbsp;size = <b>A5</b> ·
              Pages&nbsp;per&nbsp;sheet = <b>1</b> · Margins = <b>None</b> ·
              Scale = <b>100%</b> — this page already puts 2 waybills on every
              A5 sheet and sizes them to fill it.
            </span>
          )}
        </div>
        {orders.map((o, i) => (
          <div
            key={o.id}
            // .pair-end marks the second card of each A5 pair (see the print
            // CSS above) — label mode never uses the class.
            className={`waybill-label${paper === "a5" && i % 2 === 1 ? " pair-end" : ""}`}
            style={
              paper === "a5"
                ? {
                    // Fixed box; the unscaled 6×4 card sits inside it, scaled
                    // from the top-left corner. Inline styles (not print CSS)
                    // so the on-screen preview matches the printed sheet too.
                    position: "relative",
                    width: `${A5_PAPER.contentWidthIn}in`,
                    height: `${A5_PAPER.contentHeightIn}in`,
                    overflow: "hidden",
                    marginBottom: `${A5_PAPER.gapIn}in`,
                    boxShadow: "none",
                  }
                : { marginBottom: "16px", boxShadow: "0 2px 10px rgba(0,0,0,0.35)" }
            }
          >
            <div
              style={
                paper === "a5"
                  ? {
                      transform: `scale(${A5_PAPER.scale})`,
                      transformOrigin: "top left",
                    }
                  : undefined
              }
            >
              <WaybillCard order={o} printedAt={printedAt} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
