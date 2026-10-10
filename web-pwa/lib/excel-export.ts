// ─── Shared Excel export helpers ─────────────────────────────────────────────
// Centralises the two behaviours every Excel download in this app should have:
// 1. All cells centered with thin borders and a bold header row.
// 2. No green "Number Stored as Text" warning triangles (Excel shows them on
//    phone numbers and other numeric-looking strings). exceljs 4.4.0 has no
//    native support for <ignoredErrors>, so we post-process the generated
//    XLSX package and inject the element into each worksheet XML.

import type { Workbook, Worksheet } from "exceljs";

const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
};

/**
 * Apply centering + thin borders to every cell and bold the header row.
 * Safe to call after all rows have been added.
 */
export function styleWorksheet(worksheet: Worksheet) {
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { ...THIN_BORDER.top },
        left: { ...THIN_BORDER.left },
        bottom: { ...THIN_BORDER.bottom },
        right: { ...THIN_BORDER.right },
      };
      if (rowNumber === 1) cell.font = { bold: true };
    });
  });
}

/**
 * Re-zip the workbook output with an <ignoredErrors numberStoredAsText="1"/>
 * element per worksheet, so Excel stops flagging numeric-looking text
 * (phone numbers, order IDs) with green corner triangles.
 */
async function suppressNumberStoredAsText(
  buffer: ArrayBuffer | Uint8Array,
): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(new Uint8Array(buffer));

  const sheetNames = Object.keys(zip.files).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );

  for (const name of sheetNames) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async("string");
    if (xml.includes("<ignoredErrors")) continue;

    // exceljs always writes a <dimension ref="A1:D100"/> for populated sheets;
    // reuse it as the sqref range for the ignored-errors declaration.
    const dimMatch = xml.match(/<dimension ref="([A-Z]+\d+:[A-Z]+\d+)"/);
    if (!dimMatch) continue;

    const ignored = `<ignoredErrors><ignoredError sqref="${dimMatch[1]}" numberStoredAsText="1"/></ignoredErrors>`;
    xml = xml.replace("</worksheet>", `${ignored}</worksheet>`);
    zip.file(name, xml);
  }

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/**
 * Serialize a workbook to an XLSX ArrayBuffer with the green-triangle
 * suppression applied. Prefer downloadWorkbook() unless you need the raw bytes.
 */
export async function writeWorkbookBuffer(
  workbook: Workbook,
): Promise<ArrayBuffer> {
  const raw = await workbook.xlsx.writeBuffer();
  return suppressNumberStoredAsText(raw as unknown as ArrayBuffer);
}

/**
 * Build the XLSX, suppress the "Number Stored as Text" warnings, and trigger
 * a browser download with the given filename.
 */
export async function downloadWorkbook(
  workbook: Workbook,
  filename: string,
): Promise<void> {
  const buffer = await writeWorkbookBuffer(workbook);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
