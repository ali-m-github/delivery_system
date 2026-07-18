"use client";

import { useEffect } from "react";

export function PrintTrigger() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Renders nothing — just triggers the browser print dialog
  return null;
}
