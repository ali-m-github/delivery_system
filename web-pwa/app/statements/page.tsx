"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { styleWorksheet, downloadWorkbook } from "@/lib/excel-export";

export default function StatementsPage() {
  const searchParams = useSearchParams();
  const merchantIdFilter = searchParams.get("merchantId");

  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);

  // ── Pay Statement Modal State ──
  const [payStatement, setPayStatement] = useState<any | null>(null);
  const [treasuryBoxes, setTreasuryBoxes] = useState<any[]>([]);
  const [payBoxId, setPayBoxId] = useState("");
  const [payAmountUsd, setPayAmountUsd] = useState(0);
  const [payAmountLbp, setPayAmountLbp] = useState(0);
  const [paying, setPaying] = useState(false);

  // Cash-seller flat fee (seller rate + profit rate) overrides any zone rate
  // for that seller.
  const effectiveShipUsd = (stmt: any, order: any) => {
    const merchant = stmt.merchant || {};
    if (merchant.isCashSeller && merchant.defaultSellerRate != null) {
      return (
        (Number(merchant.defaultSellerRate) || 0) +
        (Number(merchant.defaultProfitRate) || 0)
      );
    }
    const rate = merchant.zoneRates?.find(
      (zr: any) =>
        String(zr.zoneId) === String(order.zoneId) ||
        String(zr.zoneId) === String(order.zone?.name),
    );
    return rate?.rateUsd ?? rate?.rate ?? rate?.price ?? 0;
  };

  const effectiveShipLbp = (stmt: any, order: any) => {
    const merchant = stmt.merchant || {};
    if (merchant.isCashSeller && merchant.defaultSellerRate != null) {
      return 0; // cash sellers are flat USD
    }
    const rate = merchant.zoneRates?.find(
      (zr: any) =>
        String(zr.zoneId) === String(order.zoneId) ||
        String(zr.zoneId) === String(order.zone?.name),
    );
    return rate?.rateLbp ?? 0;
  };

  useEffect(() => {
    const fetchStatements = async () => {
      setLoading(true);
      try {
        const url = merchantIdFilter
          ? `/api/statements?merchantId=${merchantIdFilter}`
          : `/api/statements`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setStatements(data);
        }
      } catch (error) {
        console.error("Error fetching statements:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchStatements();
  }, [merchantIdFilter]);

  // ── Fetch treasury boxes for the pay modal ──
  useEffect(() => {
    fetch("/api/admin/treasury")
      .then((res) => res.json())
      .then((data) => setTreasuryBoxes(Array.isArray(data) ? data : []))
      .catch(() => setTreasuryBoxes([]));
  }, []);

  // ── Open the pay statement modal (prefill net amount, editable) ──
  const openPayStatement = (stmt: any) => {
    setPayStatement(stmt);
    setPayBoxId("");
    setPayAmountUsd(stmt.netUsd ?? 0);
    setPayAmountLbp(stmt.netLbp ?? 0);
  };

  // ── Submit statement payment ──
  const handlePayStatement = async () => {
    if (!payStatement || !payBoxId) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/statements/${payStatement.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryBoxId: payBoxId,
          amountUsd: payAmountUsd,
          amountLbp: payAmountLbp,
        }),
      });
      const result = await res.json();
      if (result.success) {
        alert(
          result.message || "Statement payment recorded (pending approval).",
        );
        setPayStatement(null);
        // refresh the statement list
        const url = merchantIdFilter
          ? `/api/statements?merchantId=${merchantIdFilter}`
          : `/api/statements`;
        const fres = await fetch(url);
        if (fres.ok) setStatements(await fres.json());
      } else {
        alert(result.error || "Failed to pay statement.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during statement payment.");
    } finally {
      setPaying(false);
    }
  };

  const exportToExcel = async (statement: any) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      `Statement_${statement.sequentialIndex}`,
    );

    // Zone column removed
    worksheet.columns = [
      { header: "Tracking ID", key: "orderId", width: 15 },
      { header: "Customer Name", key: "customer", width: 25 },
      { header: "Phone", key: "phone", width: 15 },
      { header: "Address", key: "address", width: 30 },
      { header: "Orig Price USD", key: "origUsd", width: 15 },
      { header: "Orig Price LBP", key: "origLbp", width: 15 },
      { header: "Collected USD", key: "collUsd", width: 15 },
      { header: "Collected LBP", key: "collLbp", width: 15 },
      { header: "Shipping USD", key: "shipUsd", width: 15 },
      { header: "Shipping LBP", key: "shipLbp", width: 15 },
      { header: "Profit USD", key: "profitUsd", width: 15 },
      { header: "Net USD", key: "netUsd", width: 15 },
      { header: "Net LBP", key: "netLbp", width: 15 },
    ];

    statement.orders.forEach((order: any) => {
      const shipUsd = effectiveShipUsd(statement, order);
      const shipLbp = effectiveShipLbp(statement, order);
      const origUsd = order.amountUsd ?? 0;
      const origLbp = order.amountLbp ?? 0;
      const collUsd = order.collectedUsd ?? order.amountUsd ?? 0;
      const collLbp = order.collectedLbp ?? order.amountLbp ?? 0;

      worksheet.addRow({
        orderId: order.orderId,
        customer: order.customerName,
        phone: order.customerPhone || "—",
        address: order.customerAddress || "—",
        origUsd: origUsd,
        origLbp: origLbp,
        collUsd: collUsd,
        collLbp: collLbp,
        shipUsd: shipUsd,
        shipLbp: shipLbp,
        profitUsd: statement.profitUsd ?? 0,
        netUsd: collUsd - shipUsd,
        netLbp: collLbp - shipLbp,
      });
    });

    styleWorksheet(worksheet);
    await downloadWorkbook(
      workbook,
      `Statement_${statement.merchant.merchantName}_#${statement.sequentialIndex}.xlsx`,
    );
  };

  return (
    <>
      {/* ── Global Print Override: Force hiding the Sidebar and external layout during print ── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          aside, nav { display: none !important; }
          body { background: white !important; color: black !important; }
          @page { margin: 15mm; }
        }
      `,
        }}
      />

      {/* ── Main Page Content (Hidden during print) ── */}
      <div
        className={`min-h-screen bg-[#0B0F17] text-white p-6 font-sans ${selectedStatement ? "print:hidden" : ""}`}
      >
        <div className="max-w-[1400px] mx-auto">
          <div className="mb-6 border-b border-white/10 pb-4">
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
              {merchantIdFilter ? "Seller Statements" : "All Statements"}
            </h1>
          </div>

          {loading ? (
            <div className="flex justify-center py-20 text-cyan-400">
              Loading statements...
            </div>
          ) : statements.length === 0 ? (
            <div className="text-gray-500 py-20 text-center">
              No statements found.
            </div>
          ) : (
            <div className="w-full overflow-x-auto bg-[#121824] border border-white/5 rounded-xl">
              <table className="w-full text-sm text-left">
                <thead className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-[11px] uppercase">
                  <tr>
                    <th className="px-6 py-4 font-medium">Statement ID</th>
                    <th className="px-6 py-4 font-medium">Date Generated</th>
                    <th className="px-6 py-4 font-medium">Seller</th>
                    <th className="px-6 py-4 font-medium text-center">
                      Orders
                    </th>
                    <th className="px-6 py-4 font-medium text-right">
                      Gross Collected
                    </th>
                    <th className="px-6 py-4 font-medium text-right">
                      Shipping
                    </th>
                    <th
                      className="px-6 py-4 font-medium text-right text-yellow-400"
                      title="Profit = the seller's profit rate per delivered/PS order. If the assigned driver's flat-rate exception equals the full fee (seller rate + profit rate), the driver keeps the whole fee and profit is $0."
                    >
                      Profit
                    </th>
                    <th className="px-6 py-4 font-medium text-right text-cyan-400">
                      Net Payout
                    </th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map((stmt) => (
                    <tr
                      key={stmt.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-6 py-4 font-mono text-cyan-400">
                        #{stmt.sequentialIndex}
                      </td>
                      <td className="px-6 py-4 text-gray-300">
                        {new Date(stmt.createdAt).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-6 py-4 font-bold">
                        {stmt.merchant.merchantName}
                      </td>
                      <td className="px-6 py-4 text-center text-gray-400">
                        {stmt.orders.length}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="text-gray-300 font-mono">
                          ${stmt.totalUsd.toFixed(2)}
                        </div>
                        {stmt.totalLbp > 0 && (
                          <div className="text-gray-500 font-mono text-xs">
                            {stmt.totalLbp.toLocaleString()} LL
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="text-red-400 font-mono">
                          -${stmt.shippingUsd.toFixed(2)}
                        </div>
                        {stmt.shippingLbp > 0 && (
                          <div className="text-red-500/70 font-mono text-xs">
                            -{stmt.shippingLbp.toLocaleString()} LL
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="text-yellow-400 font-mono">
                          ${(stmt.profitUsd ?? 0).toFixed(2)}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="text-green-400 font-mono font-bold">
                          ${stmt.netUsd.toFixed(2)}
                        </div>
                        {stmt.netLbp > 0 && (
                          <div className="text-yellow-400 font-mono text-xs font-bold">
                            {stmt.netLbp.toLocaleString()} LL
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                            stmt.paymentStatus === "PAID"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : stmt.paymentStatus === "PENDING_APPROVAL"
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
                                : stmt.paymentStatus === "REJECTED"
                                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                                  : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                          }`}
                        >
                          {stmt.paymentStatus || "UNPAID"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedStatement(stmt)}
                            className="px-3 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20"
                          >
                            View Details
                          </button>
                          <button
                            onClick={() => openPayStatement(stmt)}
                            disabled={
                              stmt.paymentStatus === "PAID" ||
                              stmt.paymentStatus === "PENDING_APPROVAL"
                            }
                            title={
                              stmt.paymentStatus === "PAID"
                                ? "This statement is already paid"
                                : stmt.paymentStatus === "PENDING_APPROVAL"
                                  ? "This statement has a payment pending approval"
                                  : "Pay this statement to a cashbox"
                            }
                            className="px-3 py-1.5 text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {stmt.paymentStatus === "PENDING_APPROVAL"
                              ? "Pending"
                              : "Pay"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-6 py-3 border-t border-white/5 text-[11px] leading-relaxed text-gray-500">
                <span className="font-semibold text-gray-400">
                  Profit note:
                </span>{" "}
                Profit = the configured profit rate per delivered/PS order for
                this seller, <em>unless</em> the assigned driver flat-rate
                exception equals the full fee (seller rate + profit rate). In
                that case the driver keeps the entire fee, so the company profit
                for the statement is $0 — this is intended, not a calculation
                error.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Statement Detail Modal (Prints as a clean Receipt) ── */}
      {selectedStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm print:absolute print:inset-0 print:bg-white print:p-0 print:items-start print:block">
          <div className="bg-[#121824] w-full max-w-6xl rounded-2xl border border-white/20 shadow-2xl flex flex-col max-h-[90vh] print:bg-white print:border-none print:shadow-none print:max-h-none print:overflow-visible">
            {/* Modal Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#0B0F17] print:bg-white print:border-gray-300 print:pb-8">
              <div>
                <h2 className="text-2xl font-bold text-white print:text-black">
                  Statement #{selectedStatement.sequentialIndex}
                </h2>
                <p className="text-gray-400 text-sm print:text-gray-600 mt-1">
                  {selectedStatement.merchant.merchantName} &middot;{" "}
                  {new Date(selectedStatement.createdAt).toLocaleString()}
                </p>
              </div>

              {/* Buttons (Hidden on Print) */}
              <div className="flex gap-3 print:hidden">
                <button
                  onClick={() => exportToExcel(selectedStatement)}
                  className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded font-bold text-sm hover:bg-green-500/30"
                >
                  Export Excel
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-white/10 text-white border border-white/20 rounded font-bold text-sm hover:bg-white/20"
                >
                  Print PDF
                </button>
                <button
                  onClick={() => setSelectedStatement(null)}
                  className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded font-bold text-sm hover:bg-red-500/30"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Modal Summary */}
            <div className="grid grid-cols-3 gap-4 p-6 bg-white/[0.02] border-b border-white/10 print:bg-white print:border-gray-300">
              <div className="p-4 rounded bg-[#0B0F17] border border-white/5 print:bg-gray-50 print:border-gray-200">
                <p className="text-gray-500 text-xs uppercase font-bold tracking-wider mb-1 print:text-gray-600">
                  Gross Collected
                </p>
                <p className="text-lg font-mono text-white print:text-black">
                  ${selectedStatement.totalUsd.toFixed(2)}{" "}
                  <span className="text-sm text-gray-500 print:text-gray-500">
                    | {selectedStatement.totalLbp.toLocaleString()} LL
                  </span>
                </p>
              </div>
              <div className="p-4 rounded bg-[#0B0F17] border border-white/5 print:bg-gray-50 print:border-gray-200">
                <p className="text-gray-500 text-xs uppercase font-bold tracking-wider mb-1 print:text-gray-600">
                  Shipping Deducted
                </p>
                <p className="text-lg font-mono text-red-400 print:text-red-600">
                  -${selectedStatement.shippingUsd.toFixed(2)}{" "}
                  <span className="text-sm text-red-500/70 print:text-red-500/70">
                    | -{selectedStatement.shippingLbp.toLocaleString()} LL
                  </span>
                </p>
                <p className="text-xs font-mono text-yellow-400 mt-1.5 print:text-yellow-600">
                  Profit: ${(selectedStatement.profitUsd ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="p-4 rounded bg-[#0B0F17] border border-cyan-500/30 print:bg-gray-50 print:border-gray-400">
                <p className="text-cyan-400 text-xs uppercase font-bold tracking-wider mb-1 print:text-black">
                  Net Payout
                </p>
                <p className="text-2xl font-mono text-green-400 font-bold print:text-black">
                  ${selectedStatement.netUsd.toFixed(2)}{" "}
                  <span className="text-lg text-yellow-400 print:text-black">
                    | {selectedStatement.netLbp.toLocaleString()} LL
                  </span>
                </p>
              </div>
            </div>

            {/* Modal Table (Allows expansion on print) */}
            <div className="overflow-y-auto p-6 print:overflow-visible print:max-h-none">
              <table className="w-full text-sm text-left">
                <thead className="text-gray-500 text-[10px] uppercase border-b border-white/10 print:text-black print:border-gray-300">
                  <tr>
                    <th className="py-2 pr-4">Tracking ID</th>
                    <th className="py-2 pr-4">Customer Details</th>
                    <th className="py-2 pr-4 text-right">Orig Price</th>
                    <th className="py-2 pr-4 text-right">
                      Collected (USD/LBP)
                    </th>
                    <th className="py-2 pr-4 text-right">Shipping Cost</th>
                    <th className="py-2 text-right text-cyan-400 print:text-black">
                      Net Item Payout
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedStatement.orders.map((order: any) => {
                    const shipUsd = effectiveShipUsd(selectedStatement, order);
                    const shipLbp = effectiveShipLbp(selectedStatement, order);

                    const origUsd = order.amountUsd ?? 0;
                    const origLbp = order.amountLbp ?? 0;
                    const collUsd = order.collectedUsd ?? order.amountUsd ?? 0;
                    const collLbp = order.collectedLbp ?? order.amountLbp ?? 0;

                    return (
                      <tr
                        key={order.id}
                        className="border-b border-white/5 print:border-gray-200"
                      >
                        {/* Tracking */}
                        <td className="py-3 pr-4 font-mono text-cyan-400 print:text-black align-top">
                          {order.orderId}
                        </td>

                        {/* Customer Details */}
                        <td className="py-3 pr-4 text-gray-300 print:text-black align-top">
                          <div className="font-bold text-white print:text-black">
                            {order.customerName}
                          </div>
                          <div className="text-xs text-gray-500 print:text-gray-600 mt-0.5">
                            {order.customerPhone || "—"} &middot;{" "}
                            {order.customerAddress || "—"}
                          </div>
                        </td>

                        {/* Original Price */}
                        <td className="py-3 pr-4 text-right align-top">
                          <span className="text-gray-400 font-mono print:text-gray-700">
                            ${origUsd.toFixed(2)}
                          </span>
                          {origLbp > 0 && (
                            <span className="text-gray-600 text-xs font-mono block print:text-gray-500">
                              {origLbp.toLocaleString()} LL
                            </span>
                          )}
                        </td>

                        {/* Collected */}
                        <td className="py-3 pr-4 text-right align-top">
                          <span className="text-white font-mono print:text-black">
                            ${collUsd.toFixed(2)}
                          </span>
                          {collLbp > 0 && (
                            <span className="text-gray-500 text-xs font-mono block print:text-gray-600">
                              {collLbp.toLocaleString()} LL
                            </span>
                          )}
                        </td>

                        {/* Shipping */}
                        <td className="py-3 pr-4 text-right align-top">
                          <span className="text-red-400 font-mono print:text-black">
                            -${shipUsd.toFixed(2)}
                          </span>
                          {shipLbp > 0 && (
                            <span className="text-red-500/70 text-xs font-mono block print:text-gray-600">
                              -{shipLbp.toLocaleString()} LL
                            </span>
                          )}
                        </td>

                        {/* Net */}
                        <td className="py-3 text-right align-top">
                          <span className="text-green-400 font-bold font-mono print:text-black">
                            ${(collUsd - shipUsd).toFixed(2)}
                          </span>
                          {collLbp - shipLbp > 0 && (
                            <span className="text-yellow-400 font-bold text-xs font-mono block print:text-black">
                              {(collLbp - shipLbp).toLocaleString()} LL
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Print Footer */}
              <div className="hidden print:block mt-12 text-center text-sm text-gray-500">
                End of Statement #{selectedStatement.sequentialIndex} &mdash;
                Generated by Jet Delivery
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pay Statement Modal (Phase 1: record payment, pending approval) ── */}
      {payStatement && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#121824] border border-white/10 rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Pay Statement #{payStatement.sequentialIndex}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {payStatement.merchant.merchantName} &middot;{" "}
                  {payStatement.orders?.length || 0} orders
                </p>
              </div>
              <button
                onClick={() => setPayStatement(null)}
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
                    ${(payStatement.netUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Net LBP
                  </p>
                  <p className="text-yellow-400 font-mono text-lg font-bold">
                    {(payStatement.netLbp || 0).toLocaleString()} LL
                  </p>
                </div>
              </div>

              {/* Cashbox selection */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5 font-bold">
                  Cashbox
                </label>
                <select
                  value={payBoxId}
                  onChange={(e) => setPayBoxId(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
                >
                  <option value="">— Select a Cashbox —</option>
                  {treasuryBoxes.map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.name} (Balance: ${box.balanceUsd.toFixed(2)})
                    </option>
                  ))}
                </select>
                {!payBoxId && (
                  <p className="text-xs text-red-400 mt-1">
                    Required — select a Cashbox to pay this statement.
                  </p>
                )}
              </div>

              {/* Amount Paid USD (editable, prefilled with net) */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5 font-bold">
                  Amount Paid (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payAmountUsd}
                  onChange={(e) =>
                    setPayAmountUsd(parseFloat(e.target.value) || 0)
                  }
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
              </div>

              {/* Amount Paid LBP (editable, prefilled with net) */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5 font-bold">
                  Amount Paid (LBP)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={payAmountLbp}
                  onChange={(e) =>
                    setPayAmountLbp(parseFloat(e.target.value) || 0)
                  }
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
              </div>

              {/* Warning note */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <p className="text-amber-400 text-xs">
                  ⚠ This records the payment as{" "}
                  <strong className="text-amber-300">PENDING APPROVAL</strong>.
                  The cashbox balance is updated only after an admin/editor
                  approves the transaction.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setPayStatement(null)}
                className="flex-1 px-4 py-2.5 rounded-lg font-bold text-gray-400 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handlePayStatement}
                disabled={!payBoxId || paying}
                className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-emerald-500/20"
              >
                {paying ? "Processing..." : "✓ Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
