"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import RouteGuard from "./RouteGuard";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isTrackPage = pathname.startsWith("/track");
  const isPrintPage = pathname.startsWith("/print");

  return (
    <>
      {!isTrackPage && !isPrintPage && <Sidebar />}
      <main
        className={
          isTrackPage || isPrintPage
            ? "flex-1"
            : "flex-1 overflow-y-auto min-w-0"
        }
      >
        <RouteGuard>{children}</RouteGuard>
      </main>
    </>
  );
}
