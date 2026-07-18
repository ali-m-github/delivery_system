"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function StatementsPage() {
  const searchParams = useSearchParams();
  const merchantIdFilter = searchParams.get("merchantId");

  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);

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
      { header: "Net USD", key: "netUsd", width: 15 },
      { header: "Net LBP", key: "netLbp", width: 15 },
    ];

    statement.orders.forEach((order: any) => {
      const rate = statement.merchant.zoneRates?.find(
        (zr: any) =>
          String(zr.zoneId) === String(order.zoneId) ||
          String(zr.zoneId) === String(order.zone?.name),
      );
      const shipUsd = rate?.rateUsd ?? rate?.rate ?? rate?.price ?? 0;
      const shipLbp = rate?.rateLbp ?? 0;
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
        netUsd: collUsd - shipUsd,
        netLbp: collLbp - shipLbp,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Statement_${statement.merchant.merchantName}_#${statement.sequentialIndex}.xlsx`;
    link.click();
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
            <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
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
                    <th className="px-6 py-4 font-medium text-right text-cyan-400">
                      Net Payout
                    </th>
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
                        <div className="text-green-400 font-mono font-bold">
                          ${stmt.netUsd.toFixed(2)}
                        </div>
                        {stmt.netLbp > 0 && (
                          <div className="text-yellow-400 font-mono text-xs font-bold">
                            {stmt.netLbp.toLocaleString()} LL
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedStatement(stmt)}
                          className="px-3 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    const rate = selectedStatement.merchant.zoneRates?.find(
                      (zr: any) =>
                        String(zr.zoneId) === String(order.zoneId) ||
                        String(zr.zoneId) === String(order.zone?.name),
                    );
                    const shipUsd =
                      rate?.rateUsd ?? rate?.rate ?? rate?.price ?? 0;
                    const shipLbp = rate?.rateLbp ?? 0;

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
                Generated by Delivery System
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
