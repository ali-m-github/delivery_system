"use client";

// Client component that owns all interactive print behavior.
// Must stay a Client Component — event handlers (onClick) cannot be
// passed to client components from the async Server Component page.
export function PrintControls() {
  return (
    <div className="no-print">
      <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
    </div>
  );
}
