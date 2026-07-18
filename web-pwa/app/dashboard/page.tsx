import { cookies } from "next/headers";
import Link from "next/link";
import { jwtVerify } from "jose";
import prisma from "@/lib/prisma";
import DashboardApprovals from "@/components/DashboardApprovals";

// ── Helpers ────────────────────────────────────────────────────────────────
function daysAgo(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ── Server Component ───────────────────────────────────────────────────────
export default async function DashboardPage() {
  // ── Auth (server-side cookie read) ──────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  let user: { userId: string; role: string; username?: string } | null = null;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const { payload } = await jwtVerify(token, secret);
      user = {
        userId: (payload as any).userId,
        role: (payload as any).role,
        username: (payload as any).username,
      };
    } catch {
      user = null;
    }
  }

  // ── Prisma Queries ──────────────────────────────────────────────────────
  // 1. Active orders (not yet delivered or returned)
  const activeOrdersCount = await prisma.order.count({
    where: { location: { notIn: ["DELIVERED", "RETURNED"] } },
  });

  // 2. Today's completed deliveries
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysDeliveries = await prisma.order.count({
    where: { location: "DELIVERED", updatedAt: { gte: today } },
  });

  // 3. Financial aggregation — sum of collected values on delivered orders
  const financialData = await prisma.order.aggregate({
    where: { location: "DELIVERED" },
    _sum: { collectedUsd: true, collectedLbp: true },
  });

  // 4. Active drivers (distinct drivers with orders currently in transit)
  const activeDrivers = await prisma.order.groupBy({
    by: ["driverId"],
    where: { location: "WITH_DRIVER", driverId: { not: null } },
  });

  // 5. SLA breaches — orders stuck in WAREHOUSE for > 48 hours
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const stuckOrders = await prisma.order.findMany({
    where: { location: "WAREHOUSE", createdAt: { lte: twoDaysAgo } },
    include: { merchant: true },
    take: 5,
  });

  // ── Derived values ──────────────────────────────────────────────────────
  const grossRevenueUsd = financialData._sum.collectedUsd ?? 0;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ---------- Welcome Section ---------- */}
      <div className="px-4 sm:px-6 pt-6 pb-4">
        <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 sm:p-8 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
                Welcome back, {user?.username || "User"}!
              </h2>
              <p className="mt-1.5 text-sm text-gray-400">
                Here's what's happening with your deliveries today.
              </p>
              {user?.role === "ADMIN" && (
                <Link
                  href="/admin"
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                               text-purple-300 bg-purple-500/10 border border-purple-500/30
                               hover:bg-purple-500/20 hover:text-purple-200 hover:border-purple-400/60
                               hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                               focus:outline-none focus:ring-2 focus:ring-purple-500/40
                               transition-all duration-200 sm:hidden"
                >
                  ⚡ Admin Panel
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-white/5 px-3 py-1.5 rounded-full border border-white/5 shrink-0">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)] animate-pulse" />
              System Online
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Pending Merchant Approvals (client component) ---------- */}
      <DashboardApprovals userRole={user?.role || ""} />

      {/* ================================================================== */}
      {/* STAT CARDS GRID                                                     */}
      {/* ================================================================== */}
      <div className="px-4 sm:px-6 pb-8 flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* ── Active Deliveries (cyan) ── */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-cyan-500/30 p-5 sm:p-6 transition-all duration-300 group cursor-default shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)]">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)] animate-pulse" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">
                Active Deliveries
              </p>
            </div>
            <p className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
              {activeOrdersCount}
            </p>
            <p className="text-xs text-gray-500">orders in progress</p>
            <div className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-cyan-600 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
          </div>

          {/* ── Completed Today (green) ── */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-green-500/30 p-5 sm:p-6 transition-all duration-300 group cursor-default shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)]">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">
                Completed Today
              </p>
            </div>
            <p className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
              {todaysDeliveries}
            </p>
            <p className="text-xs text-gray-500">deliveries today</p>
            <div className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-green-400 to-green-600 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
          </div>

          {/* ── Gross Revenue USD (gold/yellow) ── */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-amber-500/30 p-5 sm:p-6 transition-all duration-300 group cursor-default shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">
                Gross Revenue (USD)
              </p>
            </div>
            <p className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
              $
              {grossRevenueUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="text-xs text-gray-500">collected from delivered</p>
            <div className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
          </div>

          {/* ── Active Drivers (purple) ── */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-purple-500/30 p-5 sm:p-6 transition-all duration-300 group cursor-default shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)]">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">
                Active Drivers
              </p>
            </div>
            <p className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
              {activeDrivers.length}
            </p>
            <p className="text-xs text-gray-500">currently in transit</p>
            <div className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-purple-400 to-purple-600 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
        </div>

        {/* ================================================================ */}
        {/* TWO-COLUMN LAYOUT: SLA Panel + Quick Actions                       */}
        {/* ================================================================ */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* ── SLA Breaches Panel ── */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-5 sm:p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span>⚠️</span> Action Required: SLA Breaches
            </h3>

            {stuckOrders.length === 0 ? (
              <div className="flex items-center gap-3 py-6 px-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <span className="text-green-400 text-2xl">✅</span>
                <div>
                  <p className="text-green-300 font-semibold text-sm">
                    All Clear
                  </p>
                  <p className="text-green-400/70 text-xs">
                    All warehouse processing is on schedule.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {stuckOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-start gap-3 bg-red-500/5 border border-red-500/15 rounded-xl p-4 hover:border-red-500/30 transition-colors"
                  >
                    <span className="text-red-400 text-lg shrink-0 mt-0.5">
                      🔴
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-semibold text-sm truncate">
                        Order #{order.orderId}
                      </p>
                      <p className="text-gray-400 text-xs">
                        {order.merchant?.merchantName || "Unknown Merchant"}
                      </p>
                      <p className="text-red-400/80 text-xs mt-1">
                        Aging: {daysAgo(order.createdAt)} days in warehouse
                      </p>
                    </div>
                    <Link
                      href={`/orders`}
                      className="shrink-0 text-xs text-cyan-400 hover:text-cyan-300 font-medium px-2 py-1 rounded border border-cyan-500/30 hover:border-cyan-400/50 transition-colors"
                    >
                      View
                    </Link>
                  </div>
                ))}
                {stuckOrders.length >= 5 && (
                  <Link
                    href="/orders"
                    className="block text-center text-xs text-cyan-400 hover:text-cyan-300 mt-2 py-2"
                  >
                    View all SLA breaches →
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* ── Quick Actions Sidebar ── */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-5 sm:p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              Quick Actions
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <Link
                href="/orders"
                className="flex items-center gap-4 px-5 py-4 rounded-xl text-sm font-medium
                           bg-white/5 border border-white/10
                           hover:bg-white/10 hover:border-cyan-500/30
                           hover:shadow-[0_0_12px_rgba(6,182,212,0.3)]
                           transition-all duration-200 group"
              >
                <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 text-xl group-hover:bg-cyan-500/20 group-hover:scale-110 transition-all duration-200">
                  📦
                </span>
                <div>
                  <p className="text-white font-semibold">Dispatch Orders</p>
                  <p className="text-xs text-gray-500">
                    Manage active deliveries
                  </p>
                </div>
              </Link>

              <Link
                href="/statements"
                className="flex items-center gap-4 px-5 py-4 rounded-xl text-sm font-medium
                           bg-white/5 border border-white/10
                           hover:bg-white/10 hover:border-purple-500/30
                           hover:shadow-[0_0_12px_rgba(168,85,247,0.3)]
                           transition-all duration-200 group"
              >
                <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 text-xl group-hover:bg-purple-500/20 group-hover:scale-110 transition-all duration-200">
                  💰
                </span>
                <div>
                  <p className="text-white font-semibold">Settle Merchants</p>
                  <p className="text-xs text-gray-500">
                    Process merchant payouts
                  </p>
                </div>
              </Link>

              <Link
                href="/zones"
                className="flex items-center gap-4 px-5 py-4 rounded-xl text-sm font-medium
                           bg-white/5 border border-white/10
                           hover:bg-white/10 hover:border-amber-500/30
                           hover:shadow-[0_0_12px_rgba(245,158,11,0.3)]
                           transition-all duration-200 group"
              >
                <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 text-xl group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-200">
                  🗺️
                </span>
                <div>
                  <p className="text-white font-semibold">Manage Rates</p>
                  <p className="text-xs text-gray-500">
                    Zone pricing & overrides
                  </p>
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* ── System Modules (kept from original) ── */}
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
      </div>
    </div>
  );
}
