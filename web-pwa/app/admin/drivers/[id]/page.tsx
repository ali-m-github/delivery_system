import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";

export default async function AdminDriverProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const identifier = id; // e.g., "d001"

  const driver = await prisma.driverProfile.findFirst({
    where: {
      driverId: {
        equals: identifier,
        mode: "insensitive",
      },
    },
    include: {
      user: {
        select: { username: true, email: true },
      },
      zoneRates: {
        include: { zone: { select: { id: true, name: true } } },
      },
      driverSellerRates: {
        include: {
          merchant: {
            select: { id: true, merchantName: true, merchantId: true },
          },
        },
      },
      payouts: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!driver) return notFound();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Background grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] pointer-events-none z-0" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
              {driver.firstName} {driver.lastName}
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              <span className="bg-white/5 px-2 py-1 rounded border border-white/10 font-mono text-cyan-400 mr-2">
                ID: {driver.driverId}
              </span>
              {driver.user?.username && (
                <span className="text-gray-500">@{driver.user.username}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-white/5 border border-white/10 transition-colors"
            >
              ← Back to Admin
            </Link>
            <Link
              href={`/drivers/${driver.driverId.toLowerCase()}`}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
            >
              Full Profile & Ledger →
            </Link>
          </div>
        </div>

        {/* Vehicle badges */}
        <div className="flex flex-wrap gap-2 mb-6">
          {driver.vehicles.length > 0 ? (
            driver.vehicles.map((v) => (
              <span
                key={v}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-white/5 text-gray-300 border border-white/10"
              >
                {v.charAt(0) + v.slice(1).toLowerCase()}
              </span>
            ))
          ) : (
            <span className="text-xs text-gray-600">No vehicles assigned</span>
          )}
        </div>

        {/* Zone Rates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-4">
              Zone Commission Rates
            </h2>
            {driver.zoneRates.length === 0 ? (
              <p className="text-sm text-gray-500">No zone rates configured.</p>
            ) : (
              <div className="space-y-2">
                {driver.zoneRates.map((zr) => (
                  <div
                    key={zr.id}
                    className="flex items-center justify-between px-4 py-2 rounded-lg bg-white/5 border border-white/5"
                  >
                    <span className="text-sm text-gray-300">
                      {zr.zone.name}
                    </span>
                    <span className="text-sm font-mono text-cyan-400">
                      ${zr.rate.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Seller Rate Exceptions */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-4">
              Seller Rate Exceptions ({driver.driverSellerRates.length})
            </h2>
            {driver.driverSellerRates.length === 0 ? (
              <p className="text-sm text-gray-500">
                No seller-specific rate exceptions.
              </p>
            ) : (
              <div className="space-y-2">
                {driver.driverSellerRates.map((sr) => (
                  <div
                    key={sr.id}
                    className="flex items-center justify-between px-4 py-2 rounded-lg bg-white/5 border border-white/5"
                  >
                    <span className="text-sm text-gray-300">
                      {sr.merchant.merchantName}
                    </span>
                    <span className="text-sm font-mono text-amber-400">
                      ${sr.rateUsd.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Payouts */}
        <div className="mt-6 backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            Recent Payouts ({driver.payouts.length})
          </h2>
          {driver.payouts.length === 0 ? (
            <p className="text-sm text-gray-500">No payout history.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4 font-medium">#</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">
                      Total USD
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      Commission
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      Net USD
                    </th>
                    <th className="py-3 px-4 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {driver.payouts.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-cyan-400">
                        #{p.sequentialIndex}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                            p.status === "CLEARED"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-green-400 font-mono">
                        ${p.totalUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-red-400 font-mono">
                        -${p.commissionUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-cyan-400 font-mono font-bold">
                        ${p.netUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-xs">
                        {new Date(p.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
