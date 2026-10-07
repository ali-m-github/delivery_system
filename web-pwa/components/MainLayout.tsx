"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import RouteGuard from "./RouteGuard";
import ThemeToggle from "./ThemeToggle";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isTrackPage = pathname.startsWith("/track");
  const isPrintPage = pathname.startsWith("/print");
  // Pages that render without the sidebar still need a theme switcher
  const needsFloatingToggle =
    isTrackPage ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/driver");

  return (
    <>
      {!isTrackPage && !isPrintPage && <Sidebar />}
      {needsFloatingToggle && <ThemeToggle variant="floating" />}
      <main
        className={
          isTrackPage || isPrintPage
            ? "flex-1 print:m-0 print:p-0 print:w-full print:max-w-none"
            : "flex-1 overflow-y-auto min-w-0 print:m-0 print:p-0 print:w-full print:max-w-none"
        }
      >
        <RouteGuard>{children}</RouteGuard>
      </main>
    </>
  );
}
