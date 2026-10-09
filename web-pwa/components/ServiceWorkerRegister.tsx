"use client";

import { useEffect } from "react";

// Registers the PWA service worker once per session. Registration is
// intentionally silent on failure so a broken SW never blocks the app.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // Ignore registration failures (e.g. private-mode restrictions).
      });
  }, []);

  return null;
}
