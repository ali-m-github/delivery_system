"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";

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
  driverCommissionUsd?: number;
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
  // ── Archive data state (CLEARED/PAID) ──
  const [archivePayouts, setArchivePayouts] = useState<DriverPayout[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(true);

  // ── Pending data state (PENDING) ──
  const [pendingPayouts, setPendingPayouts] = useState<DriverPayout[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  // ── Treasury boxes for settlement modal ──
  const [treasuryBoxes, setTreasuryBoxes] = useState<TreasuryBox[]>([]);

  // ── Filter state for archive ──
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("CLEARED");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // ── Expand / selection state ──
  const [expandedPayoutIds, setExpandedPayoutIds] = useState<string[]>([]);
  const [selectedPayouts, setSelectedPayouts] = useState<string[]>([]);

  // ── Modal state for detailed order view ──
  const [modalPayout, setModalPayout] = useState<DriverPayout | null>(null);

  // ── Settlement modal state ──
  const [settlementModal, setSettlementModal] = useState<DriverPayout | null>(
    null,
  );
  const [settlementBoxId, setSettlementBoxId] = useState("");
  const [settlementAmountPaid, setSettlementAmountPaid] = useState(0);
  const [settling, setSettling] = useState(false);

  // ── Fetch treasury boxes ──
  const fetchTreasuryBoxes = useCallback(() => {
    fetch("/api/admin/treasury")
      .then((res) => res.json())
      .then((data) => setTreasuryBoxes(Array.isArray(data) ? data : []))
      .catch(() => setTreasuryBoxes([]));
  }, []);

  // ── Fetch all data from settlements API ──
  const fetchAllData = useCallback(() => {
    setArchiveLoading(true);
    setPendingLoading(true);

    fetch("/api/admin/drivers/settlements")
      .then((res) => res.json())
      .then((data) => {
        // Map history (archive) data
        const history = (data.history || []).map((p: any) => ({
          id: p.payoutId,
          driverId: p.driverId,
          sequentialIndex: p.sequentialIndex,
          payoutReference: p.payoutReference || `#${p.sequentialIndex}`,
          status: p.status,
          totalUsd: p.totalUsd,
          totalLbp: p.totalLbp,
          commissionUsd: p.commissionUsd,
          netUsd: p.netUsd,
          totalCollected: 0,
          previousDebtUsd: p.previousDebtUsd,
          previousDebtLbp: p.previousDebtLbp,
          amountPaidUsd: p.amountPaidUsd,
          amountPaidLbp: p.amountPaidLbp,
          remainingUsd: p.remainingUsd,
          remainingLbp: p.remainingLbp,
          createdAt: "",
          clearedAt: p.clearedAt,
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
            customerName: "",
            amountUsd: o.amountUsd,
            amountLbp: o.amountLbp,
            collectedUsd: o.collectedUsd,
            collectedLbp: o.collectedLbp,
            financialStatus: "",
            location: "",
            createdAt: "",
            zone: { name: "" },
          })),
        }));

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
          totalCollected: 0,
          previousDebtUsd: p.previousDebtUsd,
          previousDebtLbp: p.previousDebtLbp,
          amountPaidUsd: p.amountPaidUsd,
          amountPaidLbp: p.amountPaidLbp,
          remainingUsd: p.remainingUsd,
          remainingLbp: p.remainingLbp,
          createdAt: "",
          clearedAt: p.clearedAt,
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
            customerName: "",
            amountUsd: o.amountUsd,
            amountLbp: o.amountLbp,
            collectedUsd: o.collectedUsd,
            collectedLbp: o.collectedLbp,
            financialStatus: "",
            location: "",
            createdAt: "",
            zone: { name: "" },
          })),
        }));

        setArchivePayouts(history);
        setPendingPayouts(settlements);
        setArchiveLoading(false);
        setPendingLoading(false);
      })
      .catch(() => {
        setArchivePayouts([]);
        setPendingPayouts([]);
        setArchiveLoading(false);
        setPendingLoading(false);
      });
  }, []);

  // ── Fetch archive payouts with filters (for detailed view) ──
  const fetchArchivePayouts = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("sortBy", "clearedAt");
    params.set("sortDir", sortOrder);

    setArchiveLoading(true);
    fetch(`/api/drivers/payouts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setArchivePayouts(Array.isArray(data) ? data : []);
        setArchiveLoading(false);
      })
      .catch(() => {
        setArchivePayouts([]);
        setArchiveLoading(false);
      });
  }, [search, statusFilter, startDate, endDate, sortOrder]);

  useEffect(() => {
    fetchAllData();
    fetchTreasuryBoxes();
  }, [fetchAllData, fetchTreasuryBoxes]);

  useEffect(() => {
    fetchArchivePayouts();
  }, [fetchArchivePayouts]);

  // ── Toggle expanded row ──
  const toggleExpanded = (payoutId: string) => {
    setExpandedPayoutIds((prev) =>
      prev.includes(payoutId)
        ? prev.filter((id) => id !== payoutId)
        : [...prev, payoutId],
    );
  };

  // ── Toggle payout selection ──
  const togglePayoutSelection = (id: string) => {
    setSelectedPayouts((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id],
    );
  };

  // ── Export to Excel ──
  const exportToExcel = (filename: string, rows: any[]) => {
    if (!rows || !rows.length) return;
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
          <td class="text-right">$${(o.driverCommissionUsd ?? 0).toFixed(2)}</td>
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

  // ── Export selected payouts summary to Excel ──
  const exportSelectedToExcel = useCallback(() => {
    const selected = archivePayouts.filter((p) =>
      selectedPayouts.includes(p.id),
    );
    if (selected.length === 0) {
      alert("Please select at least one payout to export.");
      return;
    }
    const rows = selected.map((p) => ({
      "Payout ID": p.payoutReference,
      "Driver ID": p.driver.driverId,
      Driver: `${p.driver.firstName} ${p.driver.lastName}`,
      Status: p.status,
      "Cleared Date": beirutDate(p.clearedAt || ""),
      "Net Payout USD": p.netUsd.toFixed(2),
      "Amount Paid USD": p.amountPaidUsd.toFixed(2),
      "Carried Debt USD": p.remainingUsd.toFixed(2),
      "Previous Debt USD": p.previousDebtUsd.toFixed(2),
      "Commission USD": p.commissionUsd.toFixed(2),
      "Total LBP": p.totalLbp.toLocaleString(),
      "Order Count": p.orders.length,
    }));
    exportToExcel("Consignments_Archive_Export", rows);
  }, [archivePayouts, selectedPayouts]);

  // ── Export selected payouts orders to Excel ──
  const exportSelectedOrdersToExcel = useCallback(() => {
    const selected = archivePayouts.filter((p) =>
      selectedPayouts.includes(p.id),
    );
    if (selected.length === 0) {
      alert("Please select at least one payout to export.");
      return;
    }
    const allOrders: any[] = [];
    selected.forEach((p) => {
      (p.orders || []).forEach((o) => {
        allOrders.push({
          "Payout ID": p.payoutReference,
          "Driver ID": p.driver.driverId,
          Driver: `${p.driver.firstName} ${p.driver.lastName}`,
          "Order ID": o.orderId,
          Customer: o.customerName,
          Phone: o.customerPhone || "",
          Address: o.customerAddress || "",
          Zone: o.zone?.name || "",
          "Amount USD": (o.amountUsd ?? 0).toFixed(2),
          "Amount LBP": (o.amountLbp ?? 0).toLocaleString(),
          "Collected USD": (o.collectedUsd ?? 0).toFixed(2),
          "Collected LBP": (o.collectedLbp ?? 0).toLocaleString(),
          "Driver Commission USD": (o.driverCommissionUsd ?? 0).toFixed(2),
          "Fin Status": o.financialStatus,
          Location: o.location,
          Seller: o.merchant?.merchantName || "—",
        });
      });
    });
    exportToExcel("Consignments_Archive_Orders", allOrders);
  }, [archivePayouts, selectedPayouts]);

  // ── Print selected payouts as summary ──
  const printSelectedSummaries = useCallback(() => {
    const selected = archivePayouts.filter((p) =>
      selectedPayouts.includes(p.id),
    );
    if (selected.length === 0) {
      alert("Please select at least one payout to print.");
      return;
    }

    let printContent = `
      <html>
        <head>
          <title>Driver Consignments Summaries</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: black; }
            h2 { border-bottom: 2px solid black; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .text-right { text-align: right; }
          </style>
        </head>
        <body>
          <h2>Driver Consignments — Selected Summaries</h2>
          <table>
            <thead>
              <tr>
                <th>Payout ID</th>
                <th>Driver</th>
                <th>Cleared</th>
                <th class="text-right">Net Payout</th>
                <th class="text-right">Amount Paid</th>
                <th class="text-right">Carried Debt</th>
                <th class="text-right">Prev Debt</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>`;

    selected.forEach((p) => {
      printContent += `
        <tr>
          <td>${p.payoutReference}</td>
          <td>${p.driver.firstName} ${p.driver.lastName} (${p.driver.driverId})</td>
          <td>${beirutDate(p.clearedAt || "")}</td>
          <td class="text-right">$${p.netUsd.toFixed(2)}</td>
          <td class="text-right">$${p.amountPaidUsd.toFixed(2)}</td>
          <td class="text-right">$${p.remainingUsd.toFixed(2)}</td>
          <td class="text-right">$${p.previousDebtUsd.toFixed(2)}</td>
          <td>${p.orders.length}</td>
        </tr>`;
    });

    printContent += `</tbody></table></body></html>`;

    const printFrame = document.createElement("iframe");
    printFrame.style.position = "absolute";
    printFrame.style.top = "-9999px";
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(printContent);
      frameDoc.close();
    }

    printFrame.contentWindow?.focus();
    setTimeout(() => {
      printFrame.contentWindow?.print();
      document.body.removeChild(printFrame);
    }, 250);
  }, [archivePayouts, selectedPayouts]);

  // ── Open settlement modal ──
  const openSettlementModal = (payout: DriverPayout) => {
    setSettlementModal(payout);
    setSettlementBoxId("");
    setSettlementAmountPaid(payout.netUsd);
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
        }),
      });
      const result = await res.json();
      if (result.success) {
        alert(result.message || "Settlement processed successfully.");
        setSettlementModal(null);
        fetchAllData();
        fetchTreasuryBoxes();
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

  // ── Render archive table rows ──
  const renderArchiveRows = (payouts: DriverPayout[]) => {
    if (archiveLoading) {
      return (
        <tr>
          <td colSpan={11} className="text-center py-12 text-gray-500">
            Loading archive...
          </td>
        </tr>
      );
    }
    if (payouts.length === 0) {
      return (
        <tr>
          <td colSpan={11} className="text-center py-12 text-gray-500 italic">
            No cleared payouts found matching the current filters.
          </td>
        </tr>
      );
    }
    return payouts.map((payout) => {
      const isExpanded = expandedPayoutIds.includes(payout.id);
      const carriedDebtUsd = payout.remainingUsd ?? 0;
      const hasShortPay = carriedDebtUsd > 0.01;

      return (
        <Fragment key={payout.id}>
          {/* Main row */}
          <tr
            onClick={() => toggleExpanded(payout.id)}
            className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
          >
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selectedPayouts.includes(payout.id)}
                onChange={() => togglePayoutSelection(payout.id)}
                className="w-4 h-4 rounded border-white/20 bg-[#0B0F17] text-cyan-600 focus:ring-cyan-500/50 focus:ring-offset-0 cursor-pointer accent-cyan-600"
              />
            </td>
            <td className="px-4 py-3 font-mono text-cyan-400 text-sm">
              {payout.payoutReference}
            </td>
            <td className="px-4 py-3 text-white text-sm font-medium">
              {payout.driver.firstName} {payout.driver.lastName}
              <span className="text-gray-600 text-xs ml-1">
                ({payout.driver.driverId})
              </span>
            </td>
            <td className="px-4 py-3 text-gray-300 text-xs">
              {beirutDate(payout.clearedAt || payout.createdAt)}
            </td>
            <td className="px-4 py-3 text-green-400 text-sm text-right font-mono font-bold">
              ${payout.netUsd.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-emerald-400 text-sm text-right font-mono">
              ${payout.amountPaidUsd.toFixed(2)}
            </td>
            <td
              className={`px-4 py-3 text-sm text-right font-mono font-bold ${
                hasShortPay ? "text-red-400" : "text-gray-500"
              }`}
            >
              {hasShortPay ? `$${carriedDebtUsd.toFixed(2)}` : "$0.00"}
            </td>
            <td className="px-4 py-3 text-amber-400/70 text-sm text-right font-mono">
              {payout.previousDebtUsd > 0
                ? `$${payout.previousDebtUsd.toFixed(2)}`
                : "$0.00"}
            </td>
            <td className="px-4 py-3 text-gray-300 text-sm text-right">
              {payout.orders.length}
            </td>
            <td className="px-4 py-3">
              <span
                className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                  payout.status === "CLEARED"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : payout.status === "PAID"
                      ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}
              >
                {payout.status}
              </span>
            </td>
            <td
              className="px-4 py-3 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center gap-1.5">
                <button
                  onClick={() => handleViewPrint(payout)}
                  disabled={!payout.orders || payout.orders.length === 0}
                  title="View / Print Orders"
                  className="px-2.5 py-1 text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  🖨 View/Print
                </button>
                <button
                  onClick={() => printPayoutInvoice(payout)}
                  title="Export PDF"
                  className="px-2 py-1 text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/30 rounded hover:bg-red-500/20 transition-colors"
                >
                  📄 PDF
                </button>
                <button
                  onClick={() => {
                    const rows = (payout.orders || []).map((o) => ({
                      "Order ID": o.orderId,
                      Customer: o.customerName,
                      Phone: o.customerPhone || "",
                      Address: o.customerAddress || "",
                      Zone: o.zone?.name || "",
                      "Amount USD": (o.amountUsd ?? 0).toFixed(2),
                      "Amount LBP": (o.amountLbp ?? 0).toLocaleString(),
                      "Collected USD": (o.collectedUsd ?? 0).toFixed(2),
                      "Collected LBP": (o.collectedLbp ?? 0).toLocaleString(),
                      "Driver Commission USD": (
                        o.driverCommissionUsd ?? 0
                      ).toFixed(2),
                      "Fin Status": o.financialStatus,
                      Location: o.location,
                      Seller: o.merchant?.merchantName || "—",
                    }));
                    exportToExcel(
                      `Payout_${payout.payoutReference}_Orders`,
                      rows,
                    );
                  }}
                  title="Export to Excel"
                  className="px-2 py-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/20 transition-colors"
                >
                  📊 Excel
                </button>
              </div>
            </td>
          </tr>

          {/* Expanded sub-row: Order details */}
          {isExpanded && (
            <tr>
              <td
                colSpan={11}
                className="bg-[#0a0f1a] border-b border-white/10 px-6 py-5"
              >
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                    Itemized Orders — Payout {payout.payoutReference}
                  </h4>
                  <span className="text-xs text-gray-500">
                    {payout.orders.length} order
                    {payout.orders.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {payout.orders.length === 0 ? (
                  <p className="text-gray-600 text-sm italic">
                    No orders associated with this payout.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-white/5">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-white/[0.02] text-gray-500 text-[11px] uppercase tracking-wider">
                          <th className="px-4 py-2 font-semibold">
                            Tracking ID
                          </th>
                          <th className="px-4 py-2 font-semibold">Customer</th>
                          <th className="px-4 py-2 font-semibold">Zone</th>
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
                          <th className="px-4 py-2 font-semibold">
                            Fin Status
                          </th>
                          <th className="px-4 py-2 font-semibold">Location</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payout.orders.map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors"
                          >
                            <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                              {order.orderId}
                            </td>
                            <td className="px-4 py-2 text-gray-300 text-sm">
                              {order.customerName}
                            </td>
                            <td className="px-4 py-2 text-gray-500 text-xs">
                              {order.zone?.name || "—"}
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
                              ${(order.collectedUsd ?? 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-2 text-gray-400 text-xs text-right">
                              {(order.collectedLbp ?? 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-purple-400 text-xs text-right font-mono">
                              ${(order.driverCommissionUsd ?? 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                                  order.financialStatus === "WO"
                                    ? "bg-green-500/10 text-green-400 border-green-500/30"
                                    : "bg-gray-500/10 text-gray-400 border-gray-500/30"
                                }`}
                              >
                                {order.financialStatus}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-gray-500 text-xs">
                              {order.location}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Summary row for expanded payout */}
                {payout.orders.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
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
                        Amount Paid
                      </p>
                      <p className="text-emerald-400 font-mono text-lg font-bold">
                        ${payout.amountPaidUsd.toFixed(2)}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg p-3 border ${
                        hasShortPay
                          ? "bg-red-500/5 border-red-500/20"
                          : "bg-[#121824] border-white/5"
                      }`}
                    >
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                        Carried Debt
                      </p>
                      <p
                        className={`font-mono text-lg font-bold ${
                          hasShortPay ? "text-red-400" : "text-gray-500"
                        }`}
                      >
                        ${carriedDebtUsd.toFixed(2)}
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
                    <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                        Driver Curr. Debt
                      </p>
                      <p className="text-orange-400 font-mono text-lg font-bold">
                        ${(payout.driver.carriedDebtUsd ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
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
              Manage driver payout settlements — archive cleared payouts and
              process pending ones.
            </p>
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ── SECTION 1: ARCHIVE (Cleared/Paid Payouts) ──────────────────── */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-1 w-1 rounded-full bg-emerald-400" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Cleared Payouts Archive
            </h2>
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold rounded">
              READ-ONLY
            </span>
          </div>

          {/* ── Filter Ribbon ── */}
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5 mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                Search
              </label>
              <input
                type="text"
                placeholder="Driver name, Driver ID, or Payout Batch #"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
              >
                <option value="CLEARED">Cleared</option>
                <option value="PAID">Paid</option>
                <option value="ALL">All Statuses</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors [color-scheme:dark]"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                Sort by Date
              </label>
              <button
                onClick={() =>
                  setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                }
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white hover:border-cyan-500/50 transition-colors text-left flex justify-between items-center"
              >
                <span>
                  {sortOrder === "desc" ? "↓ Newest First" : "↑ Oldest First"}
                </span>
                <span className="text-gray-500 text-xs">↻</span>
              </button>
            </div>
          </div>

          {/* ── Bulk Action Toolbar ── */}
          {selectedPayouts.length > 0 && (
            <div className="bg-[#121824] border border-white/5 rounded-xl px-5 py-3 mb-4 flex flex-wrap items-center gap-3 shadow-2xl">
              <span className="text-sm text-gray-400">
                <span className="text-white font-bold">
                  {selectedPayouts.length}
                </span>{" "}
                selected
              </span>
              <div className="h-5 w-px bg-white/10" />
              <button
                onClick={printSelectedSummaries}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                  />
                </svg>
                Print / PDF Summaries
              </button>
              <button
                onClick={exportSelectedToExcel}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition-colors flex items-center gap-1.5"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Export Excel (Summaries)
              </button>
              <button
                onClick={exportSelectedOrdersToExcel}
                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition-colors flex items-center gap-1.5"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Export Excel (All Orders)
              </button>
            </div>
          )}

          {/* ── Archive Table ── */}
          <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold w-10">
                      <input
                        type="checkbox"
                        checked={
                          archivePayouts.length > 0 &&
                          selectedPayouts.length === archivePayouts.length
                        }
                        onChange={(e) =>
                          e.target.checked
                            ? setSelectedPayouts(
                                archivePayouts.map((p) => p.id),
                              )
                            : setSelectedPayouts([])
                        }
                        className="cursor-pointer accent-cyan-600"
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold">Payout ID</th>
                    <th className="px-4 py-3 font-semibold">Driver</th>
                    <th className="px-4 py-3 font-semibold">Cleared Date</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Net Payout
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Amount Paid
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Carried Debt
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Prev Debt
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
                <tbody>{renderArchiveRows(archivePayouts)}</tbody>
              </table>
            </div>
          </div>
        </section>

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
                        colSpan={8}
                        className="text-center py-12 text-gray-500"
                      >
                        Loading pending payouts...
                      </td>
                    </tr>
                  ) : pendingPayouts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
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
                            <td className="px-4 py-3 text-gray-300 text-xs">
                              {beirutDate(payout.createdAt)}
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
                                  ✓ Settle
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
                                colSpan={8}
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
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {payout.orders.map((order) => (
                                          <tr
                                            key={order.id}
                                            className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors"
                                          >
                                            <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                                              {order.orderId}
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
                                          </tr>
                                        ))}
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
                      <th className="px-4 py-2 font-semibold">Customer</th>
                      <th className="px-4 py-2 font-semibold">Zone</th>
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
                        Driver Commission
                      </th>
                      <th className="px-4 py-2 font-semibold">Fin Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modalPayout.orders || []).map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-white/[0.03] hover:bg-white/[0.01]"
                      >
                        <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                          {order.orderId}
                        </td>
                        <td className="px-4 py-2 text-gray-300 text-sm">
                          {order.customerName}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {order.zone?.name || "—"}
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
                          ${(order.collectedUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-purple-400 text-xs text-right font-mono">
                          ${(order.driverCommissionUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2">
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded border bg-green-500/10 text-green-400 border-green-500/30">
                            {order.financialStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
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
                  ✓ Settle This Payout
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
                    "Driver Commission USD": (
                      o.driverCommissionUsd ?? 0
                    ).toFixed(2),
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
                  Settle Payout {settlementModal.payoutReference}
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
                  const remaining =
                    (settlementModal.netUsd || 0) - settlementAmountPaid;
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
                  ⚠ This will mark the payout as{" "}
                  <strong className="text-amber-300">CLEARED</strong>, update
                  driver debt if short-paid, set all orders to{" "}
                  <strong className="text-amber-300">WO (With Office)</strong>,
                  and record a Treasury IN transaction.
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
                disabled={!settlementBoxId || settling}
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
