"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface User {
  id: string;
  username: string;
  role: string;
  permissions: string;
}

export default function RouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "allowed" | "redirecting">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Public tracking page — skip auth entirely
      if (pathname.startsWith("/track")) {
        if (!cancelled) setStatus("allowed");
        return;
      }

      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          // unauthenticated — allow through (login/signup pages handle their own logic)
          if (!cancelled) setStatus("allowed");
          return;
        }

        const user: User = await res.json();

        if (!cancelled) {
          // DRIVER guard: must be on /driver or /track
          if (
            user?.role === "DRIVER" &&
            !pathname.startsWith("/driver") &&
            !pathname.startsWith("/track")
          ) {
            setStatus("redirecting");
            router.replace("/driver");
            return;
          }

          // MERCHANT guard: must only access /merchant
          if (user?.role === "MERCHANT" && !pathname.startsWith("/merchant")) {
            setStatus("redirecting");
            router.replace("/merchant");
            return;
          }

          // Non-MERCHANT users trying to access /merchant → login
          if (user?.role !== "MERCHANT" && pathname.startsWith("/merchant")) {
            setStatus("redirecting");
            router.replace("/login");
            return;
          }

          // ADMIN guard: /login → /orders
          if (user?.role === "ADMIN" && pathname.startsWith("/login")) {
            setStatus("redirecting");
            router.replace("/orders");
            return;
          }

          setStatus("allowed");
        }
      } catch {
        // network error — allow through to avoid blocking the user entirely
        if (!cancelled) setStatus("allowed");
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-[#0B0F17]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      </div>
    );
  }

  // "redirecting" also returns null — prevents flash of the restricted page
  if (status === "redirecting") {
    return null;
  }

  return <>{children}</>;
}
