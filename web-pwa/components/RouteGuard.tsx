"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { hasPermission } from "@/lib/permissions";

interface User {
  id: string;
  username: string;
  role: string;
  permissions: string[];
  permissionGroup?: { id: string; name: string; permissions: string[] } | null;
  customPermissions?: string[];
}

// ─── Route → Required Permission Map ──────────────────────────────────────────
// Prefix-based page-level RBAC. The most specific (longest) matching prefix wins,
// e.g. "/admin/drivers/..." resolves to MANAGE_DRIVERS, not MANAGE_USERS.
const ROUTE_PERMISSIONS: { prefix: string; permission: string }[] = [
  { prefix: "/admin/drivers", permission: "MANAGE_DRIVERS" },
  { prefix: "/admin", permission: "MANAGE_USERS" },
  { prefix: "/merchants", permission: "MANAGE_MERCHANTS" },
];

function requiredPermissionForPath(pathname: string): string | null {
  const matches = ROUTE_PERMISSIONS.filter((r) =>
    pathname.startsWith(r.prefix),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.prefix.length - a.prefix.length);
  return matches[0].permission;
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

          // Merchant portal = the SINGULAR /merchant route only. It must NOT use
          // startsWith("/merchant") because that also matches the ADMIN /merchants
          // management list (prefix collision), which bounced an ADMIN viewing the
          // merchants list to /login and then /orders — the reported redirect loop.
          const isMerchantPortal =
            pathname === "/merchant" || pathname.startsWith("/merchant/");

          // MERCHANT guard: must only access the /merchant portal, except the
          // waybill print page (/orders/print) and the merchant invoice print
          // pages (/print/merchant/...) which merchants use to print waybills
          // and payout/statement invoices.
          const isWaybillPrint = pathname.startsWith("/orders/print");
          const isMerchantInvoicePrint = pathname.startsWith("/print/merchant");
          if (
            user?.role === "MERCHANT" &&
            !isMerchantPortal &&
            !isWaybillPrint &&
            !isMerchantInvoicePrint
          ) {
            setStatus("redirecting");
            router.replace("/merchant");
            return;
          }

          // Non-MERCHANT users trying to access the /merchant portal → login
          if (user?.role !== "MERCHANT" && isMerchantPortal) {
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

          // ── Granular RBAC: page-level permission enforcement ──
          // ADMINS bypass the permission map; everyone else must hold the
          // required permission (via PermissionGroup or custom overrides).
          const required = requiredPermissionForPath(pathname);
          if (
            required &&
            user?.role !== "ADMIN" &&
            !hasPermission(user, required)
          ) {
            setStatus("redirecting");
            router.replace("/403");
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
