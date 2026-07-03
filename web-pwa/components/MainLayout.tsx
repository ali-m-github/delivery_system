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

  return (
    <>
      {!isTrackPage && <Sidebar />}
      <main
        className={isTrackPage ? "flex-1" : "flex-1 overflow-y-auto min-w-0"}
      >
        <RouteGuard>{children}</RouteGuard>
      </main>
    </>
  );
}
