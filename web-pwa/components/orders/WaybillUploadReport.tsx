"use client";

// ─── Waybill upload result report ────────────────────────────────────────────
//
// The waybill endpoint returns a per-file verdict; a batch of hundreds of
// photos always contains some that cannot be matched. Previously the UI showed
// a single `alert()` with a flat list of strings, which was unreadable at
// scale and hid the actually-useful part: WHAT the OCR read.
//
// This modal groups failures by machine-readable reason (supplied by the API as
// `code`) and shows the order identifiers it extracted, so an operator can
// tell apart "bad photo", "unreadable photo", "wrong order number printed" and
// "engine error" — each of which has a different fix.

/** One file's outcome, mirroring the API's `WaybillResult`. */
export interface WaybillFileResult {
  fileName: string;
  success: boolean;
  orderId?: string;
  waybillUrl?: string;
  method?: string;
  error?: string;
  code?: string;
  candidates?: string[];
  attempts?: number;
  elapsedMs?: number;
}

interface WaybillUploadReportProps {
  results: WaybillFileResult[];
  /** Files the client could not even get a verdict for (network/HTTP errors). */
  clientErrors?: { fileName: string; reason: string }[];
  onClose: () => void;
}

/** Human labels + the operator-facing fix for each failure code. */
const FAILURE_META: Record<string, { label: string; hint: string }> = {
  no_text: {
    label: "No readable text",
    hint: "Re-shoot: fill the frame with the label, focus on the number, avoid glare.",
  },
  no_digits: {
    label: "Text read, no order number",
    hint: "The photo may not show the order number, or it is printed with separators.",
  },
  not_in_db: {
    label: "Number not found in the database",
    hint: "The order does not exist yet, or the printed number was misread.",
  },
  ocr_error: {
    label: "OCR engine error",
    hint: "Server-side engine failure — retry the file, or check the server logs.",
  },
  fallback_error: {
    label: "OCR + OCR.space fallback both failed",
    hint: "Local OCR failed and the external fallback errored too.",
  },
  fallback_rate_limited: {
    label: "OCR.space quota exhausted",
    hint: "The free tier allows 180 requests/hour. Re-upload these files later, or upgrade the OCR.space plan.",
  },
  invalid_file: {
    label: "Unsupported or oversized file",
    hint: "JPEG, PNG or WebP up to 10 MB only.",
  },
  request_failed: {
    label: "Upload request failed",
    hint: "Network drop, expired session, or the server rejected the request.",
  },
  unknown: {
    label: "Unknown error",
    hint: "No reason was returned for this file.",
  },
};

function metaFor(code?: string) {
  return FAILURE_META[code ?? "unknown"] ?? FAILURE_META.unknown;
}

export default function WaybillUploadReport({
  results,
  clientErrors = [],
  onClose,
}: WaybillUploadReportProps) {
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const total = results.length + clientErrors.length;

  // Group failures by reason so a 700-file batch reads as a handful of lines.
  const groups = new Map<string, (WaybillFileResult | { fileName: string; error: string; code: string })[]>();
  for (const r of failed) {
    const key = r.code ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const e of clientErrors) {
    const key = "request_failed";
    groups.set(key, [...(groups.get(key) ?? []), { fileName: e.fileName, error: e.reason, code: key }]);
  }

  const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);

  const reportText = [
    `Waybill upload report — ${succeeded.length}/${total} matched`,
    "",
    ...sortedGroups.flatMap(([code, items]) => [
      `${metaFor(code).label} (${items.length}):`,
      ...items.map((i) => {
        const cands = "candidates" in i && i.candidates?.length ? ` | read: ${i.candidates.join(", ")}` : "";
        return `  - ${i.fileName}${i.error ? `: ${i.error}` : ""}${cands}`;
      }),
      "",
    ]),
  ].join("\n");

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
    } catch {
      // Clipboard can be unavailable in non-secure contexts; not worth failing the modal.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close report"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white mb-1">Waybill Upload Report</h2>
          <p className="text-xs text-gray-400">
            {total} file{total === 1 ? "" : "s"} processed ·{" "}
            <span className="text-green-400 font-semibold">{succeeded.length} matched</span>
            {failed.length + clientErrors.length > 0 && (
              <>
                {" · "}
                <span className="text-red-400 font-semibold">
                  {failed.length + clientErrors.length} not matched
                </span>
              </>
            )}
          </p>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {sortedGroups.length === 0 && (
            <div className="text-sm text-green-300 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3">
              Every waybill was matched to an order.
            </div>
          )}

          {sortedGroups.map(([code, items]) => {
            const meta = metaFor(code);
            return (
              <section key={code}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <h3 className="text-sm font-bold text-red-300">
                    {meta.label}{" "}
                    <span className="text-gray-500 font-normal">({items.length})</span>
                  </h3>
                </div>
                <p className="text-[11px] text-gray-500 mb-2">{meta.hint}</p>

                <div className="border border-white/10 rounded-lg overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-white/5">
                      <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                        <th className="px-3 py-2 font-semibold">File</th>
                        <th className="px-3 py-2 font-semibold">Why it failed</th>
                        <th className="px-3 py-2 font-semibold text-right">Attempts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {items.map((item, idx) => {
                        const cands =
                          "candidates" in item && item.candidates?.length
                            ? item.candidates
                            : [];
                        return (
                          <tr key={`${item.fileName}-${idx}`} className="align-top">
                            <td className="px-3 py-2 text-[11px] text-gray-300 font-mono break-all max-w-[16rem]">
                              {item.fileName}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-gray-400">
                              {item.error ?? "No reason returned"}
                              {cands.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {cands.map((c) => (
                                    <span
                                      key={c}
                                      className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[10px]"
                                    >
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-gray-500 font-mono text-right whitespace-nowrap">
                              {"attempts" in item && item.attempts !== undefined
                                ? `${item.attempts}${item.elapsedMs !== undefined ? ` · ${(item.elapsedMs / 1000).toFixed(1)}s` : ""}`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          {/* Matched list, collapsed to a summary — the operator does not need
              700 rows of filenames to confirm the batch worked. */}
          {succeeded.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-green-300 mb-2">
                Matched ({succeeded.length})
              </h3>
              <details className="border border-white/10 rounded-lg">
                <summary className="px-3 py-2 text-[11px] text-gray-400 cursor-pointer select-none">
                  Show matched files
                </summary>
                <ul className="px-3 py-2 space-y-1 max-h-64 overflow-y-auto">
                  {succeeded.map((r, idx) => (
                    <li
                      key={`${r.fileName}-${idx}`}
                      className="text-[11px] text-gray-400 font-mono flex justify-between gap-3"
                    >
                      <span className="break-all">{r.fileName}</span>
                      <span className="text-green-400 whitespace-nowrap">
                        {r.orderId}
                        {r.method ? ` · ${r.method}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex gap-3">
          <button
            type="button"
            onClick={copyReport}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 transition-all duration-200"
          >
            Copy report
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-all duration-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
