"use client";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import SettingsModal from "./SettingsModal";
import ThemeToggle from "./ThemeToggle";
import { hasPermission } from "@/lib/permissions";

// ─── Types ────────────────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  /** Granular RBAC: if set, the link only renders when the user holds this
   *  permission (via their PermissionGroup or custom overrides). */
  permission?: string;
}

// ─── SVG Icon Components ──────────────────────────────────────────────────────
const DashboardIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"
    />
  </svg>
);

const OrdersIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
    />
  </svg>
);

const SellersIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
    />
  </svg>
);

const DriversIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

const SettlementsIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const ClearedPayoutsIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const StatisticsIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    {/* lucide "bar-chart-3" */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"
    />
  </svg>
);

const AdminIcon = () => (
  <svg
    className="w-5 h-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

// ─── Nav Items Definition ─────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <DashboardIcon /> },
  { label: "Orders", href: "/orders", icon: <OrdersIcon /> },
  { label: "Merchants", href: "/merchants", icon: <SellersIcon /> },
  { label: "Drivers", href: "/drivers", icon: <DriversIcon /> },
  {
    label: "Driver Consignments",
    href: "/settlements",
    icon: <SettlementsIcon />,
  },
  {
    label: "Cleared Payouts",
    href: "/cleared-payouts",
    icon: <ClearedPayoutsIcon />,
  },
  { label: "Statements", href: "/statements", icon: <OrdersIcon /> },
  {
    label: "Statistics",
    href: "/statistics",
    icon: <StatisticsIcon />,
    permission: "VIEW_STATISTICS",
  },
  {
    label: "Treasury",
    href: "/admin/treasury",
    icon: <SettlementsIcon />,
    adminOnly: true,
    permission: "PAGE_ADMIN_TREASURY",
  },
  { label: "Zones", href: "/zones", icon: <AdminIcon />, adminOnly: true },
  {
    label: "Admin Panel",
    href: "/admin",
    icon: <AdminIcon />,
    adminOnly: true,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{
    id: string;
    username: string;
    role: string;
    permissions: string[];
    permissionGroup?: {
      id: string;
      name: string;
      permissions: string[];
    } | null;
    customPermissions?: string[];
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const authFetchedRef = useRef(false);
  const [payoutCounts, setPayoutCounts] = useState({
    pendingSettlements: 0,
    pendingClearance: 0,
  });

  // ── Fetch auth state once on mount ──
  useEffect(() => {
    if (authFetchedRef.current) return;
    authFetchedRef.current = true;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          setUser(null);
          setAuthLoading(false);
          return;
        }
        const data = await res.json();
        setUser(data);
        setAuthLoading(false);
      })
      .catch(() => {
        setUser(null);
        setAuthLoading(false);
      });
  }, []);

  // ── Fetch payout notification counts (badges) on mount + route change ──
  // Route Handlers aren't cached, so navigating back after settling/clearing a
  // payout always refreshes the badge numbers.
  useEffect(() => {
    fetch("/api/notifications/payouts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setPayoutCounts({
            pendingSettlements: Number(data.pendingSettlements) || 0,
            pendingClearance: Number(data.pendingClearance) || 0,
          });
        }
      })
      .catch(() => {
        // Keep existing counts on network failure — badges simply stay as-is.
      });
  }, [pathname]);

  // ── Close the mobile drawer whenever the route changes ──
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ── Keyboard shortcut: Ctrl+B to toggle collapse ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setIsCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Logout handler ──
  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }, [router]);

  // ── Strict pathname bypass for auth pages ──
  if (pathname === "/login" || pathname === "/signup") {
    return null;
  }

  if (authLoading) {
    return null;
  }

  if (!user) {
    return null;
  }

  // RBAC: Drivers get a full-width PWA — no admin sidebar
  if (user?.role === "DRIVER") {
    return null;
  }

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  // ── Sidebar content ──
  // isMobile forces the full-width (expanded) layout inside the mobile drawer,
  // independent of the desktop collapse state.
  const renderSidebarContent = (isMobile = false) => (
    <aside
      className={`
        h-full flex flex-col
        bg-[#0B0F17] border-r border-white/5
        transition-all duration-300 ease-in-out
        ${isMobile || !isCollapsed ? "w-64" : "w-16"}
      `}
    >
      {/* ── Logo / Brand ── */}
      <div
        className={`flex items-center h-16 border-b border-white/10 shrink-0 ${isCollapsed ? "justify-center px-2" : "gap-3 px-5"}`}
      >
        <span className="text-xl text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.7)] shrink-0">
          ◈
        </span>
        {!isCollapsed && (
          <span className="text-base font-bold tracking-wide bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent whitespace-nowrap">
            Jet Delivery
          </span>
        )}
      </div>

      {/* ── Collapse Toggle ── */}
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="mx-2 mt-2 p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all duration-200 hidden lg:flex items-center justify-center"
        title={
          isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"
        }
      >
        <svg
          className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
          />
        </svg>
      </button>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter((item) => {
          // Merchants see ONLY the Merchant Portal link
          if (user?.role === "MERCHANT") return item.href === "/merchant";
          // ADMIN bypasses all permission checks
          if (user?.role === "ADMIN") return true;
          // Everyone else: links gated by a PAGE_ permission require it via the
          // composite RBAC check; admin-only links stay hidden otherwise.
          if (item.permission) return hasPermission(user, item.permission);
          return !item.adminOnly;
        }).map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`
                w-full flex items-center rounded-lg text-sm font-medium
                transition-all duration-200 group
                ${isCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"}
                ${
                  active
                    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                    : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
                }
              `}
              title={isCollapsed ? item.label : undefined}
            >
              <span
                className={`shrink-0 transition-all duration-200 ${
                  active
                    ? "text-cyan-400 drop-shadow-[0_0_6px_rgba(6,182,212,0.6)]"
                    : "text-gray-500 group-hover:text-cyan-400 group-hover:drop-shadow-[0_0_6px_rgba(6,182,212,0.4)]"
                }`}
              >
                {item.icon}
              </span>
              {!isCollapsed && (
                <span className="flex items-center justify-between flex-1 min-w-0 gap-2">
                  <span className="whitespace-nowrap truncate">
                    {item.label}
                  </span>
                  {item.href === "/settlements" &&
                  payoutCounts.pendingSettlements > 0 ? (
                    <span className="ml-auto shrink-0 bg-amber-500 text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full">
                      {payoutCounts.pendingSettlements > 99
                        ? "99+"
                        : payoutCounts.pendingSettlements}
                    </span>
                  ) : item.href === "/cleared-payouts" &&
                    payoutCounts.pendingClearance > 0 ? (
                    <span className="ml-auto shrink-0 bg-amber-500 text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full">
                      {payoutCounts.pendingClearance > 99
                        ? "99+"
                        : payoutCounts.pendingClearance}
                    </span>
                  ) : null}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── User Info + Logout ── */}
      <div
        className={`border-t border-white/10 ${isCollapsed ? "p-2" : "p-3"}`}
      >
        {!isCollapsed && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-xs text-cyan-400 font-bold shrink-0">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-300 truncate">
                {user?.username}
              </p>
              <p className="text-[10px] text-gray-500">{user?.role}</p>
            </div>
          </div>
        )}

        {/* ── Theme Toggle ── */}
        <ThemeToggle variant="sidebar" isCollapsed={isCollapsed} />

        {/* ── Settings Button ── */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          className={`
            w-full flex items-center rounded-lg text-sm font-medium mb-1.5
            text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10
            transition-all duration-200
            ${isCollapsed ? "justify-center p-2" : "gap-2 px-3 py-2"}
          `}
          title={isCollapsed ? "Settings" : undefined}
        >
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
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {!isCollapsed && "Settings"}
        </button>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className={`
            w-full flex items-center rounded-lg text-sm font-medium
            text-red-400 bg-red-500/10 border border-red-500/30
            hover:bg-red-500/20 hover:text-red-300 hover:border-red-400/60
            hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]
            focus:outline-none focus:ring-2 focus:ring-red-500/40
            transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
            ${isCollapsed ? "justify-center p-2" : "gap-2 px-3 py-2"}
          `}
          title={isCollapsed ? "Logout" : undefined}
        >
          {loggingOut ? (
            <svg
              className="animate-spin h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          )}
          {!isCollapsed && (loggingOut ? "Signing out..." : "Logout")}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* ── Desktop: sidebar permanently visible and docked ── */}
      <div className="hidden lg:block h-screen sticky top-0 shrink-0 print:hidden">
        {renderSidebarContent()}
      </div>

      {/* ── Mobile: hamburger button (hidden on desktop) ── */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-[#0B0F17]/90 border border-white/10 text-gray-300 hover:text-white shadow-lg print:hidden"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* ── Mobile: slide-over drawer with backdrop ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 print:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 h-full shadow-2xl">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        showNotifications={user?.role === "MERCHANT"}
      />
    </>
  );
}
