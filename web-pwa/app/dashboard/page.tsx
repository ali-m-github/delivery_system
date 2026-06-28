"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const statsCards = [
  { label: "Active Deliveries", value: "24", suffix: "orders", color: "cyan" },
  { label: "Total Earnings", value: "$8,420", suffix: "today", color: "green" },
  {
    label: "Completed Orders",
    value: "1,892",
    suffix: "this month",
    color: "purple",
  },
  { label: "Driver Rating", value: "4.9", suffix: "★ average", color: "amber" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    id: string;
    username: string;
    role: string;
    permissions: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        setUser(data);
        setIsLoading(false);
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  // Critical loading guard — do not render anything until auth resolves
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ---------- Welcome Section ---------- */}
      <div className="px-4 sm:px-6 pt-6 pb-4">
        <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 sm:p-8 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-4 border-cyan-400/20 border-t-cyan-400 animate-spin shadow-[0_0_20px_rgba(6,182,212,0.6)]" />
                <div className="absolute inset-0 w-12 h-12 rounded-full animate-ping opacity-20 bg-cyan-400" />
              </div>
              <p className="mt-4 text-sm text-gray-400 animate-pulse">
                Loading dashboard...
              </p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
                  Welcome back, {user?.username || "User"}!
                </h2>
                <p className="mt-1.5 text-sm text-gray-400">
                  Here's what's happening with your deliveries today.
                </p>
                {user?.role === "ADMIN" && (
                  <button
                    onClick={() => router.push("/admin")}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                                 text-purple-300 bg-purple-500/10 border border-purple-500/30
                                 hover:bg-purple-500/20 hover:text-purple-200 hover:border-purple-400/60
                                 hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                                 focus:outline-none focus:ring-2 focus:ring-purple-500/40
                                 transition-all duration-200 sm:hidden"
                  >
                    ⚡ Admin Panel
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-white/5 px-3 py-1.5 rounded-full border border-white/5 shrink-0">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)] animate-pulse" />
                System Online
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Stats Grid ---------- */}
      <div className="px-4 sm:px-6 pb-8 flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {statsCards.map((card) => {
            const glowMap: Record<string, string> = {
              cyan: "shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] border-cyan-500/30",
              green:
                "shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] border-green-500/30",
              purple:
                "shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)] border-purple-500/30",
              amber:
                "shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] border-amber-500/30",
            };

            const accentMap: Record<string, string> = {
              cyan: "from-cyan-400 to-cyan-600",
              green: "from-green-400 to-green-600",
              purple: "from-purple-400 to-purple-600",
              amber: "from-amber-400 to-amber-600",
            };

            return (
              <div
                key={card.label}
                className={`
                    backdrop-blur-xl bg-white/5 rounded-2xl border p-5 sm:p-6
                    transition-all duration-300 group cursor-default
                    ${glowMap[card.color] || glowMap.cyan}
                  `}
              >
                <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-2">
                  {card.label}
                </p>
                <p className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
                  {card.value}
                </p>
                <p className="text-xs text-gray-500">{card.suffix}</p>
                {/* Accent gradient bar */}
                <div
                  className={`mt-4 h-0.5 rounded-full bg-gradient-to-r ${accentMap[card.color] || accentMap.cyan} opacity-60 group-hover:opacity-100 transition-opacity duration-300`}
                />
              </div>
            );
          })}
        </div>
        {/* ---------- System Modules ---------- */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <Link
            href="/sellers"
            className="backdrop-blur-xl bg-white/5 border border-white/10 hover:border-cyan-500/50 p-6 rounded-2xl transition-all duration-300 flex flex-col items-center justify-center text-center group hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]"
          >
            <div className="w-14 h-14 bg-cyan-500/10 text-cyan-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-cyan-500/20 transition-all duration-300 text-2xl shadow-[0_0_15px_rgba(6,182,212,0.2)]">
              🏬
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              Sellers & Rates
            </h3>
            <p className="text-sm text-gray-400">
              Manage merchants and custom zone shipping fees.
            </p>
          </Link>

          <Link
            href="/orders"
            className="backdrop-blur-xl bg-white/5 border border-white/10 hover:border-purple-500/50 p-6 rounded-2xl transition-all duration-300 flex flex-col items-center justify-center text-center group hover:shadow-[0_0_20px_rgba(168,85,247,0.15)]"
          >
            <div className="w-14 h-14 bg-purple-500/10 text-purple-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-purple-500/20 transition-all duration-300 text-2xl shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              📦
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              Dispatch Board
            </h3>
            <p className="text-sm text-gray-400">
              Manage, assign, and track active deliveries.
            </p>
          </Link>
        </div>
        {/* ---------- Placeholder Activity Row ---------- */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Recent Activity */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-5 sm:p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              Recent Activity
            </h3>
            <div className="space-y-3">
              {[
                "Order #1042 delivered by Mike D.",
                "Order #1041 picked up by Sarah K.",
                "Order #1040 assigned to John W.",
                "Order #1039 completed — 5★ rating",
              ].map((activity, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 text-sm text-gray-400 border-b border-white/5 pb-2 last:border-0 last:pb-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.6)] shrink-0" />
                  {activity}
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-5 sm:p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              Quick Actions
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                "New Delivery",
                "Add Driver",
                "View Reports",
                "Manage Fleet",
              ].map((action) => (
                <button
                  key={action}
                  className="px-3 py-3 rounded-lg text-sm font-medium text-gray-400 bg-white/5 border border-white/10
                                 hover:text-white hover:bg-white/10 hover:border-cyan-500/30
                                 hover:shadow-[0_0_12px_rgba(6,182,212,0.3)]
                                 transition-all duration-200 text-center"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
