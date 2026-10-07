"use client";

import { useCallback, useEffect, useState } from "react";

const THEME_STORAGE_KEY = "jet-theme";

function applyTheme(isLight: boolean) {
  const root = document.documentElement;
  if (isLight) {
    root.classList.add("light");
  } else {
    root.classList.remove("light");
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, isLight ? "light" : "dark");
  } catch {
    // localStorage unavailable (private mode, etc.) — theme still applies for this session
  }
}

const SunIcon = () => (
  <svg
    className="w-4 h-4 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
    />
  </svg>
);

const MoonIcon = () => (
  <svg
    className="w-4 h-4 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
    />
  </svg>
);

export default function ThemeToggle({
  variant = "sidebar",
  isCollapsed = false,
}: {
  variant?: "sidebar" | "floating";
  isCollapsed?: boolean;
}) {
  const [isLight, setIsLight] = useState(false);

  // Sync with whatever the pre-hydration theme script applied to <html>
  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  const handleToggle = useCallback(() => {
    setIsLight((prev) => {
      const next = !prev;
      applyTheme(next);
      return next;
    });
  }, []);

  if (variant === "floating") {
    return (
      <button
        onClick={handleToggle}
        title={isLight ? "Switch to dark mode" : "Switch to light mode"}
        aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
        className="
          fixed top-4 right-4 z-50 flex items-center justify-center
          w-10 h-10 rounded-full
          bg-white/5 border border-white/10 text-gray-400
          hover:text-white hover:bg-white/10 hover:border-white/20
          focus:outline-none focus:ring-2 focus:ring-cyan-500/40
          transition-all duration-200 print:hidden
        "
      >
        {isLight ? <MoonIcon /> : <SunIcon />}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      className={`
        w-full flex items-center rounded-lg text-sm font-medium mb-1.5
        text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10
        transition-all duration-200
        ${isCollapsed ? "justify-center p-2" : "gap-2 px-3 py-2"}
      `}
      title={isCollapsed ? (isLight ? "Dark mode" : "Light mode") : undefined}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? <MoonIcon /> : <SunIcon />}
      {!isCollapsed && (isLight ? "Light mode" : "Dark mode")}
    </button>
  );
}
