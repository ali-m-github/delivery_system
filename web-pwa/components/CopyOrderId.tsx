"use client";

import { useState } from "react";

// Clickable order-ID chip: copies the ID to the clipboard so merchants can
// paste it straight into their own systems or sheets. Shows transient
// "Copied ✓" feedback after a successful copy.
export default function CopyOrderId({
  orderId,
  className = "",
  variant = "link",
}: {
  orderId: string;
  className?: string;
  // "link" (default): plain underlined chip. "field": styled like a disabled
  // form input, for the auto-generated Order ID preview in the Order Entry form.
  variant?: "link" | "field";
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(orderId);
      } else {
        // Fallback for non-secure contexts / older browsers.
        const ta = document.createElement("textarea");
        ta.value = orderId;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — silently ignore.
    }
  };

  if (variant === "field") {
    return (
      <button
        type="button"
        onClick={handleCopy}
        title="Automatically generated — click to copy to clipboard"
        className={`group inline-flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded bg-slate-950/60 border border-gray-800 font-mono text-cyan-400 hover:border-cyan-500/50 transition-colors ${className}`}
      >
        {orderId}
        <span
          className={`text-[10px] font-sans ${
            copied
              ? "text-green-400"
              : "text-gray-500 group-hover:text-cyan-400"
          }`}
        >
          {copied ? "Copied ✓" : "📋"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy Order ID to clipboard"
      className={`group inline-flex items-center gap-1.5 font-mono text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/40 decoration-dashed underline-offset-4 transition-colors ${className}`}
    >
      {orderId}
      <span
        className={`text-[10px] font-sans ${
          copied
            ? "text-green-400"
            : "text-gray-500 group-hover:text-cyan-400"
        }`}
      >
        {copied ? "Copied ✓" : "📋"}
      </span>
    </button>
  );
}
