"use client";

import { useState, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
interface PendingUser {
  id: string;
  username: string;
  email: string;
}

interface AvailableSeller {
  id: string;
  merchantId: number;
  merchantName: string;
}

interface DashboardApprovalsProps {
  userRole: string;
}

export default function DashboardApprovals({
  userRole,
}: DashboardApprovalsProps) {
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [availableSellers, setAvailableSellers] = useState<AvailableSeller[]>(
    [],
  );
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard/approvals")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setPendingUsers(data.pendingUsers || []);
        setAvailableSellers(data.availableSellers || []);
      })
      .catch(() => {
        // silently fail — approvals section simply won't show
      })
      .finally(() => setApprovalsLoading(false));
  }, []);

  if (approvalsLoading || pendingUsers.length === 0 || userRole !== "ADMIN") {
    return null;
  }

  return (
    <div className="px-4 sm:px-6 mb-6">
      <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-xl p-6">
        <h2 className="text-lg font-bold text-yellow-400 mb-4 flex items-center gap-2">
          ⚠️ Pending Merchant Approvals ({pendingUsers.length})
        </h2>
        <div className="grid gap-4">
          {pendingUsers.map((pu) => (
            <div
              key={pu.id}
              className="flex items-center justify-between bg-[#0B0F17] p-4 rounded-lg border border-white/5"
            >
              <div>
                <p className="font-bold text-white">{pu.username}</p>
                <p className="text-sm text-gray-400">{pu.email}</p>
              </div>

              <div className="flex items-center gap-3">
                <select
                  id={`dash-link-select-${pu.id}`}
                  className="bg-[#121824] border border-white/10 text-white text-sm rounded-lg p-2.5 outline-none focus:border-cyan-500"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select Seller Profile to Link...
                  </option>
                  {availableSellers.map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {seller.merchantName}
                    </option>
                  ))}
                </select>
                <button
                  disabled={linkingId === pu.id}
                  onClick={async () => {
                    const select = document.getElementById(
                      `dash-link-select-${pu.id}`,
                    ) as HTMLSelectElement;
                    if (!select.value)
                      return alert("Select a seller profile first");
                    setLinkingId(pu.id);
                    try {
                      const res = await fetch("/api/merchants/link", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          userId: pu.id,
                          merchantId: select.value,
                        }),
                      });
                      if (!res.ok) {
                        const err = await res.json();
                        return alert(err.error || "Failed to link");
                      }
                      window.location.reload();
                    } catch {
                      alert("Error linking user to seller.");
                    } finally {
                      setLinkingId(null);
                    }
                  }}
                  className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
                >
                  {linkingId === pu.id ? "Linking..." : "Approve & Link"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
