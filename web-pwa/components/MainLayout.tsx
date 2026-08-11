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
            ? "flex-1 print:m-0 print:p-0 print:w-full print:max-w-none"
            : "flex-1 overflow-y-auto min-w-0 print:m-0 print:p-0 print:w-full print:max-w-none"
        }
      >
        <RouteGuard>{children}</RouteGuard>
      </main>
    </>
  );
}
