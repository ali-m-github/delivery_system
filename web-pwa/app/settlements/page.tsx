"use client";

import { useState, useEffect, useCallback, Fragment } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayoutOrder {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  financialStatus: string;
  location: string;
  createdAt: string;
  zone: { name: string };
  merchant?: { merchantName: string } | null;
  driverCommissionUsd?: number | null;
  payoutId?: string;
  payoutReference?: string | null;
}

interface DriverPayout {
  id: string;
  driverId: string;
  sequentialIndex: number;
  payoutReference: string;
  status: string;
  totalUsd: number;
  totalLbp: number;
  commissionUsd: number;
  netUsd: number;
  totalCollected: number;
  previousDebtUsd: number;
  previousDebtLbp: number;
  amountPaidUsd: number;
  amountPaidLbp: number;
  remainingUsd: number;
  remainingLbp: number;
  createdAt: string;
  clearedAt: string | null;
  createdBy?: {
    id: string;
    username: string;
    email: string;
  } | null;
  driver: {
    id: string;
    driverId: string;
    firstName: string;
    lastName: string;
    carriedDebtUsd: number;
    carriedDebtLbp: number;
  };
  orders: PayoutOrder[];
}

interface TreasuryBox {
  id: string;
  name: string;
  balanceUsd: number;
  balanceLbp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function beirutDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function beirutDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DriverConsignmentsPage() {
  // ── Pending data state (PENDING) ──
  const [pendingPayouts, setPendingPayouts] = useState<DriverPayout[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  // ── Treasury boxes for settlement modal ──
  const [treasuryBoxes, setTreasuryBoxes] = useState<TreasuryBox[]>([]);

  // ── Expand state ──
  const [expandedPayoutIds, setExpandedPayoutIds] = useState<string[]>([]);

  // ── Modal state for detailed order view ──
  const [modalPayout, setModalPayout] = useState<DriverPayout | null>(null);

  // ── Settlement modal state ──
  const [settlementModal, setSettlementModal] = useState<DriverPayout | null>(
    null,
  );
  const [settlementBoxId, setSettlementBoxId] = useState("");
  const [settlementAmountPaid, setSettlementAmountPaid] = useState(0);
  const [settling, setSettling] = useState(false);

  // ── Paid-by-driver statements state ──
  const [availableStatements, setAvailableStatements] = useState<any[]>([]);
  const [selectedStatementIds, setSelectedStatementIds] = useState<string[]>(
    [],
  );
  // Cashbox chosen for each paid statement: { [statementId]: treasuryBoxId }
  const [statementBoxes, setStatementBoxes] = useState<Record<string, string>>(
    {},
  );

  // ── Fetch treasury boxes ──
  const fetchTreasuryBoxes = useCallback(() => {
    fetch("/api/admin/treasury")
      .then((res) => res.json())
      .then((data) => setTreasuryBoxes(Array.isArray(data) ? data : []))
      .catch(() => setTreasuryBoxes([]));
  }, []);

  // ── Fetch available statements (not approved, not pending approval) ──
  const fetchAvailableStatements = useCallback(() => {
    fetch("/api/statements?paymentStatus=AVAILABLE")
      .then((res) => res.json())
      .then((data) => setAvailableStatements(Array.isArray(data) ? data : []))
      .catch(() => setAvailableStatements([]));
  }, []);

  // ── Fetch all data from settlements API (PENDING only) ──
  const fetchAllData = useCallback(() => {
    setPendingLoading(true);

    fetch("/api/admin/drivers/settlements")
      .then((res) => res.json())
      .then((data) => {
        // Map pending data
        const settlements = (data.settlements || []).map((p: any) => ({
          id: p.payoutId,
          driverId: p.driverId,
          sequentialIndex: p.sequentialIndex,
          payoutReference: p.payoutReference || `#${p.sequentialIndex}`,
          status: p.status,
          totalUsd: p.totalUsd,
          totalLbp: p.totalLbp,
          commissionUsd: p.commissionUsd,
          netUsd: p.netUsd,
          totalCollected: p.totalCollected ?? 0,
          previousDebtUsd: p.previousDebtUsd,
          previousDebtLbp: p.previousDebtLbp,
          amountPaidUsd: p.amountPaidUsd,
          amountPaidLbp: p.amountPaidLbp,
          remainingUsd: p.remainingUsd,
          remainingLbp: p.remainingLbp,
          createdAt: p.createdAt || "",
          clearedAt: p.clearedAt,
          createdBy: p.createdBy || null,
          driver: {
            id: p.driverId,
            driverId: p.driverInternalId,
            firstName: p.driverName.split(" ")[0] || "",
            lastName: p.driverName.split(" ").slice(1).join(" ") || "",
            carriedDebtUsd: p.carriedDebtUsd,
            carriedDebtLbp: p.carriedDebtLbp,
          },
          orders: (p.orders || []).map((o: any) => ({
            id: o.id,
            orderId: o.orderId,
            customerName: o.customerName || "",
            customerPhone: o.customerPhone || "",
            customerAddress: o.customerAddress || "",
            amountUsd: o.amountUsd,
            amountLbp: o.amountLbp,
            collectedUsd: o.collectedUsd,
            collectedLbp: o.collectedLbp,
            financialStatus: o.financialStatus || "",
            location: o.location || "",
            createdAt: o.createdAt || "",
            zone: o.zone || { name: "" },
            merchant: o.merchant || null,
            driverCommissionUsd: o.driverCommissionUsd,
          })),
        }));

        setPendingPayouts(settlements);
        setPendingLoading(false);
      })
      .catch(() => {
        setPendingPayouts([]);
        setPendingLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchAllData();
    fetchTreasuryBoxes();
    fetchAvailableStatements();
  }, [fetchAllData, fetchTreasuryBoxes, fetchAvailableStatements]);

  // ── Toggle expanded row ──
  const toggleExpanded = (payoutId: string) => {
    setExpandedPayoutIds((prev) =>
      prev.includes(payoutId)
        ? prev.filter((id) => id !== payoutId)
        : [...prev, payoutId],
    );
  };

  // ── Export to Excel ──
  const exportToExcel = async (filename: string, rows: any[]) => {
    if (!rows || !rows.length) return;
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(
      workbook,
      filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
    );
  };

  // ── Print / PDF (opens orders in print view) ──
  const handleViewPrint = useCallback((payout: DriverPayout) => {
    if (!payout.orders || payout.orders.length === 0) {
      alert("No orders in this payout.");
      return;
    }
    const ids = payout.orders.map((o) => o.id).join(",");
    const driverId = payout.driverId || payout.driver?.id;
    window.open(
      `/print/orders?ids=${ids}&driverId=${driverId}&payoutId=${payout.id}`,
      "_blank",
    );
  }, []);

  // ── Print isolated invoice (PDF via browser print) ──
  const printPayoutInvoice = useCallback((payout: DriverPayout) => {
    const clearedDate = beirutDateTime(payout.clearedAt || payout.createdAt);

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const ordersHtml = (payout.orders || [])
      .map(
        (o) => `
        <tr>
          <td>${o.orderId}</td>
          <td>${o.customerName}</td>
          <td>${o.zone?.name || "—"}</td>
          <td class="text-right">$${(o.amountUsd ?? 0).toFixed(2)}</td>
          <td class="text-right">${(o.amountLbp ?? 0).toLocaleString()}</td>
          <td class="text-right">$${(o.collectedUsd ?? 0).toFixed(2)}</td>
          <td class="text-right">${o.driverCommissionUsd == null ? "—" : `$${o.driverCommissionUsd.toFixed(2)}`}</td>
        </tr>`,
      )
      .join("");

    printWindow.document.write(/* html */ `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Driver Consignment ${payout.payoutReference}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: 'Courier New', monospace; padding: 24px; color: #000; background: #fff; }
          @media print { body { padding: 12px; } }
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 12px; margin-bottom: 16px; }
          .header h2 { font-size: 18px; margin-bottom: 4px; }
          .header p { font-size: 12px; }
          .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; font-size: 13px; }
          .summary .label { font-weight: bold; }
          .badge { display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: bold; border: 1px solid #000; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
          th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; }
          th { background: #eee; font-weight: bold; }
          .text-right { text-align: right; }
          .footer { margin-top: 20px; text-align: center; font-size: 11px; color: #555; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Driver Consignment — Batch ${payout.payoutReference}</h2>
          <p>Driver: ${payout.driver.firstName} ${payout.driver.lastName} (${payout.driver.driverId})</p>
          <p>Cleared: ${clearedDate} &mdash; Status: <span class="badge">${payout.status}</span></p>
        </div>
        <div class="summary">
          <div><span class="label">Net Payout:</span> $${payout.netUsd.toFixed(2)}</div>
          <div><span class="label">Total LBP:</span> ${payout.totalLbp.toLocaleString()}</div>
          <div><span class="label">Amount Paid:</span> $${payout.amountPaidUsd.toFixed(2)}</div>
          <div><span class="label">Carried Debt:</span> $${payout.remainingUsd.toFixed(2)}</div>
          <div><span class="label">Previous Debt:</span> $${payout.previousDebtUsd.toFixed(2)}</div>
          <div><span class="label">Commission:</span> $${payout.commissionUsd.toFixed(2)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tracking ID</th>
              <th>Customer</th>
              <th>Zone</th>
              <th class="text-right">Amount USD</th>
              <th class="text-right">Amount LBP</th>
              <th class="text-right">Collected USD</th>
              <th class="text-right">Driver Commission</th>
            </tr>
          </thead>
          <tbody>${ordersHtml}</tbody>
        </table>
        <div class="footer">Printed on ${new Date().toLocaleString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  }, []);

  // ── Open settlement modal ──
  const openSettlementModal = (payout: DriverPayout) => {
    setSettlementModal(payout);
    setSettlementBoxId("");
    setSelectedStatementIds([]);
    setStatementBoxes({});
    setSettlementAmountPaid(payout.netUsd);
  };

  // ── Set the cashbox a selected statement is paid into ──
  const setStatementBox = (id: string, boxId: string) => {
    setStatementBoxes((prev) => ({ ...prev, [id]: boxId }));
  };

  // ── Toggle a paid-by-driver statement selection ──
  const toggleStatement = (id: string) => {
    const isSelected = selectedStatementIds.includes(id);
    const next = isSelected
      ? selectedStatementIds.filter((s) => s !== id)
      : [...selectedStatementIds, id];
    setSelectedStatementIds(next);
    // Deduct the net amount of selected statements from the amount paid.
    const deducted = availableStatements
      .filter((s) => next.includes(s.id))
      .reduce((sum, s) => sum + (s.netUsd ?? 0), 0);
    setSettlementAmountPaid(
      Math.max(0, (settlementModal?.netUsd ?? 0) - deducted),
    );
    // Default the statement's cashbox to the same box as the main payout.
    if (!isSelected && settlementBoxId) {
      setStatementBoxes((prev) => ({ ...prev, [id]: settlementBoxId }));
    }
  };

  // ── Handle settlement submit ──
  const handleSettlementSubmit = async () => {
    if (!settlementModal || !settlementBoxId) return;
    setSettling(true);
    try {
      const res = await fetch("/api/admin/drivers/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutId: settlementModal.id,
          treasuryBoxId: settlementBoxId,
          amountPaidUsd: settlementAmountPaid,
          amountPaidLbp: 0,
          statements: selectedStatementIds.map((id) => ({
            id,
            treasuryBoxId: statementBoxes[id] || "",
          })),
        }),
      });
      const result = await res.json();
      if (result.success) {
        alert(result.message || "Settlement processed successfully.");
        setSettlementModal(null);
        fetchAllData();
        fetchTreasuryBoxes();
        fetchAvailableStatements();
      } else {
        alert(result.error || "Failed to process settlement.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during settlement.");
    } finally {
      setSettling(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans antialiased">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ── */}
        <header className="flex justify-between items-center mb-4 border-b border-white/5 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Driver Consignments
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Settle pending driver payouts here — approve cleared payouts on
              the Cleared Payouts page.
            </p>
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ── SECTION 2: PENDING PAYOUTS ──────────────────────────────────── */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-1 w-1 rounded-full bg-amber-400" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Pending Payouts
            </h2>
            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold rounded">
              ACTION REQUIRED
            </span>
          </div>

          <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">Payout ID</th>
                    <th className="px-4 py-3 font-semibold">Driver</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Total Collected
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Net Payout
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Commission
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Orders
                    </th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendingLoading ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="text-center py-12 text-gray-500"
                      >
                        Loading pending payouts...
                      </td>
                    </tr>
                  ) : pendingPayouts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="text-center py-12 text-gray-500 italic"
                      >
                        No pending payouts — all settlements are up to date.
                      </td>
                    </tr>
                  ) : (
                    pendingPayouts.map((payout) => {
                      const isExpanded = expandedPayoutIds.includes(payout.id);
                      return (
                        <Fragment key={payout.id}>
                          <tr
                            onClick={() => toggleExpanded(payout.id)}
                            className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
                          >
                            <td className="px-4 py-3 font-mono text-amber-400 text-sm">
                              {payout.payoutReference}
                            </td>
                            <td className="px-4 py-3 text-white text-sm font-medium">
                              {payout.driver.firstName} {payout.driver.lastName}
                              <span className="text-gray-600 text-xs ml-1">
                                ({payout.driver.driverId})
                              </span>
                            </td>
                            <td
                              className="px-4 py-3 text-gray-300 text-xs"
                              title={beirutDateTime(payout.createdAt)}
                            >
                              {beirutDate(payout.createdAt)}
                              {payout.createdBy?.username && (
                                <span className="block text-gray-600">
                                  by {payout.createdBy.username}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-blue-400 text-sm text-right font-mono font-bold">
                              ${payout.totalCollected.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-green-400 text-sm text-right font-mono font-bold">
                              ${payout.netUsd.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-purple-400 text-sm text-right font-mono">
                              ${payout.commissionUsd.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-gray-300 text-sm text-right">
                              {payout.orders.length}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded border bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse">
                                {payout.status}
                              </span>
                            </td>
                            <td
                              className="px-4 py-3 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => openSettlementModal(payout)}
                                  className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 text-white border border-emerald-500/50 rounded hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20"
                                >
                                  ✓ Receive Cash & Clear
                                </button>
                                <button
                                  onClick={() => setModalPayout(payout)}
                                  className="px-2.5 py-1 text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20 transition-colors"
                                >
                                  👁 Detail
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded pending payout details */}
                          {isExpanded && (
                            <tr>
                              <td
                                colSpan={9}
                                className="bg-[#0a0f1a] border-b border-white/10 px-6 py-5"
                              >
                                <div className="flex justify-between items-center mb-3">
                                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                                    Pending Orders — Payout{" "}
                                    {payout.payoutReference}
                                  </h4>
                                  <span className="text-xs text-gray-500">
                                    {payout.orders.length} order
                                    {payout.orders.length !== 1 ? "s" : ""}
                                  </span>
                                </div>

                                {payout.orders.length === 0 ? (
                                  <p className="text-gray-600 text-sm italic">
                                    No orders in this pending payout.
                                  </p>
                                ) : (
                                  <div className="overflow-x-auto rounded-lg border border-white/5">
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="bg-white/[0.02] text-gray-500 text-[11px] uppercase tracking-wider">
                                          <th className="px-4 py-2 font-semibold">
                                            Order ID
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Seller
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Customer
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Phone
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Address
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Zone
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Fin. Status
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Location
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Date Received
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Amount USD
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Amount LBP
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Collected USD
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Collected LBP
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Driver Commission
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Payout Ref
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {payout.orders.map((order) => {
                                          const actualCollectedUsd =
                                            (order.collectedUsd ?? 0) === 0
                                              ? (order.amountUsd ?? 0)
                                              : (order.collectedUsd ?? 0);
                                          const actualCollectedLbp =
                                            (order.collectedLbp ?? 0) === 0
                                              ? (order.amountLbp ?? 0)
                                              : (order.collectedLbp ?? 0);
                                          const isMismatched =
                                            (order.amountUsd ?? 0) !==
                                              actualCollectedUsd ||
                                            (order.amountLbp ?? 0) !==
                                              actualCollectedLbp;
                                          return (
                                            <tr
                                              key={order.id}
                                              className={`border-b border-white/[0.03] transition-colors ${
                                                isMismatched
                                                  ? "bg-yellow-500/20"
                                                  : "hover:bg-white/[0.01]"
                                              }`}
                                            >
                                              <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                                                {order.orderId}
                                              </td>
                                              <td className="px-4 py-2 text-gray-400 text-xs">
                                                {order.merchant?.merchantName ||
                                                  "—"}
                                              </td>
                                              <td className="px-4 py-2 text-gray-300 text-sm">
                                                {order.customerName || "—"}
                                              </td>
                                              <td className="px-4 py-2 text-gray-400 text-xs font-mono whitespace-nowrap">
                                                {order.customerPhone || "—"}
                                              </td>
                                              <td className="px-4 py-2 text-gray-500 text-xs max-w-[160px] truncate">
                                                {order.customerAddress || "—"}
                                              </td>
                                              <td className="px-4 py-2 text-gray-500 text-xs">
                                                {order.zone?.name || "—"}
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-white/5 border border-white/10">
                                                  {order.financialStatus || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-gray-500 text-xs">
                                                {order.location || "—"}
                                              </td>
                                              <td className="px-4 py-2 text-gray-500 text-xs">
                                                {beirutDate(order.createdAt)}
                                              </td>
                                              <td className="px-4 py-2 text-green-400 text-xs text-right font-mono">
                                                $
                                                {(order.amountUsd ?? 0).toFixed(
                                                  2,
                                                )}
                                              </td>
                                              <td className="px-4 py-2 text-gray-400 text-xs text-right">
                                                {(
                                                  order.amountLbp ?? 0
                                                ).toLocaleString()}
                                              </td>
                                              <td className="px-4 py-2 text-green-300 text-xs text-right font-mono">
                                                $
                                                {(
                                                  order.collectedUsd ?? 0
                                                ).toFixed(2)}
                                              </td>
                                              <td className="px-4 py-2 text-gray-400 text-xs text-right">
                                                {(
                                                  order.collectedLbp ?? 0
                                                ).toLocaleString()}
                                              </td>
                                              <td className="px-4 py-2 text-purple-400 text-xs text-right font-mono">
                                                {order.driverCommissionUsd == null
                                                  ? "—"
                                                  : `$${order.driverCommissionUsd.toFixed(2)}`}
                                              </td>
                                              <td className="px-4 py-2 text-amber-400/70 text-xs font-mono">
                                                {order.payoutReference ||
                                                  order.payoutId ||
                                                  "—"}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* Financial summary for pending payout */}
                                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                                  <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                                    <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                                      Net Payout
                                    </p>
                                    <p className="text-green-400 font-mono text-lg font-bold">
                                      ${payout.netUsd.toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                                    <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                                      Total LBP
                                    </p>
                                    <p className="text-gray-300 font-mono text-lg font-bold">
                                      {payout.totalLbp.toLocaleString()}
                                    </p>
                                  </div>
                                  <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                                    <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                                      Commission
                                    </p>
                                    <p className="text-purple-400 font-mono text-lg font-bold">
                                      ${payout.commissionUsd.toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                                    <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                                      Previous Debt
                                    </p>
                                    <p className="text-amber-400/70 font-mono text-lg font-bold">
                                      ${payout.previousDebtUsd.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {/* ── Detail Modal (full-screen overlay for orders) ── */}
      {modalPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121824] border border-white/10 rounded-2xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-6 border-b border-white/10 sticky top-0 bg-[#121824] z-10">
              <div>
                <h2 className="text-xl font-bold text-cyan-400">
                  Payout {modalPayout.payoutReference} —{" "}
                  {modalPayout.driver.firstName} {modalPayout.driver.lastName}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {modalPayout.status === "PENDING" ? "Created" : "Cleared"}:{" "}
                  {beirutDateTime(
                    modalPayout.clearedAt || modalPayout.createdAt,
                  )}
                  {modalPayout.createdBy?.username && (
                    <> · by {modalPayout.createdBy.username}</>
                  )}
                  {" · "}
                  {modalPayout.orders.length} orders
                </p>
              </div>
              <button
                onClick={() => setModalPayout(null)}
                className="text-gray-500 hover:text-gray-300 transition-colors text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            {/* Modal Body */}
            <div className="p-6">
              {/* Financial summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Net Payout
                  </p>
                  <p className="text-green-400 font-mono text-lg font-bold">
                    ${modalPayout.netUsd.toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Amount Paid
                  </p>
                  <p className="text-emerald-400 font-mono text-lg font-bold">
                    ${modalPayout.amountPaidUsd.toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Carried Debt
                  </p>
                  <p
                    className={`font-mono text-lg font-bold ${
                      (modalPayout.remainingUsd ?? 0) > 0.01
                        ? "text-red-400"
                        : "text-gray-500"
                    }`}
                  >
                    ${(modalPayout.remainingUsd ?? 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Prev Debt
                  </p>
                  <p className="text-amber-400/70 font-mono text-lg font-bold">
                    ${modalPayout.previousDebtUsd.toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Commission
                  </p>
                  <p className="text-purple-400 font-mono text-lg font-bold">
                    ${modalPayout.commissionUsd.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Orders table */}
              <div className="overflow-x-auto rounded-lg border border-white/5">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] text-gray-500 text-[11px] uppercase tracking-wider">
                      <th className="px-4 py-2 font-semibold">Order ID</th>
                      <th className="px-4 py-2 font-semibold">Date Received</th>
                      <th className="px-4 py-2 font-semibold">Customer</th>
                      <th className="px-4 py-2 font-semibold">Phone</th>
                      <th className="px-4 py-2 font-semibold">Address</th>
                      <th className="px-4 py-2 font-semibold">Zone</th>
                      <th className="px-4 py-2 font-semibold">Fin. Status</th>
                      <th className="px-4 py-2 font-semibold">Location</th>
                      <th className="px-4 py-2 font-semibold">Seller</th>
                      <th className="px-4 py-2 font-semibold text-right">
                        Amount USD
                      </th>
                      <th className="px-4 py-2 font-semibold text-right">
                        Amount LBP
                      </th>
                      <th className="px-4 py-2 font-semibold text-right">
                        Collected USD
                      </th>
                      <th className="px-4 py-2 font-semibold text-right">
                        Collected LBP
                      </th>
                      <th className="px-4 py-2 font-semibold text-right">
                        Driver Commission
                      </th>
                      <th className="px-4 py-2 font-semibold">Payout Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modalPayout.orders || []).map((order) => {
                      const actualCollectedUsd =
                        (order.collectedUsd ?? 0) === 0
                          ? (order.amountUsd ?? 0)
                          : (order.collectedUsd ?? 0);
                      const actualCollectedLbp =
                        (order.collectedLbp ?? 0) === 0
                          ? (order.amountLbp ?? 0)
                          : (order.collectedLbp ?? 0);
                      const isMismatched =
                        (order.amountUsd ?? 0) !== actualCollectedUsd ||
                        (order.amountLbp ?? 0) !== actualCollectedLbp;
                      return (
                        <tr
                          key={order.id}
                          className={`border-b border-white/[0.03] transition-colors ${
                            isMismatched
                              ? "bg-yellow-500/20"
                              : "hover:bg-white/[0.01]"
                          }`}
                        >
                          <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                            {order.orderId}
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                            {beirutDate(order.createdAt)}
                          </td>
                          <td className="px-4 py-2 text-gray-300 text-sm">
                            {order.customerName}
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs font-mono whitespace-nowrap">
                            {order.customerPhone || "—"}
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs max-w-[160px] truncate">
                            {order.customerAddress || "—"}
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs">
                            {order.zone?.name || "—"}
                          </td>
                          <td className="px-4 py-2">
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-white/5 border border-white/10">
                              {order.financialStatus || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs">
                            {order.location || "—"}
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs">
                            {order.merchant?.merchantName || "—"}
                          </td>
                          <td className="px-4 py-2 text-green-400 text-xs text-right font-mono">
                            ${(order.amountUsd ?? 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs text-right">
                            {(order.amountLbp ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-green-300 text-xs text-right font-mono">
                            ${actualCollectedUsd.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs text-right">
                            {(order.collectedLbp ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-purple-400 text-xs text-right font-mono">
                            {order.driverCommissionUsd == null
                              ? "—"
                              : `$${order.driverCommissionUsd.toFixed(2)}`}
                          </td>
                          <td className="px-4 py-2 text-amber-400/70 text-xs font-mono">
                            {order.payoutReference || order.payoutId || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Modal Footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-white/10">
              {modalPayout.status === "PENDING" && (
                <button
                  onClick={() => {
                    setModalPayout(null);
                    openSettlementModal(modalPayout);
                  }}
                  className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                >
                  ✓ Receive Cash & Clear This Payout
                </button>
              )}
              <button
                onClick={() => handleViewPrint(modalPayout)}
                className="px-4 py-2 text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] rounded-lg transition-colors shadow-[0_0_15px_rgba(6,182,212,0.3)]"
              >
                🖨 View / Print Orders
              </button>
              <button
                onClick={() => printPayoutInvoice(modalPayout)}
                className="px-4 py-2 text-sm font-bold bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                📄 Export PDF
              </button>
              <button
                onClick={() => {
                  const rows = (modalPayout.orders || []).map((o) => ({
                    "Order ID": o.orderId,
                    Customer: o.customerName,
                    Phone: o.customerPhone || "",
                    Address: o.customerAddress || "",
                    Zone: o.zone?.name || "",
                    "Amount USD": (o.amountUsd ?? 0).toFixed(2),
                    "Amount LBP": (o.amountLbp ?? 0).toLocaleString(),
                    "Collected USD": (o.collectedUsd ?? 0).toFixed(2),
                    "Collected LBP": (o.collectedLbp ?? 0).toLocaleString(),
                    "Driver Commission USD":
                      o.driverCommissionUsd == null
                        ? "Rate not configured"
                        : o.driverCommissionUsd.toFixed(2),
                    "Fin Status": o.financialStatus,
                    Location: o.location,
                    Seller: o.merchant?.merchantName || "—",
                  }));
                  exportToExcel(
                    `Payout_${modalPayout.payoutReference}_Orders`,
                    rows,
                  );
                }}
                className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
              >
                📊 Export Excel
              </button>
              <button
                onClick={() => setModalPayout(null)}
                className="px-4 py-2 text-sm bg-white/5 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settlement Modal (Confirm & Clear Pending Payout) ── */}
      {settlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121824] border border-white/10 rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Receive Cash & Clear — Payout {settlementModal.payoutReference}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {settlementModal.driver.firstName}{" "}
                  {settlementModal.driver.lastName} (
                  {settlementModal.driver.driverId}){" · "}
                  {settlementModal.orders?.length || 0} orders
                </p>
              </div>
              <button
                onClick={() => setSettlementModal(null)}
                className="text-gray-500 hover:text-gray-300 transition-colors text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Financial summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Net Payout
                  </p>
                  <p className="text-green-400 font-mono text-lg font-bold">
                    ${(settlementModal.netUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Total LBP
                  </p>
                  <p className="text-gray-300 font-mono text-lg font-bold">
                    {(settlementModal.totalLbp || 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Treasury Box selection */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5 font-bold">
                  Treasury Box
                </label>
                <select
                  value={settlementBoxId}
                  onChange={(e) => setSettlementBoxId(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
                >
                  <option value="">— Select a Treasury Box —</option>
                  {treasuryBoxes.map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.name} (Balance: ${box.balanceUsd.toFixed(2)})
                    </option>
                  ))}
                </select>
                {!settlementBoxId && (
                  <p className="text-xs text-red-400 mt-1">
                    Required — select a Treasury Box to record this settlement.
                  </p>
                )}
              </div>

              {/* Statements Paid by Driver (deducted from payout) */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5 font-bold">
                  Statements Paid by Driver
                </label>
                {availableStatements.length === 0 ? (
                  <p className="text-xs text-gray-600">
                    No available statements to deduct.
                  </p>
                ) : (
                  <div className="bg-[#0B0F17] border border-white/10 rounded-lg max-h-64 overflow-y-auto divide-y divide-white/5">
                    {availableStatements.map((stmt) => {
                      const checked = selectedStatementIds.includes(stmt.id);
                      return (
                        <div
                          key={stmt.id}
                          className="px-3 py-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleStatement(stmt.id)}
                                className="w-4 h-4 rounded border-gray-600 bg-[#0B0F17] text-emerald-500 focus:ring-emerald-500/50 cursor-pointer"
                              />
                              <span className="text-sm text-gray-300 truncate">
                                {stmt.merchant?.merchantName} · Statement #
                                {stmt.sequentialIndex}
                              </span>
                            </div>
                            <span className="text-sm font-mono text-emerald-400 shrink-0">
                              -${(stmt.netUsd ?? 0).toFixed(2)}
                            </span>
                          </div>
                          {checked && (
                            <div className="mt-2 pl-6">
                              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-bold">
                                Pay to Cashbox
                              </label>
                              <select
                                value={statementBoxes[stmt.id] || ""}
                                onChange={(e) =>
                                  setStatementBox(stmt.id, e.target.value)
                                }
                                className="w-full bg-[#0B0F17] border border-white/10 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
                              >
                                <option value="">— Select a Cashbox —</option>
                                {treasuryBoxes.map((box) => (
                                  <option key={box.id} value={box.id}>
                                    {box.name}
                                  </option>
                                ))}
                              </select>
                              {!statementBoxes[stmt.id] && (
                                <p className="text-[10px] text-red-400 mt-0.5">
                                  Required — choose where this statement is
                                  paid.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedStatementIds.length > 0 && (
                  <p className="text-xs text-emerald-400 mt-1">
                    {selectedStatementIds.length} statement(s) selected —
                    deducted from the payout amount. Each posts to its cashbox
                    when the payout is approved.
                  </p>
                )}
                {selectedStatementIds.some((id) => !statementBoxes[id]) && (
                  <p className="text-xs text-red-400 mt-1">
                    Select a cashbox for every selected statement.
                  </p>
                )}
              </div>

              {/* Amount Paid USD */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5 font-bold">
                  Amount Paid (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={settlementAmountPaid}
                  onChange={(e) =>
                    setSettlementAmountPaid(parseFloat(e.target.value) || 0)
                  }
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
                {(() => {
                  // Statements paid by the driver are also credited against the
                  // payout, so the true short/over is after subtracting them.
                  const deducted = selectedStatementIds.reduce((sum, id) => {
                    const stmt = availableStatements.find((s) => s.id === id);
                    return sum + (stmt?.netUsd ?? 0);
                  }, 0);
                  const remaining =
                    (settlementModal.netUsd || 0) -
                    settlementAmountPaid -
                    deducted;
                  const hasDeficit = remaining > 0.01;
                  const hasOverpay = remaining < -0.01;
                  return (
                    <p
                      className={`text-xs mt-1 font-bold ${
                        hasDeficit
                          ? "text-red-400"
                          : hasOverpay
                            ? "text-amber-400"
                            : "text-emerald-400"
                      }`}
                    >
                      {hasDeficit
                        ? `Short payment: $${remaining.toFixed(2)} will be carried as debt`
                        : hasOverpay
                          ? `Overpayment: $${Math.abs(remaining).toFixed(2)} excess`
                          : "Exact amount — no debt carried"}
                    </p>
                  );
                })()}
              </div>

              {/* Warning note */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <p className="text-amber-400 text-xs">
                  ⚠ This moves the payout to{" "}
                  <strong className="text-amber-300">PENDING APPROVAL</strong>.
                  On approval it becomes CLEARED, all orders are set to{" "}
                  <strong className="text-amber-300">WO (With Office)</strong>,
                  the <strong className="text-amber-300">full payout</strong> is
                  posted to the selected cashbox, each paid statement is posted
                  to its own cashbox, and the statements are marked{" "}
                  <strong className="text-amber-300">PAID</strong>.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setSettlementModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg font-bold text-gray-400 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSettlementSubmit}
                disabled={
                  !settlementBoxId ||
                  selectedStatementIds.some((id) => !statementBoxes[id]) ||
                  settling
                }
                className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-emerald-500/20"
              >
                {settling ? "Processing..." : "✓ Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
