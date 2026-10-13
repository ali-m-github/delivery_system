"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  buildRateTableFromRates,
  computeOrderCommission,
  grossUsd,
  grossLbp,
  type DriverRateTable,
} from "@/lib/commission";
import SellerRateForm from "@/components/drivers/SellerRateForm";
import ConfirmPayoutModal from "@/components/payouts/ConfirmPayoutModal";
import OrderHistoryModal from "@/components/OrderHistoryModal";
import PermissionGuard from "@/components/PermissionGuard";

type Tab =
  | "assigned"
  | "assigned_tr"
  | "delivered"
  | "returns"
  | "payouts"
  | "rates";

type SortKey =
  | "orderId"
  | "merchantName"
  | "customerName"
  | "customerPhone"
  | "customerAddress"
  | "zoneName"
  | "location"
  | "financialStatus"
  | "amountUsd"
  | "amountLbp"
  | "createdAt";
type SortDir = "asc" | "desc";

type SortConfig = { key: SortKey; dir: SortDir };

export default function DriverProfilePage() {
  const params = useParams();
  const router = useRouter();
  const driverId = params.id as string;

  const [driver, setDriver] = useState<any>(null);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("assigned");
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState<any>(null);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [historyModalOrder, setHistoryModalOrder] = useState<{
    id: string;
    history: any[];
  } | null>(null);

  // ─── Settlement Modal State ────────────────────────────────────────────
  const [treasuryBoxes, setTreasuryBoxes] = useState<any[]>([]);
  const [settlementModal, setSettlementModal] = useState<any | null>(null);
  const [settlementBoxId, setSettlementBoxId] = useState("");
  const [settlementAmountPaid, setSettlementAmountPaid] = useState(0);
  const [settling, setSettling] = useState(false);

  // Statements the driver paid from his own money (deducted from the cash he
  // hands over) — identical behavior to the /settlements modal.
  const [availableStatements, setAvailableStatements] = useState<any[]>([]);
  const [selectedStatementIds, setSelectedStatementIds] = useState<string[]>(
    [],
  );
  const [statementBoxes, setStatementBoxes] = useState<Record<string, string>>(
    {},
  );

  // ─── Sort State per Tab ─────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<Record<Tab, SortConfig | null>>({
    assigned: null,
    assigned_tr: null,
    delivered: null,
    returns: null,
    payouts: null,
    rates: null,
  });

  // ─── Pagination State per Tab ────────────────────────────────────────────
  const [assignedPage, setAssignedPage] = useState(1);
  const [assignedItemsPerPage, setAssignedItemsPerPage] = useState(50);
  const [assignedTrPage, setAssignedTrPage] = useState(1);
  const [assignedTrItemsPerPage, setAssignedTrItemsPerPage] = useState(50);
  const [deliveredPage, setDeliveredPage] = useState(1);
  const [deliveredItemsPerPage, setDeliveredItemsPerPage] = useState(50);
  const [returnsPage, setReturnsPage] = useState(1);
  const [returnsItemsPerPage, setReturnsItemsPerPage] = useState(50);
  const [payoutsPage, setPayoutsPage] = useState(1);
  const [payoutsItemsPerPage, setPayoutsItemsPerPage] = useState(50);

  const handleSort = (tab: Tab, key: SortKey) => {
    setSortConfig((prev) => {
      const current = prev[tab];
      let dir: SortDir = "asc";
      if (current && current.key === key) {
        dir = current.dir === "asc" ? "desc" : "asc";
      }
      return { ...prev, [tab]: { key, dir } };
    });
  };

  const sortOrders = <T extends Record<string, any>>(
    orders: T[],
    tab: Tab,
  ): T[] => {
    const config = sortConfig[tab];
    if (!config) return orders;
    return [...orders].sort((a, b) => {
      let aVal: any = a[config.key];
      let bVal: any = b[config.key];
      // Navigate nested objects
      if (config.key === "merchantName") {
        aVal = a.merchant?.merchantName || "";
        bVal = b.merchant?.merchantName || "";
      } else if (config.key === "zoneName") {
        aVal = a.zone?.name || "";
        bVal = b.zone?.name || "";
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return config.dir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return config.dir === "asc" ? aVal - bVal : bVal - aVal;
      }
      // Fallback: treat as strings
      return config.dir === "asc"
        ? String(aVal ?? "").localeCompare(String(bVal ?? ""))
        : String(bVal ?? "").localeCompare(String(aVal ?? ""));
    });
  };

  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const SortHeader = ({
    tab,
    sortKey,
    children,
    className = "",
  }: {
    tab: Tab;
    sortKey: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => {
    const config = sortConfig[tab];
    const isActive = config?.key === sortKey;
    return (
      <th
        className={`${className} cursor-pointer select-none hover:text-white transition-colors`}
        onClick={() => handleSort(tab, sortKey)}
        title={`Sort by ${sortKey}`}
      >
        <span className="flex items-center gap-1">
          {children}
          {isActive && (
            <span className="text-cyan-400 text-[10px]">
              {config.dir === "asc" ? "↑" : "↓"}
            </span>
          )}
        </span>
      </th>
    );
  };

  // ─── Seller Flat Rate Exceptions State ─────────────────────────────────
  const [sellerRates, setSellerRates] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [showRateModal, setShowRateModal] = useState(false);
  const [editingRate, setEditingRate] = useState<any>(null);
  const [rateForm, setRateForm] = useState({
    merchantId: "",
    rateUsd: "",
    rateLbp: "",
  });
  const [rateSaving, setRateSaving] = useState(false);

  // ─── Paid-by-driver statements (identical to /settlements modal) ───────
  const fetchAvailableStatements = useCallback(() => {
    fetch("/api/statements?paymentStatus=AVAILABLE")
      .then((res) => res.json())
      .then((data) => setAvailableStatements(Array.isArray(data) ? data : []))
      .catch(() => setAvailableStatements([]));
  }, []);

  // ─── Data Fetching ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/admin/drivers/${driverId}`)
      .then((res) => {
        if (!res.ok) {
          setDriver(null);
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data !== null) {
          setDriver(data);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));

    fetch(`/api/drivers/${driverId}/payouts`)
      .then((res) => res.json())
      .then((data) => setPayouts(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch seller-specific flat rates
    fetch(`/api/admin/drivers/${driverId}/rates`)
      .then((res) => res.json())
      .then((data) => setSellerRates(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch merchants list for the rate form dropdown
    fetch("/api/admin/merchants")
      .then((res) => res.json())
      .then((data) => setMerchants(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch treasury boxes for settlement modal
    fetch("/api/admin/treasury")
      .then((res) => res.json())
      .then((data) => setTreasuryBoxes(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch paid-by-driver statements for the settlement modal
    fetchAvailableStatements();
  }, [driverId, activeTab, fetchAvailableStatements]);

  // ─── Derived Data ───────────────────────────────────────────────────────
  const deliveries: any[] = driver?.deliveries || [];

  // ── Driver-held batches ──────────────────────────────────────────────────
  // Standard batch ("Assigned - Dr"): ASSIGNED / WITH_DRIVER (out for delivery).
  // Transit batch ("Assigned - Tr"): ASSIGNED_TR, assigned via "Assign to Tr".
  const assignedOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        return loc === "WITH_DRIVER" || loc === "ASSIGNED";
      }),
    [deliveries],
  );

  const assignedTrOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        return loc === "ASSIGNED_TR";
      }),
    [deliveries],
  );

  const deliveredOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        const fin = String(o.financialStatus).toUpperCase();
        const isUnpaid = !o.driverPayoutId;
        // Exclude PS (Paid to Seller) — these orders have been printed in a
        // merchant statement and should only appear in universal orders /
        // merchant profile "All Orders" tab, not in the driver delivered tab.
        const isPaidToSeller = fin === "PS";
        return loc === "DELIVERED" && isUnpaid && !isPaidToSeller;
      }),
    [deliveries],
  );

  const returnedOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        const fin = String(o.financialStatus).toUpperCase();
        // Returns (RWD) and exchanges (EWD) both live in this tab
        return (
          (loc === "RETURN" || loc === "RETURNED") &&
          (fin === "RWD" || fin === "EWD")
        );
      }),
    [deliveries],
  );

  // ─── Paginated Lists per Tab ────────────────────────────────────────────
  const paginatedAssigned = useMemo(() => {
    const sorted = sortOrders(assignedOrders, "assigned");
    const start = (assignedPage - 1) * assignedItemsPerPage;
    return sorted.slice(start, start + assignedItemsPerPage);
  }, [assignedOrders, assignedPage, assignedItemsPerPage, sortConfig]);

  const paginatedAssignedTr = useMemo(() => {
    const sorted = sortOrders(assignedTrOrders, "assigned_tr");
    const start = (assignedTrPage - 1) * assignedTrItemsPerPage;
    return sorted.slice(start, start + assignedTrItemsPerPage);
  }, [assignedTrOrders, assignedTrPage, assignedTrItemsPerPage, sortConfig]);

  const paginatedDelivered = useMemo(() => {
    const sorted = sortOrders(deliveredOrders, "delivered");
    const start = (deliveredPage - 1) * deliveredItemsPerPage;
    return sorted.slice(start, start + deliveredItemsPerPage);
  }, [deliveredOrders, deliveredPage, deliveredItemsPerPage, sortConfig]);

  const paginatedReturned = useMemo(() => {
    const sorted = sortOrders(returnedOrders, "returns");
    const start = (returnsPage - 1) * returnsItemsPerPage;
    return sorted.slice(start, start + returnsItemsPerPage);
  }, [returnedOrders, returnsPage, returnsItemsPerPage, sortConfig]);

  const paginatedPayouts = useMemo(() => {
    const start = (payoutsPage - 1) * payoutsItemsPerPage;
    return payouts.slice(start, start + payoutsItemsPerPage);
  }, [payouts, payoutsPage, payoutsItemsPerPage]);

  // ─── Financial Aggregates ───────────────────────────────────────────────
  const assignedUsdSum = assignedOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd ?? 0),
    0,
  );
  const assignedLbpSum = assignedOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp ?? 0),
    0,
  );

  const assignedTrUsdSum = assignedTrOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd ?? 0),
    0,
  );
  const assignedTrLbpSum = assignedTrOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp ?? 0),
    0,
  );

  const totalDeliveredUsd = deliveredOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd ?? 0),
    0,
  );
  const totalDeliveredLbp = deliveredOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp ?? 0),
    0,
  );

  // ─── Commission Rate Table (authoritative module) ──────────────────────
  // Built once per driver from the already-loaded rate rows, with the same
  // precedence as every server-side ledger path: seller exception (cash-
  // seller wins, $0 is a valid override) → zone rate → MISSING (a missing
  // rate is a configuration error — there is no $0 default; ledger paths
  // fail closed, previews show "Rate not configured").
  const rateTable: DriverRateTable = useMemo(
    () =>
      buildRateTableFromRates(String(driver?.id ?? ""), {
        driverZoneRates: driver?.zoneRates || [],
        driverSellerRates: (sellerRates || []).map((sr) => ({
          merchantId: String(sr.merchantId),
          rateUsd: sr.rateUsd,
        })),
        driverCashSellerRates: (driver?.user?.driverCashSellerRates || []).map(
          (cr: { merchantId: unknown; rateUsd: number }) => ({
            merchantId: String(cr.merchantId),
            rateUsd: cr.rateUsd,
          }),
        ),
      }),
    [driver, sellerRates],
  );

  // Authoritative per-order commission for the payout preview (the same
  // module every ledger path uses): seller exception (cash wins) → zone
  // rate → MISSING. A configured $0 is a valid line; a missing rate is
  // counted and BLOCKS the payout — it is never silently treated as $0.
  const payoutBreakdown = useMemo(() => {
    const lines = new Map<
      string,
      { rateUsd: number; count: number; label: string }
    >();
    let commission = 0;
    let missingCount = 0;
    for (const o of deliveredOrders) {
      const b = computeOrderCommission(rateTable, {
        merchantId: o.merchantId ?? o.merchant?.id,
        zoneId: String(o.zoneId),
      });
      if (!b.ok) {
        missingCount++;
        continue;
      }
      commission += b.usd;
      const label =
        b.tier === "cashSeller"
          ? "Cash-seller rate"
          : b.tier === "seller"
            ? "Seller rate"
            : "Zone rate";
      const key = `${label}|${b.usd.toFixed(2)}`;
      const line = lines.get(key) ?? { rateUsd: b.usd, count: 0, label };
      line.count += 1;
      lines.set(key, line);
    }
    const commissionLines = Array.from(lines.values()).sort(
      (a, b) => b.rateUsd - a.rateUsd,
    );
    return { commission, missingCount, commissionLines };
  }, [deliveredOrders, rateTable]);

  const totalCommission = payoutBreakdown.commission;

  const netPayoutUsd = totalDeliveredUsd - totalCommission;

  // ─── Payout Button Visibility (Bulletproof) ───────────────────────────
  // The "Generate Payout" button is active if there is AT LEAST ONE delivered,
  // unpaid order. It pays out ALL delivered orders — no checkbox selection needed.
  const canGeneratePayout = deliveredOrders?.length > 0;

  const selectedWdOrders = useMemo(
    () =>
      deliveredOrders.filter((o: any) => {
        const selectedOrderIds = new Set(selectedOrders);
        return selectedOrderIds.has(o.id);
      }),
    [deliveredOrders, selectedOrders],
  );

  // Bulletproof disabled logic for the delivered-tab bulk actions
  const hasValidClearSelection = selectedWdOrders?.length > 0;

  const settlement = useMemo(() => {
    // Gross = collected when positive, else order amount (ledger rule).
    const totalCollectedUsd = selectedWdOrders.reduce(
      (sum: number, o) => sum + grossUsd(o),
      0,
    );
    const totalCollectedLbp = selectedWdOrders.reduce(
      (sum: number, o) => sum + grossLbp(o),
      0,
    );
    // Commission via the authoritative module — a missing rate is never
    // counted as $0; it blocks the clear-to-office submission.
    let commission = 0;
    let missingCount = 0;
    for (const o of selectedWdOrders) {
      const b = computeOrderCommission(rateTable, {
        merchantId: o.merchantId ?? o.merchant?.id,
        zoneId: String(o.zoneId ?? ""),
      });
      if (b.ok) commission += b.usd;
      else missingCount++;
    }
    const net = totalCollectedUsd - commission;
    return {
      totalCollectedUsd,
      totalCollectedLbp,
      commission,
      net,
      missingCount,
    };
  }, [selectedWdOrders, rateTable]);

  // ─── Payout-preview modal inputs ───────────────────────────────────────
  // Gross-based totals (not raw amount) so the modal preview matches the
  // server-computed payout totals exactly.
  const deliveredGrossUsd = deliveredOrders.reduce(
    (sum: number, o) => sum + grossUsd(o),
    0,
  );
  const deliveredGrossLbp = deliveredOrders.reduce(
    (sum: number, o) => sum + grossLbp(o),
    0,
  );

  // ─── Payout Submission ──────────────────────────────────────────────────
  const handleGeneratePayout = async () => {
    setSubmitting(true);
    try {
      const orderIds = deliveredOrders.map((o: any) => o.id);
      const res = await fetch(`/api/drivers/${driverId}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          commissionUsd: totalCommission,
          netUsd: netPayoutUsd,
        }),
      });
      if (res.ok) {
        setShowPayoutModal(false);
        await refreshData();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error ?? "Failed to create payout");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Return Delivered to Assigned / Warehouse (permission-gated) ─────────
  // Bulk action for the Delivered tab. Reuses the ACTION_ORDER_RETURN-gated
  // endpoint so delivered WO/WD orders can be rolled back to the driver's
  // assigned list (ASSIGNED/UD) or to the returns warehouse (RETURN/Re).
  const [returningDelivered, setReturningDelivered] = useState(false);
  const returnDeliveredOrders = async (
    targetLocation: "ASSIGNED" | "RETURN",
  ) => {
    if (selectedWdOrders.length === 0) return;
    const targetFinancialStatus = targetLocation === "ASSIGNED" ? "UD" : "Re";
    if (
      !window.confirm(
        `Return ${selectedWdOrders.length} delivered order(s) to ${
          targetLocation === "ASSIGNED"
            ? "the driver's assigned list"
            : "the warehouse (Returned / Re)"
        }?\n\nThis unlinks them from any payout and clears collected amounts.`,
      )
    )
      return;
    setReturningDelivered(true);
    try {
      const orderIds = selectedWdOrders.map((o: any) => o.id);
      const res = await fetch("/api/admin/orders/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          location: targetLocation,
          financialStatus: targetFinancialStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to return delivered orders");
      }
      setSelectedOrders([]);
      await refreshData();
    } catch (e: any) {
      alert(e.message || "Error returning delivered orders");
    } finally {
      setReturningDelivered(false);
    }
  };

  // ─── Shared Data Refresh ───────────────────────────────────────────────
  const refreshData = async () => {
    const [driverRes, payoutsRes, ratesRes] = await Promise.all([
      fetch(`/api/admin/drivers/${driverId}`),
      fetch(`/api/drivers/${driverId}/payouts`),
      fetch(`/api/admin/drivers/${driverId}/rates`),
    ]);
    setDriver(await driverRes.json());
    setPayouts(await payoutsRes.json());
    const ratesData = await ratesRes.json();
    setSellerRates(Array.isArray(ratesData) ? ratesData : []);
  };

  // ─── Bulk Selection Helpers ──────────────────────────────────────────────
  const toggleSelection = (orderId: string) => {
    setSelectedOrders((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId],
    );
  };

  const toggleSelectAll = (orderIds: string[]) => {
    if (selectedOrders.length === orderIds.length && orderIds.length > 0) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(orderIds);
    }
  };

  // ─── Bulk Action Handler ────────────────────────────────────────────────
  const handleBulkAction = async (newLocation: string) => {
    await Promise.all(
      selectedOrders.map((orderId) =>
        fetch(`/api/orders/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: orderId,
            location: newLocation,
            // Synchronize financialStatus so the UI filters match:
            // "Delivered" tab expects location === "DELIVERED" && financialStatus === "WD"
            ...(newLocation === "DELIVERED" && { financialStatus: "WD" }),
            ...(newLocation === "RETURN" && {
              financialStatus: "Re",
              status: "Re",
            }),
          }),
        }),
      ),
    );
    setSelectedOrders([]);
    await refreshData();
  };

  // ─── Transfer Between "Assigned - Dr" and "Assigned - Tr" ───────────────
  // Moves the selected orders directly between the two driver-held batches
  // (ASSIGNED/WITH_DRIVER ⇄ ASSIGNED_TR) without unassigning: the bulk
  // endpoint keeps driverId untouched and derives financialStatus (UD)
  // server-side. driverActionLog records a meaningful OrderHistory entry.
  const [transferringLocation, setTransferringLocation] = useState(false);
  const handleTransferLocation = async (
    targetLocation: "ASSIGNED" | "ASSIGNED_TR",
  ) => {
    if (selectedOrders.length === 0 || transferringLocation) return;
    setTransferringLocation(true);
    try {
      const res = await fetch("/api/orders/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedOrders.map((id) => ({
            id,
            location: targetLocation,
            driverActionLog:
              targetLocation === "ASSIGNED_TR"
                ? 'Moved to Transit: Location updated to "With driver - Tr"'
                : 'Moved to Regular: Location updated to "With driver"',
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to transfer orders");
      }
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      const failed = results.filter((r: any) => !r.success);
      if (failed.length > 0) {
        alert(
          `${results.length - failed.length} order(s) moved, ${failed.length} failed: ${failed[0].error || "Unknown error"}`,
        );
      }
      setSelectedOrders([]);
      await refreshData();
    } catch (e: any) {
      alert(e.message || "Transfer failed");
    } finally {
      setTransferringLocation(false);
    }
  };

  // ─── Bulk Return to Warehouse Handler (RWD -> Re) ───────────────────────
  const [returningToWarehouse, setReturningToWarehouse] = useState(false);
  const handleReturnToWarehouse = async () => {
    if (selectedOrders.length === 0) return;
    setReturningToWarehouse(true);
    try {
      const res = await fetch("/api/admin/orders/returns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrders, newStatus: "Re" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update returns");
      }
      setSelectedOrders([]);
      await refreshData();
    } catch (e: any) {
      alert(e.message || "Error updating returns");
    } finally {
      setReturningToWarehouse(false);
    }
  };

  // ─── Export Helpers ─────────────────────────────────────────────────────────
  const exportOrdersToExcel = async (orders: any[], filename: string) => {
    const XLSX = await import("xlsx");
    const rows = orders.map((o) => ({
      "Order ID": o.orderId,
      Customer: o.customerName,
      Phone: o.customerPhone || "",
      Address: o.customerAddress || "",
      Zone: o.zone?.name || "",
      Location: o.location,
      "Financial Status": o.financialStatus || "",
      "Amount USD": o.amountUsd ?? 0,
      "Amount LBP": o.amountLbp ?? 0,
      Merchant: o.merchant?.merchantName || o.merchantId || "",
      Driver: o.driver ? `${o.driver.firstName} ${o.driver.lastName}` : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  // Builds a download filename from the driver name and a tab label,
  // e.g. "John_Doe_all_orders" or "John_Doe_delivered".
  const driverFileName = (tabLabel: string) => {
    const name = [driver?.firstName, driver?.lastName]
      .filter(Boolean)
      .join("_")
      .replace(/\s+/g, "_");
    return `${name || driverId}_${tabLabel}`;
  };

  const openOrdersInNewTab = (orders: any[]) => {
    const orderIds = orders.map((o) => o.id).join(",");
    window.open(
      `/print/orders?ids=${orderIds}&driverId=${driverId}`,
      "_blank",
    );
  };

  // Opens the orders export page in a new tab. The PDF is downloaded from the
  // "Download PDF" button on that page; ?filename only presets its name.
  const downloadOrdersPdf = (orders: any[], filename: string) => {
    const orderIds = orders.map((o) => o.id).join(",");
    window.open(
      `/print/orders?ids=${orderIds}&driverId=${driverId}&filename=${encodeURIComponent(filename)}`,
      "_blank",
    );
  };

  // ─── Seller Flat Rate CRUD Handlers ────────────────────────────────────
  const openAddRateModal = () => {
    setEditingRate(null);
    setRateForm({ merchantId: "", rateUsd: "", rateLbp: "" });
    setShowRateModal(true);
  };

  const openEditRateModal = (rate: any) => {
    setEditingRate(rate);
    setRateForm({
      merchantId: rate.merchantId,
      rateUsd: String(rate.rateUsd ?? 0),
      rateLbp: String(rate.rateLbp ?? 0),
    });
    setShowRateModal(true);
  };

  const handleSaveRate = async () => {
    if (!rateForm.merchantId) return alert("Please select a seller.");
    setRateSaving(true);
    try {
      const body = {
        merchantId: rateForm.merchantId,
        rateUsd: parseFloat(rateForm.rateUsd) || 0,
        rateLbp: parseFloat(rateForm.rateLbp) || 0,
      };
      const url = `/api/admin/drivers/${driverId}/rates`;
      const method = editingRate ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingRate ? { ...body, rateId: editingRate.id } : body,
        ),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save rate");
      }
      setShowRateModal(false);
      // Refresh rates
      const ratesRes = await fetch(`/api/admin/drivers/${driverId}/rates`);
      setSellerRates(await ratesRes.json());
    } catch (e: any) {
      alert(e.message || "Error saving rate");
    } finally {
      setRateSaving(false);
    }
  };

  const handleDeleteRate = async (rateId: number) => {
    if (!window.confirm("Delete this seller flat rate exception?")) return;
    try {
      const res = await fetch(
        `/api/admin/drivers/${driverId}/rates?rateId=${rateId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
      setSellerRates((prev) => prev.filter((r) => r.id !== rateId));
    } catch (e: any) {
      alert(e.message || "Error deleting rate");
    }
  };

  const setStatementBox = (id: string, boxId: string) => {
    setStatementBoxes((prev) => ({ ...prev, [id]: boxId }));
  };

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

  // ─── Settlement Submit Handler ─────────────────────────────────────────
  // Same endpoint and payload as the "✓ Settle" button on /settlements:
  // records cash received + paid-by-driver statements, moves the payout to
  // PENDING_APPROVAL. Orders stay WD until approved on /cleared-payouts.
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
        setSettlementBoxId("");
        setSelectedStatementIds([]);
        setStatementBoxes({});
        await refreshData();
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

  // ─── Loading State ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-cyan-400 font-sans flex items-center justify-center">
        <p className="animate-pulse">Loading Driver Profile…</p>
      </div>
    );
  }

  // ─── Error / Not Found ──────────────────────────────────────────────────
  if (!driver || driver.error) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Driver Not Found</p>
        <button
          onClick={() => router.push("/drivers")}
          className="px-4 py-2 rounded border border-gray-700 text-gray-400 hover:bg-slate-800 transition-colors text-sm"
        >
          ← Back to Fleet
        </button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {driver.firstName} {driver.lastName}
            </h1>
            <p className="text-gray-400 text-sm mt-2">
              <span className="bg-[#121824] px-2 py-1 rounded border border-white/5 mr-2 font-mono text-cyan-400">
                ID: {driver.driverId || driver.id.slice(0, 8)}
              </span>
              {driver.user?.username && (
                <span className="text-gray-500">@{driver.user.username}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => router.push("/drivers")}
            className="px-4 py-2 rounded text-gray-400 hover:bg-slate-800 transition-colors border border-white/10 text-sm"
          >
            ← Back to Fleet
          </button>
        </div>

        {/* ── Top Metrics Bar ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Driver
            </p>
            <p className="text-white text-lg font-bold">
              {driver.firstName} {driver.lastName}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              ID: {driver.driverId || driver.id.slice(0, 8)}
            </p>
          </div>
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Assigned Orders (Dr)
            </p>
            <p className="text-cyan-400 text-2xl font-bold">
              {assignedOrders.length}
            </p>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-400 font-mono">
                ${assignedUsdSum.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {assignedLbpSum.toLocaleString()} LL
              </span>
            </div>
          </div>
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Assigned Orders (Tr)
            </p>
            <p className="text-amber-400 text-2xl font-bold">
              {assignedTrOrders.length}
            </p>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-400 font-mono">
                ${assignedTrUsdSum.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {assignedTrLbpSum.toLocaleString()} LL
              </span>
            </div>
          </div>
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Delivered Orders
            </p>
            <p className="text-green-400 text-2xl font-bold">
              {deliveredOrders.length}
            </p>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-400 font-mono">
                ${totalDeliveredUsd.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {totalDeliveredLbp.toLocaleString()} LL
              </span>
            </div>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 border-b border-white/10">
          {(
            [
              ["assigned", "Assigned - Dr"],
              ["assigned_tr", "Assigned - Tr"],
              ["delivered", "Delivered"],
              ["returns", "Returns/Exchange"],
              ["payouts", `Pending Payouts (${payouts.length})`],
              ["rates", `Seller Rates (${sellerRates.length})`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-5 py-3 text-sm font-semibold rounded-t-lg transition-colors ${
                activeTab === key
                  ? "bg-[#121824] text-cyan-400 border border-white/10 border-b-[#121824] -mb-[1px]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
              }`}
            >
              {label}
              {key === "assigned" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {assignedOrders.length}
                </span>
              )}
              {key === "assigned_tr" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {assignedTrOrders.length}
                </span>
              )}
              {key === "delivered" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400 border border-green-500/20">
                  {deliveredOrders.length}
                </span>
              )}
              {key === "returns" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-red-500/10 text-red-400 border border-red-500/20">
                  {returnedOrders.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: Assigned Orders ───────────────────────────────────── */}
        {activeTab === "assigned" && (
          <>
            {selectedOrders.length > 0 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">
                  {selectedOrders.length} of {assignedOrders.length} selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openOrdersInNewTab(assignedOrders)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    title="Open all in new tab"
                  >
                    🔗 All
                  </button>
                  <button
                    onClick={() =>
                      exportOrdersToExcel(
                        assignedOrders,
                        driverFileName("all_orders"),
                      )
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                    title="Download all as Excel"
                  >
                    📊 Excel
                  </button>
                  <button
                    onClick={() =>
                      downloadOrdersPdf(
                        assignedOrders,
                        driverFileName("all_orders"),
                      )
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                    title="Download all as PDF"
                  >
                    📑 PDF
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* ── Bulk Action Toolbar ──────────────────────────────────── */}
              {selectedOrders.length > 0 && (
                <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-cyan-500/5 flex-wrap">
                  <span className="text-sm text-gray-400">
                    {selectedOrders.length} selected
                  </span>
                  <button
                    onClick={() => handleTransferLocation("ASSIGNED_TR")}
                    disabled={transferringLocation}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors ${transferringLocation ? "opacity-40 cursor-not-allowed" : ""}`}
                    title="Move selected orders to the transit batch (Assigned - Tr)"
                  >
                    {transferringLocation ? "Moving…" : "🔁 Move to Tr"}
                  </button>
                  <button
                    onClick={() => handleBulkAction("DELIVERED")}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    🚚 Deliver
                  </button>
                  <button
                    onClick={() => handleBulkAction("WAREHOUSE")}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-yellow-600 hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-500/20"
                  >
                    📦 Return to Warehouse
                  </button>
                  <button
                    onClick={() => handleBulkAction("RETURN")}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 transition-colors shadow-lg shadow-red-500/20"
                  >
                    ↩ Return
                  </button>
                  <div className="flex items-center gap-1.5 ml-auto border-l border-white/10 pl-3">
                    <button
                      onClick={() => {
                        const sel = assignedOrders.filter((o: any) =>
                          selectedOrders.includes(o.id),
                        );
                        openOrdersInNewTab(sel);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                      title="Open printable orders export"
                    >
                      🖨️ Print
                    </button>
                  </div>
                </div>
              )}

              {/* Pagination Controls - Assigned */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Rows per page:</span>
                  <select
                    value={assignedItemsPerPage}
                    onChange={(e) => {
                      setAssignedItemsPerPage(Number(e.target.value));
                      setAssignedPage(1);
                    }}
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    {[50, 100, 200, 500, 1000].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="ml-2">
                    Showing{" "}
                    {assignedOrders.length
                      ? Math.min(
                          assignedPage * assignedItemsPerPage,
                          assignedOrders.length,
                        )
                      : 0}{" "}
                    of {assignedOrders.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAssignedPage((p) => Math.max(1, p - 1))}
                    disabled={assignedPage === 1}
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setAssignedPage((p) =>
                        p * assignedItemsPerPage < assignedOrders.length
                          ? p + 1
                          : p,
                      )
                    }
                    disabled={
                      assignedPage * assignedItemsPerPage >=
                      assignedOrders.length
                    }
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-5 py-4 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            assignedOrders.length > 0 &&
                            selectedOrders.length === assignedOrders.length
                          }
                          onChange={() =>
                            toggleSelectAll(
                              assignedOrders.map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <SortHeader tab="assigned" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="customerPhone">
                        Phone
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="location">
                        Location
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedAssigned.length === 0 &&
                    assignedOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No active assignments for this driver.
                        </td>
                      </tr>
                    ) : (
                      paginatedAssigned.map((order: any) => (
                        <tr
                          key={order.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <input
                              type="checkbox"
                              checked={selectedOrders.includes(order.id)}
                              onChange={() => toggleSelection(order.id)}
                              className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                            />
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() =>
                                  setHistoryModalOrder({
                                    id: order.id,
                                    history: order.history || [],
                                  })
                                }
                                title="Order History"
                                className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                              >
                                &#9776;
                              </button>
                              <span className="font-mono text-cyan-400 text-sm">
                                {order.orderId}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                            {formatDate(order.createdAt)}
                          </td>
                          <td className="px-5 py-3.5 text-white text-sm">
                            {order.merchant?.merchantName || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-white text-sm">
                            {order.customerName}
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm font-mono">
                            {order.customerPhone || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                            {order.customerAddress || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-gray-400 text-sm">
                            {order.zone?.name || "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`px-2 py-1 text-[10px] font-bold rounded border ${
                                order.location === "WITH_DRIVER"
                                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                  : order.location === "WAREHOUSE"
                                    ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                                    : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                              }`}
                            >
                              {order.location}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              {order.financialStatus || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                            ${(order.amountUsd ?? 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                            {(order.amountLbp ?? 0).toLocaleString()} LL
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Assigned - Tr (transit batch) ─────────────────────── */}
        {activeTab === "assigned_tr" && (
          <>
            {selectedOrders.length > 0 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">
                  {selectedOrders.length} of {assignedTrOrders.length} selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openOrdersInNewTab(assignedTrOrders)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    title="Open all in new tab"
                  >
                    🔗 All
                  </button>
                  <button
                    onClick={() =>
                      exportOrdersToExcel(
                        assignedTrOrders,
                        driverFileName("transit_orders"),
                      )
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                    title="Download all as Excel"
                  >
                    📊 Excel
                  </button>
                  <button
                    onClick={() =>
                      downloadOrdersPdf(
                        assignedTrOrders,
                        driverFileName("transit_orders"),
                      )
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                    title="Download all as PDF"
                  >
                    📑 PDF
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* ── Bulk Action Toolbar ──────────────────────────────────── */}
              {selectedOrders.length > 0 && (
                <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-amber-500/5 flex-wrap">
                  <span className="text-sm text-gray-400">
                    {selectedOrders.length} selected
                  </span>
                  <button
                    onClick={() => handleTransferLocation("ASSIGNED")}
                    disabled={transferringLocation}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors ${transferringLocation ? "opacity-40 cursor-not-allowed" : ""}`}
                    title="Move selected orders back to the regular batch (Assigned - Dr)"
                  >
                    {transferringLocation ? "Moving…" : "🔁 Move to Dr"}
                  </button>
                  <button
                    onClick={() => handleBulkAction("DELIVERED")}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    🚚 Deliver
                  </button>
                  <button
                    onClick={() => handleBulkAction("WAREHOUSE")}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-yellow-600 hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-500/20"
                  >
                    📦 Return to Warehouse
                  </button>
                  <button
                    onClick={() => handleBulkAction("RETURN")}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 transition-colors shadow-lg shadow-red-500/20"
                  >
                    ↩ Return
                  </button>
                  <div className="flex items-center gap-1.5 ml-auto border-l border-white/10 pl-3">
                    <button
                      onClick={() => {
                        const sel = assignedTrOrders.filter((o: any) =>
                          selectedOrders.includes(o.id),
                        );
                        openOrdersInNewTab(sel);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                      title="Open printable orders export"
                    >
                      🖨️ Print
                    </button>
                  </div>
                </div>
              )}

              {/* Pagination Controls - Assigned (Tr) */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Rows per page:</span>
                  <select
                    value={assignedTrItemsPerPage}
                    onChange={(e) => {
                      setAssignedTrItemsPerPage(Number(e.target.value));
                      setAssignedTrPage(1);
                    }}
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    {[50, 100, 200, 500, 1000].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="ml-2">
                    Showing{" "}
                    {assignedTrOrders.length
                      ? Math.min(
                          assignedTrPage * assignedTrItemsPerPage,
                          assignedTrOrders.length,
                        )
                      : 0}{" "}
                    of {assignedTrOrders.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAssignedTrPage((p) => Math.max(1, p - 1))}
                    disabled={assignedTrPage === 1}
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setAssignedTrPage((p) =>
                        p * assignedTrItemsPerPage < assignedTrOrders.length
                          ? p + 1
                          : p,
                      )
                    }
                    disabled={
                      assignedTrPage * assignedTrItemsPerPage >=
                      assignedTrOrders.length
                    }
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-5 py-4 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            assignedTrOrders.length > 0 &&
                            selectedOrders.length === assignedTrOrders.length
                          }
                          onChange={() =>
                            toggleSelectAll(
                              assignedTrOrders.map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <SortHeader tab="assigned_tr" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="customerPhone">
                        Phone
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="location">
                        Location
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="assigned_tr" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedAssignedTr.length === 0 &&
                    assignedTrOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No transit assignments for this driver.
                        </td>
                      </tr>
                    ) : (
                      paginatedAssignedTr.map((order: any) => (
                        <tr
                          key={order.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <input
                              type="checkbox"
                              checked={selectedOrders.includes(order.id)}
                              onChange={() => toggleSelection(order.id)}
                              className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                            />
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() =>
                                  setHistoryModalOrder({
                                    id: order.id,
                                    history: order.history || [],
                                  })
                                }
                                title="Order History"
                                className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                              >
                                &#9776;
                              </button>
                              <span className="font-mono text-cyan-400 text-sm">
                                {order.orderId}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                            {formatDate(order.createdAt)}
                          </td>
                          <td className="px-5 py-3.5 text-white text-sm">
                            {order.merchant?.merchantName || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-white text-sm">
                            {order.customerName}
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm font-mono">
                            {order.customerPhone || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                            {order.customerAddress || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-gray-400 text-sm">
                            {order.zone?.name || "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`px-2 py-1 text-[10px] font-bold rounded border ${
                                order.location === "ASSIGNED_TR"
                                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                  : order.location === "WITH_DRIVER"
                                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                    : order.location === "WAREHOUSE"
                                      ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                                      : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                              }`}
                            >
                              {order.location === "ASSIGNED_TR"
                                ? "With Driver - Tr"
                                : order.location}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              {order.financialStatus || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                            ${(order.amountUsd ?? 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                            {(order.amountLbp ?? 0).toLocaleString()} LL
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Delivered ─────────────────────────────────────────── */}
        {activeTab === "delivered" && (
          <>
            <div className="mb-4 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowPayoutModal(true)}
                disabled={!canGeneratePayout}
                className={`px-5 py-2.5 rounded-lg font-bold text-white bg-cyan-600 transition-colors text-sm shadow-lg shadow-cyan-500/20 ${!canGeneratePayout ? "opacity-50 cursor-not-allowed" : "hover:bg-cyan-500"}`}
              >
                ⚡ Generate Payout Batch
              </button>
              <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                <button
                  onClick={() => openOrdersInNewTab(deliveredOrders)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                  title="Open all in new tab"
                >
                  🔗 All
                </button>
                <button
                  onClick={() =>
                    exportOrdersToExcel(
                      deliveredOrders,
                      driverFileName("delivered"),
                    )
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                  title="Download all as Excel"
                >
                  📊 Excel
                </button>
                <button
                  onClick={() =>
                    downloadOrdersPdf(
                      deliveredOrders,
                      driverFileName("delivered"),
                    )
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                  title="Download all as PDF"
                >
                  📑 PDF
                </button>
              </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* ── Settlement Action Bar (sticky) ────────────────────────── */}
              <div
                className={`sticky top-0 z-10 flex flex-wrap items-center gap-4 px-5 py-4 border-b border-white/10 backdrop-blur-md ${hasValidClearSelection ? "bg-gradient-to-r from-emerald-500/10 to-cyan-500/10" : "bg-white/[0.02]"}`}
              >
                <span className="text-sm text-gray-300 font-semibold">
                  {selectedWdOrders.length} selected
                </span>

                <div className="flex items-center gap-4 text-xs font-mono ml-auto">
                  <div className="text-center">
                    <p className="text-gray-500">Total Collected</p>
                    <p className="text-green-400 font-bold">
                      ${settlement.totalCollectedUsd.toFixed(2)}
                    </p>
                    <p className="text-yellow-400">
                      {settlement.totalCollectedLbp.toLocaleString()} LL
                    </p>
                  </div>

                  <span className="text-gray-600">−</span>

                  <div className="text-center">
                    <p className="text-gray-500">Commission</p>
                    <p className="text-red-400 font-bold">
                      −${settlement.commission.toFixed(2)}
                    </p>
                  </div>

                  <span className="text-gray-600">=</span>

                  <div className="text-center">
                    <p className="text-gray-500">Net to Office</p>
                    <p className="text-cyan-400 font-bold text-sm">
                      ${settlement.net.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 border-l border-white/10 pl-3 ml-2">
                  <button
                    onClick={() => openOrdersInNewTab(selectedWdOrders)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    title="Open printable orders export"
                  >
                    🖨️ Print
                  </button>
                </div>
                {/* ── Return selected delivered orders (permission-gated) ── */}
                {/* Both return actions are grouped together so they read as a
                    cohesive pair: Return to Assigned right next to Return to
                    Warehouse. */}
                <PermissionGuard requires="ACTION_ORDER_RETURN">
                  <div className="flex items-center gap-1.5 border-l border-white/10 pl-3 ml-2">
                    <button
                      onClick={() => returnDeliveredOrders("ASSIGNED")}
                      disabled={!hasValidClearSelection || returningDelivered}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors ${!hasValidClearSelection || returningDelivered ? "opacity-40 cursor-not-allowed" : ""}`}
                      title="Return selected delivered orders to the driver's assigned list"
                    >
                      {returningDelivered
                        ? "Updating…"
                        : "↩ Return to Assigned"}
                    </button>
                    <button
                      onClick={() => returnDeliveredOrders("RETURN")}
                      disabled={!hasValidClearSelection || returningDelivered}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 transition-colors ${!hasValidClearSelection || returningDelivered ? "opacity-40 cursor-not-allowed" : ""}`}
                      title="Return selected delivered (WO/WD) orders to the warehouse (Returned / Re)"
                    >
                      {returningDelivered
                        ? "Updating…"
                        : "📦 Return to Warehouse"}
                    </button>
                  </div>
                </PermissionGuard>
              </div>

              {/* Pagination Controls - Delivered */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Rows per page:</span>
                  <select
                    value={deliveredItemsPerPage}
                    onChange={(e) => {
                      setDeliveredItemsPerPage(Number(e.target.value));
                      setDeliveredPage(1);
                    }}
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    {[50, 100, 200, 500, 1000].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="ml-2">
                    Showing{" "}
                    {deliveredOrders.length
                      ? Math.min(
                          deliveredPage * deliveredItemsPerPage,
                          deliveredOrders.length,
                        )
                      : 0}{" "}
                    of {deliveredOrders.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDeliveredPage((p) => Math.max(1, p - 1))}
                    disabled={deliveredPage === 1}
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setDeliveredPage((p) =>
                        p * deliveredItemsPerPage < deliveredOrders.length
                          ? p + 1
                          : p,
                      )
                    }
                    disabled={
                      deliveredPage * deliveredItemsPerPage >=
                      deliveredOrders.length
                    }
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-5 py-4 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            deliveredOrders.length > 0 &&
                            selectedOrders.length ===
                              deliveredOrders.filter(
                                (o: any) => !o.driverPayoutId,
                              ).length
                          }
                          onChange={() =>
                            toggleSelectAll(
                              deliveredOrders
                                .filter((o: any) => !o.driverPayoutId)
                                .map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <SortHeader tab="delivered" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDelivered.length === 0 &&
                    deliveredOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No delivered orders awaiting payout.
                        </td>
                      </tr>
                    ) : (
                      paginatedDelivered.map((order: any) => {
                        const isPayoutLocked = !!order.driverPayoutId;
                        return (
                          <tr
                            key={order.id}
                            className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${
                              isPayoutLocked ? "opacity-50" : ""
                            }`}
                          >
                            <td className="px-5 py-3.5">
                              <input
                                type="checkbox"
                                checked={selectedOrders.includes(order.id)}
                                onChange={() => toggleSelection(order.id)}
                                disabled={isPayoutLocked}
                                className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0 disabled:opacity-30 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() =>
                                    setHistoryModalOrder({
                                      id: order.id,
                                      history: order.history || [],
                                    })
                                  }
                                  title="Order History"
                                  className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                                >
                                  &#9776;
                                </button>
                                <span className="font-mono text-cyan-400 text-sm">
                                  {order.orderId}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                              {formatDate(order.createdAt)}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.merchant?.merchantName || "—"}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.customerName}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                              {order.customerAddress || "—"}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-sm">
                              {order.zone?.name || "—"}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="px-2 py-1 text-[10px] font-bold rounded bg-green-500/10 text-green-400 border border-green-500/20">
                                {order.financialStatus}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                              ${(order.amountUsd ?? 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                              {(order.amountLbp ?? 0).toLocaleString()} LL
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Returns ───────────────────────────────────────────── */}
        {activeTab === "returns" && (
          <>
            {/* ── Bulk Action Toolbar ──────────────────────────────────── */}
            {selectedOrders.length > 0 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">
                  {selectedOrders.length} of {returnedOrders.length} selected
                </span>
                <button
                  onClick={handleReturnToWarehouse}
                  disabled={returningToWarehouse}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 transition-colors shadow-lg shadow-orange-500/20 ${returningToWarehouse ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {returningToWarehouse
                    ? "Updating…"
                    : "📦 Add to return's warehouse"}
                </button>
                <div className="flex items-center gap-1.5 ml-auto border-l border-white/10 pl-3">
                  <button
                    onClick={() => {
                      const sel = returnedOrders.filter((o: any) =>
                        selectedOrders.includes(o.id),
                      );
                      const orderIds = sel.map((o: any) => o.id).join(",");
                      window.open(`/orders/print?ids=${orderIds}`, "_blank");
                    }}
                    title="Print waybills for the selected orders"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                  >
                    🖨️ Print Waybill
                  </button>
                  <button
                    onClick={() => {
                      const sel = returnedOrders.filter((o: any) =>
                        selectedOrders.includes(o.id),
                      );
                      exportOrdersToExcel(sel, driverFileName("returns"));
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                  >
                    📊 Excel
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* Pagination Controls - Returns */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Rows per page:</span>
                  <select
                    value={returnsItemsPerPage}
                    onChange={(e) => {
                      setReturnsItemsPerPage(Number(e.target.value));
                      setReturnsPage(1);
                    }}
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    {[50, 100, 200, 500, 1000].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="ml-2">
                    Showing{" "}
                    {returnedOrders.length
                      ? Math.min(
                          returnsPage * returnsItemsPerPage,
                          returnedOrders.length,
                        )
                      : 0}{" "}
                    of {returnedOrders.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setReturnsPage((p) => Math.max(1, p - 1))}
                    disabled={returnsPage === 1}
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() =>
                      setReturnsPage((p) =>
                        p * returnsItemsPerPage < returnedOrders.length
                          ? p + 1
                          : p,
                      )
                    }
                    disabled={
                      returnsPage * returnsItemsPerPage >= returnedOrders.length
                    }
                    className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-5 py-4 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            returnedOrders.length > 0 &&
                            selectedOrders.length === returnedOrders.length
                          }
                          onChange={() =>
                            toggleSelectAll(
                              returnedOrders.map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <SortHeader tab="returns" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="location">
                        Location
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedReturned.length === 0 &&
                    returnedOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={11}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No returned orders currently with this driver.
                        </td>
                      </tr>
                    ) : (
                      paginatedReturned.map((order: any) => (
                        <tr
                          key={order.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <input
                              type="checkbox"
                              checked={selectedOrders.includes(order.id)}
                              onChange={() => toggleSelection(order.id)}
                              className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                            />
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() =>
                                  setHistoryModalOrder({
                                    id: order.id,
                                    history: order.history || [],
                                  })
                                }
                                title="Order History"
                                className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                              >
                                &#9776;
                              </button>
                              <span className="font-mono text-cyan-400 text-sm">
                                {order.orderId}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                            {formatDate(order.createdAt)}
                          </td>
                          <td className="px-5 py-3.5 text-white text-sm">
                            {order.merchant?.merchantName || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-white text-sm">
                            {order.customerName}
                          </td>
                          <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                            {order.customerAddress || "—"}
                          </td>
                          <td className="px-5 py-3.5 text-gray-400 text-sm">
                            {order.zone?.name || "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-red-500/10 text-red-400 border border-red-500/20">
                              {order.location}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                              {order.financialStatus === "EWD" ? "EWD" : "RWD"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-red-400 font-mono text-sm">
                            ${(order.amountUsd ?? 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                            {(order.amountLbp ?? 0).toLocaleString()} LL
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Pending Payouts ───────────────────────────────────── */}
        {activeTab === "payouts" && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
            {/* Pagination Controls - Payouts */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Rows per page:</span>
                <select
                  value={payoutsItemsPerPage}
                  onChange={(e) => {
                    setPayoutsItemsPerPage(Number(e.target.value));
                    setPayoutsPage(1);
                  }}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-cyan-500 focus:border-cyan-500"
                >
                  {[50, 100, 200, 500, 1000].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="ml-2">
                  Showing{" "}
                  {payouts.length
                    ? Math.min(
                        payoutsPage * payoutsItemsPerPage,
                        payouts.length,
                      )
                    : 0}{" "}
                  of {payouts.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPayoutsPage((p) => Math.max(1, p - 1))}
                  disabled={payoutsPage === 1}
                  className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setPayoutsPage((p) =>
                      p * payoutsItemsPerPage < payouts.length ? p + 1 : p,
                    )
                  }
                  disabled={payoutsPage * payoutsItemsPerPage >= payouts.length}
                  className="px-3 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold">Payout ID</th>
                    <th className="px-5 py-4 font-semibold">Date</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Total USD
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Total LBP
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Commission
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Prev. Debt
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Net USD
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Orders
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayouts.length === 0 && payouts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No pending payout batches for this driver.
                      </td>
                    </tr>
                  ) : (
                    paginatedPayouts.map((payout: any) => {
                      const ordersNet =
                        (payout.netUsd || 0) - (payout.previousDebtUsd || 0);
                      const hasPreviousDebt =
                        (payout.previousDebtUsd || 0) > 0.01;
                      return (
                        <tr
                          key={payout.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3.5 font-mono text-cyan-400 text-sm">
                            {driver.driverId}-
                            {String(payout.sequentialIndex || 1).padStart(
                              2,
                              "0",
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm">
                            {new Date(payout.createdAt).toLocaleString(
                              "en-US",
                              {
                                timeZone: "Asia/Beirut",
                                dateStyle: "medium",
                                timeStyle: "short",
                              },
                            )}
                            {payout.createdBy?.username && (
                              <span className="block text-gray-600 text-xs">
                                by {payout.createdBy.username}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                              {payout.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                            ${(payout.totalUsd || 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                            {(payout.totalLbp || 0).toLocaleString()} LL
                          </td>
                          <td className="px-5 py-3.5 text-right text-red-400 font-mono text-sm">
                            -${(payout.commissionUsd || 0).toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-sm">
                            {hasPreviousDebt ? (
                              <span className="text-red-400">
                                +${(payout.previousDebtUsd || 0).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-gray-600">$0.00</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-sm">
                            <div className="flex flex-col items-end gap-0.5">
                              {hasPreviousDebt && (
                                <span className="text-[10px] text-gray-500">
                                  Orders: ${ordersNet.toFixed(2)}
                                </span>
                              )}
                              <span
                                className={`font-bold ${hasPreviousDebt ? "text-cyan-400 text-xs" : "text-cyan-400"}`}
                              >
                                ${(payout.netUsd || 0).toFixed(2)}
                              </span>
                              {hasPreviousDebt && (
                                <span className="text-[10px] text-red-400">
                                  +$
                                  {(payout.previousDebtUsd || 0).toFixed(
                                    2,
                                  )}{" "}
                                  prev. debt
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right text-gray-400 text-sm">
                            {payout.orders?.length || 0}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex gap-1.5 justify-end">
                              <button
                                onClick={() => {
                                  setSettlementModal(payout);
                                  setSettlementBoxId("");
                                  setSelectedStatementIds([]);
                                  setStatementBoxes({});
                                  setSettlementAmountPaid(payout.netUsd || 0);
                                }}
                                className="px-3 py-1.5 rounded text-xs font-semibold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/40 transition-colors"
                              >
                                Receive Cash & Clear
                              </button>
                              <button
                                onClick={() => setSelectedPayout(payout)}
                                className="px-3 py-1.5 rounded text-xs font-semibold bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/40 transition-colors"
                              >
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab: Seller Flat Rate Exceptions ─────────────────────────── */}
        {activeTab === "rates" && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="text-white font-semibold text-sm">
                  Seller Flat Rate Exceptions
                </h3>
                <p className="text-gray-500 text-xs mt-0.5">
                  Custom flat rates override zone-based commission for specific
                  sellers.
                </p>
              </div>
              <button
                onClick={openAddRateModal}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 transition-colors shadow-lg shadow-cyan-500/20"
              >
                + Add Exception
              </button>
            </div>

            {/* Inline Seller Rate Exception Form */}
            <SellerRateForm driverId={driverId} merchants={merchants} />

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold">Seller</th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Rate USD
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Rate LBP
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sellerRates.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No seller-specific flat rate exceptions configured.
                      </td>
                    </tr>
                  ) : (
                    sellerRates.map((rate: any) => (
                      <tr
                        key={rate.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-5 py-3.5 text-white text-sm">
                          {rate.merchant?.merchantName ||
                            `Seller #${rate.merchant?.merchantId || rate.merchantId}`}
                        </td>
                        <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                          ${(rate.rateUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                          {(rate.rateLbp ?? 0).toLocaleString()} LL
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => openEditRateModal(rate)}
                              className="px-3 py-1.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteRate(rate.id)}
                              className="px-3 py-1.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Rate Add/Edit Modal */}
            {showRateModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
                  <h2 className="text-xl font-bold text-white mb-1">
                    {editingRate
                      ? "Edit Flat Rate Exception"
                      : "Add Flat Rate Exception"}
                  </h2>
                  <p className="text-gray-400 text-sm mb-6">
                    Set a custom flat commission rate for a specific seller.
                  </p>

                  <div className="space-y-4 mb-6">
                    {/* Seller Dropdown */}
                    <div>
                      <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                        Seller
                      </label>
                      <select
                        value={rateForm.merchantId}
                        onChange={(e) =>
                          setRateForm((prev) => ({
                            ...prev,
                            merchantId: e.target.value,
                          }))
                        }
                        disabled={!!editingRate}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm disabled:opacity-50"
                      >
                        <option value="">Select a seller…</option>
                        {merchants.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.merchantName} (#{m.merchantId})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Rate USD */}
                    <div>
                      <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                        Flat Rate USD
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 4.00"
                        value={rateForm.rateUsd}
                        onChange={(e) =>
                          setRateForm((prev) => ({
                            ...prev,
                            rateUsd: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
                      />
                    </div>

                    {/* Rate LBP */}
                    <div>
                      <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                        Flat Rate LBP
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="e.g. 120000"
                        value={rateForm.rateLbp}
                        onChange={(e) =>
                          setRateForm((prev) => ({
                            ...prev,
                            rateLbp: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowRateModal(false)}
                      disabled={rateSaving}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveRate}
                      disabled={rateSaving}
                      className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-cyan-500/20"
                    >
                      {rateSaving
                        ? "Saving…"
                        : editingRate
                          ? "Update Rate"
                          : "Add Rate"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── View Payout Details Modal ───────────────────────────────── */}
        {selectedPayout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6 mx-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Payout Details
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    {driver.driverId}-
                    {String(selectedPayout.sequentialIndex || 1).padStart(
                      2,
                      "0",
                    )}{" "}
                    &middot;{" "}
                    {new Date(selectedPayout.createdAt).toLocaleString(
                      "en-US",
                      {
                        timeZone: "Asia/Beirut",
                        dateStyle: "medium",
                        timeStyle: "short",
                      },
                    )}
                    {selectedPayout.createdBy?.username && (
                      <> · by {selectedPayout.createdBy.username}</>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPayout(null)}
                  className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Financial Summary */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Total USD
                  </p>
                  <p className="text-green-400 font-mono text-sm font-bold">
                    ${(selectedPayout.totalUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Commission
                  </p>
                  <p className="text-red-400 font-mono text-sm font-bold">
                    -${(selectedPayout.commissionUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Orders Net
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    $
                    {(
                      (selectedPayout.netUsd || 0) -
                      (selectedPayout.previousDebtUsd || 0)
                    ).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Net USD
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    ${(selectedPayout.netUsd || 0).toFixed(2)}
                  </p>
                  {(selectedPayout.previousDebtUsd || 0) > 0.01 && (
                    <p className="text-red-400 text-[10px] mt-0.5">
                      +${(selectedPayout.previousDebtUsd || 0).toFixed(2)} prev.
                      debt
                    </p>
                  )}
                </div>
              </div>

              {/* Orders List */}
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                Linked Orders ({selectedPayout.orders?.length || 0})
              </h3>
              <div className="bg-[#0B0F17] border border-white/5 rounded-lg overflow-hidden mb-6">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 uppercase tracking-wider">
                      <th className="px-4 py-2.5 font-semibold">Order ID</th>
                      <th className="px-4 py-2.5 font-semibold">
                        Date Received
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Seller</th>
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-4 py-2.5 font-semibold">Phone</th>
                      <th className="px-4 py-2.5 font-semibold">Address</th>
                      <th className="px-4 py-2.5 font-semibold">Zone</th>
                      <th className="px-4 py-2.5 font-semibold">Fin. Status</th>
                      <th className="px-4 py-2.5 font-semibold">Location</th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        $ Amt
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        LL Amt
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        $ Collected
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        Commission
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPayout.orders || []).length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="text-center py-6 text-gray-500 italic"
                        >
                          No orders linked to this payout.
                        </td>
                      </tr>
                    ) : (
                      (selectedPayout.orders || []).map((order: any) => {
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
                            className={`border-b border-white/5 ${
                              isMismatched
                                ? "bg-yellow-500/20"
                                : "hover:bg-white/[0.02]"
                            }`}
                          >
                            <td className="px-4 py-2.5 font-mono text-cyan-400">
                              {order.orderId}
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                              {formatDate(order.createdAt)}
                            </td>
                            <td className="px-4 py-2.5 text-white">
                              {order.merchant?.merchantName || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-white">
                              {order.customerName}
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs font-mono whitespace-nowrap">
                              {order.customerPhone || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs max-w-[160px] truncate">
                              {order.customerAddress || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">
                              {order.zone?.name || "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-white/5 border border-white/10">
                                {order.financialStatus || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">
                              {order.location || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-green-400 font-mono">
                              ${(order.amountUsd ?? 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-yellow-400/80 font-mono">
                              {(order.amountLbp ?? 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right text-green-300 font-mono">
                              ${actualCollectedUsd.toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-purple-400 font-mono">
                              {order.driverCommissionUsd == null
                                ? "—"
                                : `$${order.driverCommissionUsd.toFixed(2)}`}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  onClick={async () => {
                                    const res = await fetch(
                                      `/api/drivers/payouts/items/${order.id}`,
                                      { method: "POST" },
                                    );
                                    if (res.ok) {
                                      const data = await res.json();
                                      if (data.deleted) {
                                        // Last order — close modal entirely
                                        setSelectedPayout(null);
                                      } else {
                                        // Orders remain — filter out the removed order locally
                                        setSelectedPayout((prev: any) => {
                                          if (!prev) return prev;
                                          const updatedOrders = (
                                            prev.orders || []
                                          ).filter(
                                            (o: any) => o.id !== order.id,
                                          );
                                          // Recalculate displayed totals from remaining orders
                                          const newTotalUsd =
                                            updatedOrders.reduce(
                                              (s: number, o: any) =>
                                                s + (o.amountUsd ?? 0),
                                              0,
                                            );
                                          const newTotalLbp =
                                            updatedOrders.reduce(
                                              (s: number, o: any) =>
                                                s + (o.amountLbp ?? 0),
                                              0,
                                            );
                                          return {
                                            ...prev,
                                            orders: updatedOrders,
                                            totalUsd: newTotalUsd,
                                            totalLbp: newTotalLbp,
                                            netUsd: data.netUsd ?? prev.netUsd,
                                            commissionUsd:
                                              data.commissionUsd ??
                                              prev.commissionUsd,
                                          };
                                        });
                                      }
                                      await refreshData();
                                    } else {
                                      const err = await res.json().catch(() => null);
                                      alert(err?.error ?? "Failed to remove order from payout");
                                    }
                                  }}
                                  className="px-2 py-1 rounded text-[10px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                                >
                                  Return to Driver
                                </button>
                                <button className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                                  Edit Price
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Read-only footer: settlement + approval happen elsewhere */}
              <div className="flex gap-3 items-center">
                <div className="flex-1 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                  <p className="text-amber-400 text-xs">
                    This payout is <strong>PENDING</strong>. Record the cash
                    received with{" "}
                    <strong className="text-amber-300">
                      {'"Receive Cash & Clear"'}
                    </strong>{" "}
                    in the Payouts tab, then approve it on the{" "}
                    <strong className="text-amber-300">Cleared Payouts</strong>{" "}
                    page. Orders stay <strong>WD</strong> until approved.
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPayout(null)}
                  className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Settlement Modal (Receive Cash & Clear) ─────────────────── */}
        {settlementModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 mx-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Receive Cash & Clear
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    {driver.driverId}-
                    {String(settlementModal.sequentialIndex || 1).padStart(
                      2,
                      "0",
                    )}{" "}
                    &middot;{" "}
                    {new Date(settlementModal.createdAt).toLocaleString(
                      "en-US",
                      {
                        timeZone: "Asia/Beirut",
                        dateStyle: "medium",
                        timeStyle: "short",
                      },
                    )}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSettlementModal(null);
                    setSettlementBoxId("");
                  }}
                  className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Read-only Summary */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Payout Batch #
                  </p>
                  <p className="text-white font-mono text-sm font-bold">
                    {driver.driverId}-
                    {String(settlementModal.sequentialIndex || 1).padStart(
                      2,
                      "0",
                    )}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Total Orders
                  </p>
                  <p className="text-white font-mono text-sm font-bold">
                    {settlementModal.orders?.length || 0}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Net Payout Amount
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    ${(settlementModal.netUsd || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Treasury Box Dropdown */}
              <div className="mb-4">
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                  Treasury Box
                </label>
                <select
                  value={settlementBoxId}
                  onChange={(e) => setSettlementBoxId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
                >
                  <option value="">-- Select a Treasury Box --</option>
                  {treasuryBoxes.map((box: any) => (
                    <option key={box.id} value={box.id}>
                      {box.name} {box.isPositive ? "(Asset)" : "(Liability)"} —
                      ${(box.balanceUsd ?? 0).toFixed(2)}
                    </option>
                  ))}
                </select>
                {!settlementBoxId && (
                  <p className="text-xs text-red-400 mt-1">
                    A treasury box must be selected.
                  </p>
                )}
              </div>

              {/* Statements Paid by Driver (deducted from payout) — identical
                  to the /settlements modal */}
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
                                {treasuryBoxes.map((box: any) => (
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

              {/* Amount Paid Input */}
              <div className="mb-4">
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
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
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm font-mono"
                />
              </div>

              {/* Remaining Debt Display (net of paid-by-driver statements) */}
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
                  <div
                    className={`rounded-lg p-4 text-center mb-6 ${
                      hasDeficit
                        ? "bg-red-900/30 border border-red-500/40"
                        : hasOverpay
                          ? "bg-amber-900/30 border border-amber-500/40"
                          : "bg-green-900/30 border border-green-500/40"
                    }`}
                  >
                    <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                      Remaining Debt
                    </p>
                    <p
                      className={`text-2xl font-bold font-mono ${
                        hasDeficit
                          ? "text-red-400"
                          : hasOverpay
                            ? "text-amber-400"
                            : "text-green-400"
                      }`}
                    >
                      ${remaining.toFixed(2)}
                    </p>
                    {hasDeficit && (
                      <p className="text-xs text-red-300 mt-1">
                        This deficit will be carried over to the driver's next
                        payout.
                      </p>
                    )}
                    {hasOverpay && (
                      <p className="text-xs text-amber-300 mt-1">
                        Overpayment — ${Math.abs(remaining).toFixed(2)} excess.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Warning note (same as /settlements modal) */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <p className="text-amber-400 text-xs">
                  ⚠ This moves the payout to{" "}
                  <strong className="text-amber-300">PENDING APPROVAL</strong>.
                  On approval it becomes SETTLED, all orders are set to{" "}
                  <strong className="text-amber-300">WO (With Office)</strong>,
                  the <strong className="text-amber-300">full payout</strong> is
                  posted to the selected cashbox, each paid statement is posted
                  to its own cashbox, and the statements are marked{" "}
                  <strong className="text-amber-300">PAID</strong>.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSettlementModal(null);
                    setSettlementBoxId("");
                    setSelectedStatementIds([]);
                    setStatementBoxes({});
                  }}
                  disabled={settling}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
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
                  {settling ? "Processing…" : "✓ Confirm Settlement"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Payout Confirmation Modal ──────────────────────────────── */}
        {showPayoutModal && (
          <ConfirmPayoutModal
            orders={deliveredOrders}
            totalUsd={deliveredGrossUsd}
            totalLbp={deliveredGrossLbp}
            carriedDebtUsd={driver?.carriedDebtUsd ?? 0}
            carriedDebtLbp={driver?.carriedDebtLbp ?? 0}
            commissionLines={payoutBreakdown.commissionLines}
            totalCommissionUsd={payoutBreakdown.commission}
            missingRateOrderCount={payoutBreakdown.missingCount}
            onConfirm={handleGeneratePayout}
            onCancel={() => setShowPayoutModal(false)}
            submitting={submitting}
          />
        )}

        {/* ── Order History Modal ────────────────────────────────────── */}
        {historyModalOrder && (
          <OrderHistoryModal
            orderId={historyModalOrder.id}
            initialHistory={historyModalOrder.history}
            onClose={() => setHistoryModalOrder(null)}
          />
        )}
      </div>
    </div>
  );
}
