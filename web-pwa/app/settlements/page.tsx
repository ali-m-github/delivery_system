"use client";

import { useState, useEffect } from "react";

export default function DriverSettlementsPage() {
  const [settlements, setSettlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanInput, setScanInput] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchSettlements = async () => {
    try {
      const res = await fetch("/api/admin/drivers/settlements");
      const data = await res.json();

      // Safety check: Only set state if the backend returned an actual array
      if (Array.isArray(data)) {
        setSettlements(data);
      } else {
        console.error("Backend Error:", data.error || data);
        setSettlements([]); // Prevents the .filter() crash
      }
    } catch (error) {
      console.error("Failed to fetch settlements", error);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettlements();
  }, []);

  const handleSettleDriver = async (driverId: string, orderIds: string[]) => {
    if (
      !confirm(
        "Confirm receipt of physical cash for these orders? This action cannot be undone.",
      )
    )
      return;

    setProcessingId(driverId);
    try {
      const res = await fetch("/api/admin/drivers/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId, orderIds }),
      });

      const result = await res.json();
      if (result.success) {
        // Remove the settled driver from the active board
        setSettlements((prev) => prev.filter((s) => s.driverId !== driverId));
      } else {
        alert(result.error || "Failed to process settlement.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during settlement.");
    } finally {
      setProcessingId(null);
    }
  };

  const filteredSettlements = settlements.filter((s) =>
    s.driverName.toLowerCase().includes(scanInput.toLowerCase()),
  );

  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 p-8 text-cyan-400 font-mono">
        Loading Settlement Matrix...
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header & Scanner Hook */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-gray-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400">
              Driver Cash Settlements
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Reconcile physical cash holdings from delivered orders.
            </p>
          </div>
          <div className="relative w-full md:w-72">
            <input
              type="text"
              placeholder="[ Ready for Barcode Scanner ]"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              className="w-full bg-slate-900 border border-gray-700 text-cyan-400 font-mono text-sm rounded px-4 py-2 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none placeholder-gray-600"
              autoFocus
            />
            <div className="absolute right-3 top-2.5 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_#ef4444]"></div>
          </div>
        </div>

        {/* Settlement Matrix */}
        {filteredSettlements.length === 0 ? (
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 font-mono">
            No pending cash settlements detected. All drivers are reconciled.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredSettlements.map((driver) => (
              <div
                key={driver.driverId}
                className="bg-slate-900 border border-gray-800 rounded-xl p-6 shadow-xl flex flex-col md:flex-row justify-between items-center gap-6"
              >
                {/* Driver Info */}
                <div className="flex-1 w-full">
                  <h2 className="text-xl font-bold text-white mb-2">
                    {driver.driverName}
                  </h2>
                  <div className="flex flex-wrap gap-4 text-sm font-mono">
                    <span className="text-gray-400">
                      Pending Orders:{" "}
                      <span className="text-cyan-400 font-bold">
                        {driver.orderCount}
                      </span>
                    </span>
                    <span className="text-gray-400">
                      Holding USD:{" "}
                      <span className="text-green-400 font-bold">
                        ${driver.totalUsd.toFixed(2)}
                      </span>
                    </span>
                    <span className="text-gray-400">
                      Holding LBP:{" "}
                      <span className="text-yellow-400 font-bold">
                        LL {driver.totalLbp.toLocaleString()}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Action Interface */}
                <div className="flex flex-col items-end w-full md:w-auto">
                  <button
                    onClick={() =>
                      handleSettleDriver(driver.driverId, driver.pendingOrders)
                    }
                    disabled={
                      processingId === driver.driverId ||
                      driver.orderCount === 0
                    }
                    className="w-full md:w-auto bg-green-600/20 text-green-400 hover:bg-green-600/40 border border-green-500/30 px-6 py-3 rounded transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processingId === driver.driverId
                      ? "Processing Reconcilation..."
                      : "Receive Cash & Clear Balance"}
                  </button>
                  <p className="text-xs text-gray-500 mt-2 font-mono">
                    Clears finStatus to 'Settled'
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
