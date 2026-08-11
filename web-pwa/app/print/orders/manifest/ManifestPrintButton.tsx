"use client";

// Client component that owns the interactive print behavior for the RTS
// Manifest page. Must stay a Client Component — event handlers (onClick)
// cannot be passed to client components from the async Server Component page.
export function ManifestPrintButton() {
  return (
    <div className="no-print text-center mb-4">
      <button
        onClick={() => window.print()}
        className="px-6 py-2.5 text-sm font-bold bg-blue-700 text-white rounded-md shadow hover:bg-blue-800"
      >
        🖨 Print / Save as PDF
      </button>
    </div>
  );
}
