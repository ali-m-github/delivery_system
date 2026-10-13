"use client";

import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import OrderHistoryModal from "@/components/OrderHistoryModal";
import OrderDetailsModal from "@/components/OrderDetailsModal";
import CopyOrderId from "@/components/CopyOrderId";
import ImportGoogleSheetsModal from "@/components/orders/ImportGoogleSheetsModal";
import NotificationBell from "@/components/merchant/NotificationBell";
import {
  SortableTh,
  getOrderSortValue,
  compareSortValues,
} from "@/components/SharedOrderTable";
import { styleWorksheet, downloadWorkbook } from "@/lib/excel-export";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Order {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  zone: { id: string; name: string } | null;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  location: string;
  financialStatus: string;
  notes: string | null;
  packages: number;
  trackToken?: string | null;
  // Cash-seller payout linkage (present for every order).
  cashPayoutBatchId: number | null;
  returnDeductionBatchId: number | null;
  cashPayoutExcluded: boolean;
  // Chain-of-custody pickup batch linkage (null when not in a batch).
  pickupBatchId: string | null;
  createdAt: string;
}

// ─── Pickup batch (chain-of-custody) types ──────────────────────────────────
interface PickupBatchOrderItem {
  id: string;
  orderId: string;
  customerName: string;
  location: string;
  financialStatus: string;
}

interface PickupBatchRecord {
  id: string;
  batchNumber: string;
  status: string;
  totalOrders: number;
  pickedUpCount: number;
  receivedCount: number;
  discrepancyNote: string | null;
  createdAt: string;
  driver: { id: string; firstName: string; lastName: string } | null;
  orders: PickupBatchOrderItem[];
}

interface MerchantPayout {
  id: string;
  sequentialIndex: number;
  totalUsd: number;
  totalLbp: number;
  shippingUsd: number;
  shippingLbp: number;
  netUsd: number;
  netLbp: number;
  status: string;
  createdAt: string;
}

interface CashPayoutBatchOrder {
  id: string;
  orderId: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  amountUsd: number;
  amountLbp?: number;
  collectedUsd?: number;
  collectedLbp?: number;
  location?: string;
  financialStatus?: string;
  zone?: { id: string; name: string };
  driver?: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

interface CashPayoutBatch {
  id: number;
  batchReference: string;
  grossAdvance: number;
  deductedReturns: number;
  netPaid: number;
  createdAt: string;
  orders: CashPayoutBatchOrder[];
  resolvedReturns: CashPayoutBatchOrder[];
}

interface ZoneRate {
  id: string;
  zoneId: string;
  rate: number;
  zone: { id: string; name: string };
}

interface MerchantData {
  id: string;
  merchantId: number;
  merchantName: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  isCashSeller: boolean;
  createdAt: string;
  sheetImportConfig: {
    startRow?: number;
    colMapping?: Record<string, number>;
  } | null;
  zoneRates: ZoneRate[];
  orders: Order[];
}

interface MerchantClientProps {
  merchant: MerchantData;
  payouts: MerchantPayout[];
  cashBatches: CashPayoutBatch[];
}

type TabKey = "deliveries" | "newOrder" | "statements" | "pickupBatches";

// Status badge styling for pickup batches (merchant history tab).
const PICKUP_STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: {
    label: "Pending Pickup",
    cls: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  },
  PICKED_UP: {
    label: "Picked Up",
    cls: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  },
  COMPLETED: {
    label: "At Warehouse",
    cls: "bg-green-500/10 text-green-400 border-green-500/30",
  },
  DISCREPANCY: {
    label: "Discrepancy",
    cls: "bg-red-500/10 text-red-300 border-red-500/30",
  },
};

// Human-readable per-item custody stage shown in the reconciliation log.
function pickupItemStatusLabel(location: string): string {
  switch (location) {
    case "CP":
      return "At Seller";
    case "PICKED_UP":
      return "With Driver";
    case "WAREHOUSE":
      return "At Warehouse";
    case "DELIVERED":
      return "Delivered";
    case "RETURNED":
      return "Returned";
    default:
      return location;
  }
}

// Merchants whose auto-generated Order ID preview in the Order Entry form is
// click-to-copy (their staff paste IDs straight into their own sheets).
// All other merchants see the plain read-only field.
const COPYABLE_PREVIEW_ID_MERCHANT_IDS = new Set([2]); // 2 = Electroni

// ─── Excel export column definitions ─────────────────────────────────────────
// Mirrors the admin-side EXPORT_COLUMNS pattern in app/orders/page.tsx: each
// entry drives both the column-selection modal and the actual export, so
// adding a new exportable column only requires adding one definition here.
// Scoped to fields available on the merchant Order type.
const MERCHANT_EXPORT_COLUMNS: {
  key: string;
  label: string;
  header: string;
  width: number;
  value: (order: Order) => string | number | Date;
}[] = [
  {
    key: "orderId",
    label: "Order ID",
    header: "Order ID",
    width: 15,
    value: (o) => o.orderId,
  },
  {
    key: "date",
    label: "Date",
    header: "Date",
    width: 15,
    value: (o) => new Date(o.createdAt),
  },
  {
    key: "customer",
    label: "Customer",
    header: "Customer",
    width: 25,
    value: (o) => o.customerName,
  },
  {
    key: "phone",
    label: "Tel Number",
    header: "Tel Number",
    width: 18,
    value: (o) => o.customerPhone || "—",
  },
  {
    key: "address",
    label: "Address",
    header: "Address",
    width: 35,
    value: (o) => o.customerAddress || "—",
  },
  {
    key: "zone",
    label: "Zone",
    header: "Zone",
    width: 12,
    value: (o) => o.zone?.name || "—",
  },
  {
    key: "location",
    label: "Location",
    header: "Location",
    width: 15,
    value: (o) => o.location,
  },
  {
    key: "usd",
    label: "Amount $",
    header: "Amount $",
    width: 15,
    value: (o) => o.amountUsd ?? 0,
  },
  {
    key: "lbp",
    label: "Amount LL",
    header: "Amount LL",
    width: 15,
    value: (o) => o.amountLbp ?? 0,
  },
  {
    key: "collectedUsd",
    label: "$ Collected",
    header: "$ Collected",
    width: 15,
    value: (o) => {
      const isDelivered = o.location === "DELIVERED";
      const raw = Number(o.collectedUsd ?? 0);
      return isDelivered && raw === 0 ? Number(o.amountUsd ?? 0) : raw;
    },
  },
  {
    key: "collectedLbp",
    label: "LL Collected",
    header: "LL Collected",
    width: 15,
    value: (o) => {
      const isDelivered = o.location === "DELIVERED";
      const raw = Number(o.collectedLbp ?? 0);
      return isDelivered && raw === 0 ? Number(o.amountLbp ?? 0) : raw;
    },
  },
  {
    key: "packages",
    label: "Packages",
    header: "Packages",
    width: 10,
    value: (o) => o.packages ?? 1,
  },
  {
    key: "notes",
    label: "Notes",
    header: "Notes",
    width: 25,
    value: (o) => o.notes || "",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function MerchantClient({
  merchant,
  payouts,
  cashBatches,
}: MerchantClientProps) {
  const isCashSeller = merchant.isCashSeller === true;

  const searchParams = useSearchParams();
  const router = useRouter();

  // ── URL-driven active tab ────────────────────────────────────────────────
  // The active tab is reflected in the URL (?tab=deliveries|newOrder|statements)
  // so each tab has its own shareable URL.
  const urlTab = searchParams.get("tab");
  const validTabs: TabKey[] = [
    "deliveries",
    "newOrder",
    "statements",
    "pickupBatches",
  ];
  const initialTab: TabKey = validTabs.includes(urlTab as TabKey)
    ? (urlTab as TabKey)
    : "deliveries";

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const handleTabChange = useCallback(
    (tab: TabKey) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);
  const [historyModalOrder, setHistoryModalOrder] = useState<{
    id: string;
    history: any[];
  } | null>(null);
  // Full order-details modal, opened by clicking an order ID in any table.
  const [detailsModalOrder, setDetailsModalOrder] = useState<any | null>(null);
  // Orders created during this browser session (shown under the New Order
  // Request form so merchants can quickly copy their IDs to their own sheets).
  const [sessionOrders, setSessionOrders] = useState<Order[]>([]);

  // ── Notification bell toasts ─────────────────────────────────────────────
  // Transient pop-ups raised when the bell's poll finds brand-new unread
  // notifications (driver delivered/postponed/rejected a scan).
  interface NotificationToast {
    id: string;
    title: string;
    message: string;
  }
  const [notificationToasts, setNotificationToasts] = useState<
    NotificationToast[]
  >([]);

  const dismissNotificationToast = useCallback((id: string) => {
    setNotificationToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleNewNotifications = useCallback(
    (fresh: Array<{ id: string; title: string; message: string }>) => {
      const toasts: NotificationToast[] = fresh.slice(0, 3).map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
      }));
      if (toasts.length === 0) return;
      setNotificationToasts((prev) => [...prev, ...toasts]);
      // Auto-dismiss after 8s.
      toasts.forEach((t) =>
        setTimeout(() => dismissNotificationToast(t.id), 8000),
      );
    },
    [dismissNotificationToast],
  );

  // ── Interactive Data Grid states ─────────────────────────────────────────
  const [boxFilter, setBoxFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);

  // ── Pickup batches (chain-of-custody) states ─────────────────────────────
  const [pickupBatches, setPickupBatches] = useState<PickupBatchRecord[]>([]);
  const [pickupBatchesLoading, setPickupBatchesLoading] = useState(false);
  const [requestingPickup, setRequestingPickup] = useState(false);
  const [expandedPickupBatchId, setExpandedPickupBatchId] = useState<
    string | null
  >(null);

  // ── Payout/statement date-range filter (statements tab) ──────────────────
  // "all" | "day" | "week" | "month" | "3months" | "6months" | "custom"
  const [payoutRange, setPayoutRange] = useState<string>("all");
  const [payoutStart, setPayoutStart] = useState("");
  const [payoutEnd, setPayoutEnd] = useState("");

  // ── Column sorting (click header arrows to toggle asc/desc) ────────────
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    // Jump back to the first page so the newly sorted rows are visible.
    setPage(1);
  };

  // ── Excel column-selection modal ─────────────────────────────────────────
  // All exportable columns are derived from MERCHANT_EXPORT_COLUMNS and
  // default to on, matching the admin orders page behaviour.
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [excelCols, setExcelCols] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        MERCHANT_EXPORT_COLUMNS.map((c) => [c.key, true]),
      ) as Record<string, boolean>,
  );

  // ── Order Form State ────────────────────────────────────────────────────
  // orderId is intentionally omitted — it is autogenerated server-side as
  // "{merchantId}-{seq}" (e.g. 2-0001) and returned in the created order.
  const [formData, setFormData] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    price: "",
    amountLbp: "",
    notes: "",
    packages: "1",
    hasExchange: false,
    openParcelAllowed: false,
    isFragile: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // ── Inline edit state (only allowed while order location is "CP") ───────
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    price: "",
    amountLbp: "",
    notes: "",
    packages: "1",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Transient inline "Copied" feedback for the tracking-link button (per-row).
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // ── Orders state ────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<Order[]>(merchant.orders || []);

  // ── Cash-seller aware Paid/Unpaid semantics ─────────────────────────────
  // For cash sellers, "Paid" means the advance has already been paid to them
  // (the order was claimed by a cash payout batch). For standard sellers,
  // "Paid" means the delivery company has paid them (financialStatus PS).
  const isPaidOrder = useCallback(
    (order: Order) =>
      isCashSeller
        ? order.cashPayoutBatchId != null
        : order.financialStatus === "PS",
    [isCashSeller],
  );

  const isUnpaidOrder = useCallback(
    (order: Order) =>
      isCashSeller
        ? order.cashPayoutBatchId == null &&
          order.returnDeductionBatchId == null &&
          !order.cashPayoutExcluded
        : order.financialStatus !== "PS",
    [isCashSeller],
  );

  // ── Client-side pagination ──────────────────────────────────────────────
  const PAGE_SIZES = [50, 100, 200, 500, 1000, 5000];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // ── Google Sheets import modal ──────────────────────────────────────────
  const [sheetModalOpen, setSheetModalOpen] = useState(false);

  // ── Interactive filtering with multi-keyword search ─────────────────────
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Exchange proof orders ("-Exchange") are hidden from the merchant's page
      if (String(order.orderId).toLowerCase().endsWith("-exchange")) {
        return false;
      }
      // Box Filter Logic
      if (boxFilter === "DELIVERED" && order.location !== "DELIVERED")
        return false;
      if (
        boxFilter === "IN_TRANSIT" &&
        order.location !== "WITH_DRIVER" &&
        order.location !== "ASSIGNED" &&
        order.location !== "ASSIGNED_TR"
      )
        return false;
      if (boxFilter === "WAREHOUSE" && order.location !== "WAREHOUSE")
        return false;
      if (boxFilter === "CP" && order.location !== "CP") return false;
      if (boxFilter === "RETURNED" && order.location !== "RETURNED")
        return false;
      if (boxFilter === "PAID" && !isPaidOrder(order)) return false;
      if (boxFilter === "UNPAID" && !isUnpaidOrder(order)) return false;

      // Dropdown Filters
      if (locationFilter && order.location !== locationFilter) return false;
      if (
        dateFilter &&
        new Date(order.createdAt).toISOString().split("T")[0] !== dateFilter
      )
        return false;

      // Multi-Keyword Search (Comma Separated)
      if (searchTerm) {
        const keywords = searchTerm
          .toLowerCase()
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k);
        const searchString =
          `${order.id} ${order.orderId} ${order.customerName} ${order.customerPhone} ${order.customerAddress}`.toLowerCase();
        const matchesSearch = keywords.some((keyword) =>
          searchString.includes(keyword),
        );
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [orders, boxFilter, locationFilter, dateFilter, searchTerm, isPaidOrder, isUnpaidOrder]);

  // ── Column sorting applied on top of the filtered list ─────────────────
  const sortedOrders = useMemo(() => {
    if (!sortKey) return filteredOrders;
    const dir = sortDir;
    return [...filteredOrders].sort((a, b) => {
      const va = getOrderSortValue(a, sortKey);
      const vb = getOrderSortValue(b, sortKey);
      const cmp = compareSortValues(va, vb);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [filteredOrders, sortKey, sortDir]);

  // ── Current page slice ──────────────────────────────────────────────────
  const paginatedOrders = useMemo(() => {
    return sortedOrders.slice((page - 1) * pageSize, page * pageSize);
  }, [sortedOrders, page, pageSize]);
  // ── Stat summaries (computed from full dataset) ─────────────────────────
  // Preview of the next auto-generated Order ID, mirroring the server-side
  // generator in app/api/merchant/orders/route.ts ("{merchantId}-{nextSeq}").
  // Shown read-only in the New Order form; advances automatically after each
  // save because the created order is prepended to `orders`.
  const nextOrderIdPreview = useMemo(() => {
    const pattern = new RegExp(`^${merchant.merchantId}-(\\d+)$`);
    let maxSeq = 0;
    for (const o of orders) {
      const match = String(o.orderId).match(pattern);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
    return `${merchant.merchantId}-${String(maxSeq + 1).padStart(4, "0")}`;
  }, [orders, merchant.merchantId]);

  const stats = useMemo(() => {
    // Exchange proof orders ("-Exchange") are hidden from the merchant's page
    const visible = orders.filter(
      (o) => !String(o.orderId).toLowerCase().endsWith("-exchange"),
    );
    const total = visible.length;
    const delivered = visible.filter((o) => o.location === "DELIVERED").length;
    const inTransit = visible.filter(
      (o) =>
        o.location === "WITH_DRIVER" ||
        o.location === "ASSIGNED" ||
        o.location === "ASSIGNED_TR",
    ).length;
    const warehouse = visible.filter((o) => o.location === "WAREHOUSE").length;
    const cp = visible.filter((o) => o.location === "CP").length;
    const paidCount = visible.filter((o) => isPaidOrder(o)).length;
    const unpaidCount = visible.filter((o) => isUnpaidOrder(o)).length;
    const totalUsd = visible.reduce((s, o) => s + (o.amountUsd ?? 0), 0);
    const totalLbp = visible.reduce((s, o) => s + (o.amountLbp ?? 0), 0);
    return {
      total,
      delivered,
      inTransit,
      warehouse,
      cp,
      paidCount,
      unpaidCount,
      totalUsd,
      totalLbp,
    };
  }, [orders, isPaidOrder, isUnpaidOrder]);

  // ── Payout/statement date-range filter (statements tab) ──────────────────
  // Presets: all | day | week | month | 3months | 6months | custom range.
  const payoutRangeStart = useMemo(() => {
    const now = new Date();
    switch (payoutRange) {
      case "day":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case "week": {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return d;
      }
      case "month": {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 1);
        return d;
      }
      case "3months": {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 3);
        return d;
      }
      case "6months": {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 6);
        return d;
      }
      case "custom":
        return payoutStart ? new Date(`${payoutStart}T00:00:00`) : null;
      default:
        return null;
    }
  }, [payoutRange, payoutStart]);

  const payoutRangeEnd = useMemo(() => {
    if (payoutRange === "custom" && payoutEnd) {
      return new Date(`${payoutEnd}T23:59:59.999`);
    }
    return null;
  }, [payoutRange, payoutEnd]);

  const inPayoutRange = useCallback(
    (iso: string) => {
      const t = new Date(iso).getTime();
      if (payoutRangeStart && t < payoutRangeStart.getTime()) return false;
      if (payoutRangeEnd && t > payoutRangeEnd.getTime()) return false;
      return true;
    },
    [payoutRangeStart, payoutRangeEnd],
  );

  const filteredCashBatches = useMemo(
    () => cashBatches.filter((b) => inPayoutRange(b.createdAt)),
    [cashBatches, inPayoutRange],
  );

  const filteredPayouts = useMemo(
    () => payouts.filter((p) => inPayoutRange(p.createdAt)),
    [payouts, inPayoutRange],
  );

  // ── Total Paid ───────────────────────────────────────────────────────────
  // Sum of every payout batch's net paid (cash sellers) or every statement's
  // net disbursed (standard sellers). Clicking the card opens the statements
  // tab (?tab=statements).
  const totalPaid = useMemo(() => {
    if (isCashSeller) {
      return cashBatches.reduce((s, b) => s + (b.netPaid ?? 0), 0);
    }
    return payouts.reduce((s, p) => s + (p.netUsd ?? 0), 0);
  }, [isCashSeller, cashBatches, payouts]);

  // ── Submit new order ────────────────────────────────────────────────────
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    // The "Save & Print" submit button carries data-print="true"; detect it via
    // the submitter so Enter-key submits still behave like a plain save.
    const printWaybill =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-print") ===
      "true";

    setFormMessage(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/merchant/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: formData.customerName,
          customerPhone: formData.customerPhone,
          customerAddress: formData.customerAddress,
          price: formData.price,
          amountLbp: formData.amountLbp ?? "0",
          notes: formData.notes,
          packages: formData.packages,
          hasExchange: formData.hasExchange,
          openParcelAllowed: formData.openParcelAllowed,
          isFragile: formData.isFragile,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create order");
      }

      const newOrder = await res.json();
      setOrders((prev) => [newOrder, ...prev]);
      // Track it in the session list rendered under the New Order form.
      setSessionOrders((prev) => [newOrder, ...prev]);
      setFormData({
        customerName: "",
        customerPhone: "",
        customerAddress: "",
        price: "",
        amountLbp: "",
        notes: "",
        packages: "1",
        hasExchange: false,
        openParcelAllowed: false,
        isFragile: false,
      });
      setFormMessage({ type: "success", text: "Order created successfully!" });

      // "Save & Print": open the waybill print view and auto-trigger printing.
      if (printWaybill && newOrder?.id) {
        window.open(`/orders/print?ids=${newOrder.id}&auto=true`, "_blank");
      }
    } catch (error: any) {
      setFormMessage({
        type: "error",
        text: error.message || "Failed to create order",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Inline edit: start editing an order (only allowed while location is CP) ──
  const startEditOrder = (order: Order) => {
    if (order.location !== "CP") return;
    setEditingOrderId(order.id);
    setEditError(null);
    setEditForm({
      customerName: order.customerName || "",
      customerPhone: order.customerPhone || "",
      customerAddress: order.customerAddress || "",
      price: order.amountUsd != null ? String(order.amountUsd) : "",
      amountLbp: order.amountLbp != null ? String(order.amountLbp) : "",
      notes: order.notes || "",
      packages: order.packages != null ? String(order.packages) : "1",
    });
  };

  const cancelEditOrder = () => {
    setEditingOrderId(null);
    setEditError(null);
  };

  // ── Save edited order details (PATCH /api/orders) ────────────────────────
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrderId) return;

    // The "Save & Print" submit button carries data-print="true"; detect it via
    // the submitter so Enter-key submits still behave like a plain save.
    const printWaybill =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-print") ===
      "true";

    const orderIdToPrint = editingOrderId;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingOrderId,
          customerName: editForm.customerName,
          customerPhone: editForm.customerPhone,
          customerAddress: editForm.customerAddress,
          amountUsd: parseFloat(editForm.price) || 0,
          amountLbp: parseFloat(editForm.amountLbp) || 0,
          notes: editForm.notes,
          packages: parseInt(editForm.packages) || 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update order");
      }
      const updated = await res.json();
      setOrders((prev) =>
        prev.map((o) => (o.id === editingOrderId ? { ...o, ...updated } : o)),
      );
      setEditingOrderId(null);

      // "Save & Print": open the waybill print view and auto-trigger printing.
      if (printWaybill && orderIdToPrint) {
        window.open(`/orders/print?ids=${orderIdToPrint}&auto=true`, "_blank");
      }
    } catch (error: any) {
      setEditError(error.message || "Failed to update order");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Fetch full statement detail (with orders) when "View Details" clicked ──
  const fetchStatementDetail = async (payout: MerchantPayout) => {
    try {
      const res = await fetch(`/api/statements?merchantId=${merchant.id}`);
      if (res.ok) {
        const all: any[] = await res.json();
        const found = all.find((s: any) => s.id === payout.id);
        if (found) {
          setSelectedStatement(found);
          return;
        }
      }
    } catch (err) {
      console.error("Failed to fetch statement detail", err);
    }
    // Fallback: use the summary payout data (no nested orders)
    setSelectedStatement(payout);
  };

  // ── Export selected orders to Excel ─────────────────────────────────────
  // Builds the workbook dynamically from the column definitions the user
  // enabled in the "Select Columns to Export" modal.
  const exportSelectedOrders = async () => {
    if (selectedOrders.length === 0) return;

    const selectedDefs = MERCHANT_EXPORT_COLUMNS.filter((c) => excelCols[c.key]);
    if (selectedDefs.length === 0) {
      alert("Please select at least one column to export.");
      return;
    }

    const selectedData = orders.filter((o) => selectedOrders.includes(o.id));
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Selected_Orders");

    worksheet.columns = selectedDefs.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));

    selectedData.forEach((order) => {
      const row: Record<string, string | number | Date> = {};
      selectedDefs.forEach((c) => {
        row[c.key] = c.value(order);
      });
      const excelRow = worksheet.addRow(row);

      // Order ID: write purely-numeric IDs as real numbers and everything else
      // as explicit text, so Excel never re-interprets it as a date.
      if (excelCols.orderId) {
        const orderIdCell = excelRow.getCell("orderId");
        const rawId = String(order.orderId ?? "");
        if (/^\d+$/.test(rawId)) {
          orderIdCell.value = Number(rawId);
          orderIdCell.numFmt = "0";
        } else {
          orderIdCell.value = rawId;
          orderIdCell.numFmt = "@";
        }
      }

      // Date: store as a real date value formatted as a date, not a string.
      if (excelCols.date) {
        excelRow.getCell("date").numFmt = "mm/dd/yyyy";
      }
    });

    // Center all cells and add borders (shared across every Excel export)
    styleWorksheet(worksheet);

    // downloadWorkbook also suppresses Excel's green "Number Stored as Text"
    // triangles on phone numbers and other numeric-looking strings.
    await downloadWorkbook(
      workbook,
      `Orders_${merchant.merchantName}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );

    setExcelModalOpen(false);
  };

  // ── Export statement to Excel ───────────────────────────────────────────
  const exportToExcel = async (statement: any) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      `Statement_${statement.sequentialIndex}`,
    );

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

    const orders = statement.orders || [];
    const zoneRates = statement.merchant?.zoneRates || [];

    orders.forEach((order: any) => {
      const rate = zoneRates.find(
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

      const row = worksheet.addRow({
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

      // Order ID: write purely-numeric IDs as real numbers and everything else
      // as explicit text, so Excel never re-interprets it as a date.
      const orderIdCell = row.getCell("orderId");
      const rawId = String(order.orderId ?? "");
      if (/^\d+$/.test(rawId)) {
        orderIdCell.value = Number(rawId);
        orderIdCell.numFmt = "0";
      } else {
        orderIdCell.value = rawId;
        orderIdCell.numFmt = "@";
      }
    });

    styleWorksheet(worksheet);
    await downloadWorkbook(
      workbook,
      `Statement_${merchant.merchantName}_#${statement.sequentialIndex}.xlsx`,
    );
  };

  // ── Master checkbox toggle ──────────────────────────────────────────────
  const toggleAllFiltered = () => {
    if (
      selectedOrders.length === paginatedOrders.length &&
      paginatedOrders.length > 0
    ) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(paginatedOrders.map((o) => o.id));
    }
  };

  const toggleOrder = (id: string) => {
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // ── Pickup batch requests (chain-of-custody) ─────────────────────────────
  // Selected orders that may legally join a new pickup batch: staged at CP
  // and not already linked to another batch.
  const pickupEligibleSelected = useMemo(
    () =>
      orders.filter(
        (o) =>
          selectedOrders.includes(o.id) &&
          o.location === "CP" &&
          !o.pickupBatchId,
      ),
    [orders, selectedOrders],
  );

  const fetchPickupBatches = useCallback(async () => {
    setPickupBatchesLoading(true);
    try {
      const res = await fetch("/api/merchant/pickup-batches");
      if (res.ok) {
        const data = await res.json();
        setPickupBatches(data.batches ?? []);
      }
    } catch {
      // Keep whatever is already loaded; the Refresh button can retry.
    } finally {
      setPickupBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "pickupBatches") {
      void fetchPickupBatches();
    }
  }, [activeTab, fetchPickupBatches]);

  const handleRequestPickup = async () => {
    if (pickupEligibleSelected.length === 0 || requestingPickup) return;
    setRequestingPickup(true);
    try {
      const res = await fetch("/api/merchant/pickup-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: pickupEligibleSelected.map((o) => o.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Could not request the pickup, please retry.");
        return;
      }
      // Reflect the batch linkage locally, clear the selection, and jump to
      // the history tab so the merchant sees the newly created batch.
      const pickedIds = new Set(pickupEligibleSelected.map((o) => o.id));
      setOrders((prev) =>
        prev.map((o) =>
          pickedIds.has(o.id) ? { ...o, pickupBatchId: data.batch.id } : o,
        ),
      );
      setSelectedOrders((prev) => prev.filter((id) => !pickedIds.has(id)));
      await fetchPickupBatches();
      handleTabChange("pickupBatches");
    } catch {
      alert("Could not request the pickup, please retry.");
    } finally {
      setRequestingPickup(false);
    }
  };

  // ── Copy tracking link to clipboard ────────────────────────────────────
  // Resolves to whether the copy succeeded so the row can show inline
  // "Copied" feedback instead of an alert popup.
  const handleCopyLink = (order: Order): Promise<boolean> => {
    const trackingUrl = order.trackToken
      ? window.location.origin + "/track/" + order.trackToken + "/" + order.orderId
      : window.location.origin + "/track/" + order.orderId;

    if (navigator.clipboard && window.isSecureContext) {
      // Modern HTTPS approach
      return navigator.clipboard.writeText(trackingUrl).then(
        () => true,
        () => false,
      );
    } else {
      // Legacy HTTP Fallback
      const textArea = document.createElement("textarea");
      textArea.value = trackingUrl;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand("copy");
        return Promise.resolve(true);
      } catch (err) {
        return Promise.resolve(false);
      } finally {
        textArea.remove();
      }
    }
  };

  // ── Format helpers ──────────────────────────────────────────────────────
  // Day/month/year, matching the user side (SharedOrderTable, tracking).
  const formatDate = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  };

  const formatDateTime = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${formatDate(iso)} ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const formatCurrency = (val: number) => val.toFixed(2);

  // ── Invoice / download helpers for the Statements tab ────────────────────
  const escapeCSV = (value: any) => {
    if (value == null) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Open the merchant-safe printable invoice for a cash payout batch.
  const openBatchInvoice = (batch: CashPayoutBatch) => {
    window.open(`/print/merchant/payouts/${batch.id}`, "_blank");
  };

  // Open the full payout batch detail page (same view admins use, scoped to
  // this merchant and with company-only figures stripped server-side).
  const openBatchDetails = (batch: CashPayoutBatch) => {
    router.push(`/merchant/payouts/${batch.id}`);
  };

  // Open the merchant-safe printable invoice for a statement.
  const openStatementInvoice = (payout: MerchantPayout) => {
    window.open(`/print/merchant/statements/${payout.id}`, "_blank");
  };

  // Export a cash payout batch's orders to CSV.
  const exportBatchCSV = (batch: CashPayoutBatch) => {
    const rows = [
      ...(batch.orders || []).map((o) => ({ ...o, _type: "advance" })),
      ...(batch.resolvedReturns || []).map((r) => ({ ...r, _type: "return" })),
    ];
    if (rows.length === 0) {
      alert("No orders in this batch to export.");
      return;
    }
    const headers = [
      "Type",
      "Order ID",
      "Customer",
      "Phone",
      "Address",
      "Amount USD",
      "Amount LBP",
      "Location",
    ];
    const csvRows = rows.map((o) => [
      escapeCSV(o._type),
      escapeCSV(o.orderId),
      escapeCSV(o.customerName),
      escapeCSV(o.customerPhone),
      escapeCSV(o.customerAddress),
      (o.amountUsd ?? 0).toFixed(2),
      (o.amountLbp ?? 0).toString(),
      escapeCSV(o.location || ""),
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join(
      "\n",
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-${batch.batchReference}-orders.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export a statement's orders to CSV.
  const exportStatementCSV = (statement: any) => {
    const orders = statement.orders || [];
    if (orders.length === 0) {
      alert("No order details available for this statement.");
      return;
    }
    const zoneRates = statement.merchant?.zoneRates || [];
    const headers = [
      "Order ID",
      "Customer",
      "Phone",
      "Address",
      "Orig USD",
      "Orig LBP",
      "Collected USD",
      "Collected LBP",
      "Shipping USD",
      "Shipping LBP",
      "Net USD",
      "Net LBP",
    ];
    const csvRows = orders.map((order: any) => {
      const rate = zoneRates.find(
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
      return [
        escapeCSV(order.orderId),
        escapeCSV(order.customerName),
        escapeCSV(order.customerPhone),
        escapeCSV(order.customerAddress),
        origUsd.toFixed(2),
        origLbp.toString(),
        collUsd.toFixed(2),
        collLbp.toString(),
        shipUsd.toFixed(2),
        shipLbp.toString(),
        (collUsd - shipUsd).toFixed(2),
        (collLbp - shipLbp).toString(),
      ];
    });
    const csv = [
      headers.join(","),
      ...csvRows.map((r: string[]) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${statement.sequentialIndex}-orders.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Fetch a statement's full detail (with orders) then export it to CSV.
  const handleExportStatementCSV = async (payout: MerchantPayout) => {
    try {
      const res = await fetch(`/api/statements?merchantId=${merchant.id}`);
      if (res.ok) {
        const all: any[] = await res.json();
        const found = all.find((s: any) => s.id === payout.id);
        if (found) {
          exportStatementCSV(found);
          return;
        }
      }
    } catch (err) {
      console.error("Failed to fetch statement detail", err);
    }
    alert("Could not load statement details for export.");
  };

  // ─── Render ──────────────────────────────────────────────────────────────
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

      <div
        className={`min-h-screen bg-[#0B0F17] text-white p-4 sm:p-6 font-sans ${selectedStatement ? "print:hidden" : ""}`}
      >
        <div className="max-w-[1400px] mx-auto">
          {/* ── Header ── */}
          <div className="mb-8 flex flex-col gap-2">
            <div className="flex items-center gap-4">
              {merchant.logoUrl && (
                <Image
                  src={merchant.logoUrl}
                  alt={`${merchant.merchantName} logo`}
                  width={64}
                  height={64}
                  unoptimized
                  className="w-16 h-16 rounded-full object-cover border border-white/10 bg-[#121824]"
                />
              )}
              <div className="flex items-end gap-4">
                <h1 className="text-3xl font-bold text-cyan-400">
                  {merchant.merchantName}
                </h1>
                <span className="px-2 py-1 text-xs font-bold bg-cyan-500/10 text-cyan-500 rounded border border-cyan-500/20">
                  Seller #{merchant.merchantId}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <NotificationBell onNewNotifications={handleNewNotifications} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 mt-2">
              {merchant.phone && (
                <span className="flex items-center gap-1">
                  📞 {merchant.phone}
                </span>
              )}
              {merchant.address && (
                <span className="flex items-center gap-1">
                  📍 {merchant.address}
                </span>
              )}
              {merchant.createdAt && (
                <span
                  className="flex items-center gap-1"
                  title="Merchant account creation date"
                >
                  🗓️ Member since: {formatDate(merchant.createdAt)}
                </span>
              )}
            </div>

            {/* Shipping Rates */}
            {merchant.zoneRates && merchant.zoneRates.length > 0 && (
              <div className="mt-4 p-4 rounded-xl border border-white/5 bg-[#121824] inline-block">
                <p className="text-xs text-gray-500 font-bold uppercase mb-2">
                  Shipping Rates
                </p>
                <div className="flex gap-4">
                  {merchant.zoneRates.map((rate) => (
                    <div key={rate.id} className="text-sm">
                      <span className="text-gray-400">{rate.zone.name}: </span>
                      <span className="text-white font-bold">
                        ${rate.rate.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Stat Cards ── */}
          {/* Each card jumps to the deliveries tab and applies its filter, so
              clicking works from any tab (not just while already on it). */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4 mb-6">
            <StatCard
              label="All Orders"
              value={stats.total}
              color="slate"
              isSelected={boxFilter === null}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter(null);
                setPage(1);
              }}
            />
            <StatCard
              label="In Transit"
              value={stats.inTransit}
              color="amber"
              isSelected={boxFilter === "IN_TRANSIT"}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter("IN_TRANSIT");
                setPage(1);
              }}
            />
            <StatCard
              label="Delivered"
              value={stats.delivered}
              color="green"
              isSelected={boxFilter === "DELIVERED"}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter("DELIVERED");
                setPage(1);
              }}
            />
            <StatCard
              label="Warehouse"
              value={stats.warehouse}
              color="purple"
              isSelected={boxFilter === "WAREHOUSE"}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter("WAREHOUSE");
                setPage(1);
              }}
            />
            <StatCard
              label="CP (Pickup)"
              value={stats.cp}
              color="cyan"
              isSelected={boxFilter === "CP"}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter("CP");
                setPage(1);
              }}
            />
            <StatCard
              label="Unpaid"
              value={stats.unpaidCount}
              color="red"
              isSelected={boxFilter === "UNPAID"}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter("UNPAID");
                setPage(1);
              }}
            />
            <StatCard
              label="Paid"
              value={stats.paidCount}
              color="green"
              isSelected={boxFilter === "PAID"}
              onClick={() => {
                handleTabChange("deliveries");
                setBoxFilter("PAID");
                setPage(1);
              }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <div className="backdrop-blur-xl bg-white/5 rounded-xl border border-white/10 p-4">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Total Value (USD)
              </p>
              <p className="text-green-400 font-mono text-xl font-bold">
                ${formatCurrency(stats.totalUsd)}
              </p>
            </div>
            <div className="backdrop-blur-xl bg-white/5 rounded-xl border border-white/10 p-4">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Total Value (LBP)
              </p>
              <p className="text-yellow-400 font-mono text-xl font-bold">
                {stats.totalLbp.toLocaleString()} LL
              </p>
            </div>
            {/* Total Paid = sum of all payout batches' net paid (cash sellers)
                or all statements' net disbursed. Clicking opens the
                statements/payout-batches tab. */}
            <button
              type="button"
              onClick={() => handleTabChange("statements")}
              title="View payout batches"
              className="backdrop-blur-xl bg-white/5 rounded-xl border border-green-500/30 p-4 text-left shadow-[0_0_15px_rgba(34,197,94,0.2)] hover:border-green-500/60 transition-all duration-200 cursor-pointer"
            >
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Total Paid
              </p>
              <p className="text-green-300 font-mono text-xl font-bold">
                ${formatCurrency(totalPaid)}
              </p>
            </button>
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 mb-6 p-1 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 w-fit">
            <button
              onClick={() => handleTabChange("deliveries")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "deliveries"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              All Orders ({filteredOrders.length})
            </button>
            <button
              onClick={() => handleTabChange("newOrder")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "newOrder"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              New Order Request
            </button>
            <button
              onClick={() => handleTabChange("statements")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "statements"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {isCashSeller ? "My Payout Batches" : "My Statements"} (
              {isCashSeller
                ? filteredCashBatches.length
                : filteredPayouts.length}
              )
            </button>
            <button
              onClick={() => handleTabChange("pickupBatches")}
              title="Pickup batch history and reconciliation"
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "pickupBatches"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              Pickup Batches
            </button>
          </div>

          {/* ════════════════════════════════ */}
          {/* TAB 1: ACTIVE DELIVERIES        */}
          {/* ════════════════════════════════ */}
          {activeTab === "deliveries" && (
            <>
              {/* ── Toolbar ── */}
              <div className="flex flex-wrap items-end gap-3 mb-4 p-4 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10">
                {selectedOrders.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 mr-1">
                      {selectedOrders.length} selected
                    </span>
                    <button
                      onClick={() =>
                        window.open(
                          `/orders/print?ids=${selectedOrders.join(",")}`,
                          "_blank",
                        )
                      }
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                      title="Print waybills for the selected orders"
                    >
                      🖨️ Print Waybill
                    </button>
                    <button
                      onClick={() => setExcelModalOpen(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                      title="Download as Excel"
                    >
                      📊 Excel
                    </button>
                    <button
                      onClick={() =>
                        window.open(
                          `/orders/print?ids=${selectedOrders.join(",")}&pdf=true`,
                          "_blank",
                        )
                      }
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                      title="Download as PDF"
                    >
                      📑 PDF
                    </button>
                    <button
                      onClick={handleRequestPickup}
                      disabled={
                        pickupEligibleSelected.length === 0 || requestingPickup
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        pickupEligibleSelected.length === 0
                          ? "text-gray-600 bg-white/5 border-white/10 cursor-not-allowed"
                          : "text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30"
                      }`}
                      title={
                        pickupEligibleSelected.length === 0
                          ? "Select CP (Pickup) orders that are not already in a batch"
                          : "Create a pickup batch for the selected CP orders"
                      }
                    >
                      {requestingPickup
                        ? "⏳ Requesting…"
                        : `📦 Request Pickup (${pickupEligibleSelected.length})`}
                    </button>
                  </div>
                )}
                <div className="flex-1" />
                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Multi-Keyword Search
                  </label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setPage(1);
                    }}
                    placeholder="ID, name, phone, address..."
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Date
                  </label>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => {
                      setDateFilter(e.target.value);
                      setPage(1);
                    }}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [color-scheme:dark]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Location
                  </label>
                  <select
                    value={locationFilter}
                    onChange={(e) => {
                      setLocationFilter(e.target.value);
                      setPage(1);
                    }}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [&>option]:bg-slate-950 [&>option]:text-white"
                  >
                    <option value="">All</option>
                    <option value="WAREHOUSE">Warehouse</option>
                    <option value="WITH_DRIVER">With Driver</option>
                    <option value="ASSIGNED">Assigned</option>
                    <option value="ASSIGNED_TR">With Driver - Tr</option>
                    <option value="DELIVERED">Delivered</option>
                    <option value="RETURNED">Returned</option>
                  </select>
                </div>
                {/* ── Rows per page (right-aligned with the search box) ── */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Rows per page
                  </label>
                  <select
                    value={PAGE_SIZES.includes(pageSize) ? pageSize : "all"}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPageSize(val === "all" ? 5000 : Number(val));
                      setPage(1);
                    }}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [&>option]:bg-slate-950 [&>option]:text-white"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size === 5000 ? "5000 (max)" : size}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Showing
                  </label>
                  <span className="text-xs text-gray-400 py-2 whitespace-nowrap">
                    {paginatedOrders.length} of {filteredOrders.length} order(s)
                  </span>
                </div>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
                  <p className="text-gray-500 text-sm">
                    No orders match the current filters.
                  </p>
                </div>
              ) : (
                <>
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[10px] uppercase tracking-wider">
                          <th className="px-2 py-3 w-10">
                            <input
                              type="checkbox"
                              checked={
                                paginatedOrders.length > 0 &&
                                selectedOrders.length === paginatedOrders.length
                              }
                              onChange={toggleAllFiltered}
                              className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                            />
                          </th>
                          <SortableTh
                            label="Order ID"
                            sortKey="orderId"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Date"
                            sortKey="dateReceived"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Customer"
                            sortKey="customer"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Phone"
                            sortKey="phone"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Address"
                            sortKey="address"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Amount"
                            sortKey="amountUsd"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Amount Collected"
                            sortKey="collectedUsd"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <SortableTh
                            label="Location"
                            sortKey="location"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            className="py-3"
                          />
                          <th className="px-2 py-3 text-left font-medium">
                            Note
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOrders.map((order) => (
                          <Fragment key={order.id}>
                          <tr
                            className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                          >
                            <td className="px-2 py-2.5">
                              <input
                                type="checkbox"
                                checked={selectedOrders.includes(order.id)}
                                onChange={() => toggleOrder(order.id)}
                                className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                              />
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() =>
                                    setHistoryModalOrder({
                                      id: order.id,
                                      history: [],
                                    })
                                  }
                                  title="Order History"
                                  className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                                >
                                  &#9776;
                                </button>
                                <button
                                  onClick={() => setDetailsModalOrder(order)}
                                  title="View order details"
                                  className="font-mono text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/40 decoration-dashed underline-offset-4 transition-colors"
                                >
                                  {order.orderId}
                                </button>
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-xs text-gray-500">
                              {formatDate(order.createdAt)}
                            </td>
                            <td className="px-2 py-2.5 text-xs text-white">
                              {order.customerName}
                            </td>
                            <td className="px-2 py-2.5 text-xs text-gray-400">
                              {order.customerPhone || "—"}
                            </td>
                            <td
                              className="px-2 py-2.5 text-xs text-gray-400 max-w-[260px] whitespace-normal break-words"
                              title={order.customerAddress}
                            >
                              {order.customerAddress}
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <span className="text-green-400 font-mono">
                                ${order.amountUsd.toFixed(2)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-yellow-400 font-mono">
                                {order.amountLbp.toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <span className="text-green-300 font-mono">
                                ${(order.collectedUsd ?? 0).toFixed(2)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-yellow-300 font-mono">
                                {(order.collectedLbp ?? 0).toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  order.location === "DELIVERED"
                                    ? "bg-green-500/10 text-green-400 border border-green-500/30"
                                    : order.location === "ASSIGNED_TR"
                                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                                    : order.location === "WITH_DRIVER" ||
                                        order.location === "ASSIGNED"
                                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                                    : order.location === "RETURNED"
                                      ? "bg-red-500/10 text-red-400 border border-red-500/30"
                                        : order.location === "CP"
                                          ? "bg-purple-500/10 text-purple-300 border border-purple-500/30"
                                          : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                                }`}
                              >
                                {order.location === "WAREHOUSE"
                                  ? "Warehouse"
                                  : order.location === "ASSIGNED_TR"
                                    ? "With Driver - Tr"
                                  : order.location === "WITH_DRIVER"
                                    ? "With Driver"
                                  : order.location === "ASSIGNED"
                                    ? "Assigned"
                                      : order.location === "DELIVERED"
                                        ? "Delivered"
                                        : order.location === "RETURNED"
                                          ? "Returned"
                                          : order.location === "CP"
                                            ? order.pickupBatchId
                                              ? "CP (Batched)"
                                              : "CP (Pickup)"
                                            : order.location}
                             </span>
                           </td>
                           <td
                             className="px-2 py-2.5 text-xs text-gray-400 max-w-[150px] truncate"
                             title={order.notes || undefined}
                           >
                             {order.notes ? order.notes : "—"}
                           </td>
                           <td className="px-4 py-3 whitespace-nowrap text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {copiedLinkId === order.id ? (
                                  <span className="px-3 py-1.5 text-xs font-bold text-green-400">
                                    Copied
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => {
                                      handleCopyLink(order).then((ok) => {
                                        if (!ok) return;
                                        setCopiedLinkId(order.id);
                                        setTimeout(() => setCopiedLinkId(null), 1000);
                                      });
                                    }}
                                    className="px-3 py-1.5 text-xs font-bold text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded transition-colors"
                                  >
                                    🔗 Copy Link
                                  </button>
                                )}
                                {order.location === "CP" ? (
                                  <button
                                    onClick={() => startEditOrder(order)}
                                    className="px-3 py-1.5 text-xs font-bold text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded transition-colors"
                                  >
                                    ✏️ Edit
                                  </button>
                                ) : (
                                  <span
                                    title="Orders can only be edited while at CP (Pickup)"
                                    className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-white/5 border border-white/10 rounded cursor-not-allowed"
                                  >
                                    ✏️ Edit
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {editingOrderId === order.id && (
                            <tr className="bg-[#121824] border-b border-white/10">
                              <td colSpan={10} className="px-4 py-3">
                                <form onSubmit={handleSaveEdit}>
                                  <div className="flex flex-wrap gap-2 items-end">
                                    <div className="flex flex-col gap-1 min-w-[140px]">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        Customer
                                      </label>
                                      <input
                                        type="text"
                                        required
                                        value={editForm.customerName}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            customerName: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[130px]">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        Phone
                                      </label>
                                      <input
                                        type="text"
                                        required
                                        value={editForm.customerPhone}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            customerPhone: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[200px] flex-1">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        Address
                                      </label>
                                      <input
                                        type="text"
                                        required
                                        value={editForm.customerAddress}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            customerAddress: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[80px]">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        USD
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={editForm.price}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            price: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[80px]">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        LBP
                                      </label>
                                      <input
                                        type="number"
                                        step="1"
                                        value={editForm.amountLbp}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            amountLbp: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[60px]">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        Pckgs
                                      </label>
                                      <input
                                        type="number"
                                        min="1"
                                        value={editForm.packages}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            packages: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[140px]">
                                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                                        Notes
                                      </label>
                                      <input
                                        type="text"
                                        value={editForm.notes}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            notes: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 min-w-[120px]">
                                      <div className="h-[10px]" />
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="submit"
                                          disabled={editSaving}
                                          className="px-4 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                                        >
                                          {editSaving ? "..." : "Save"}
                                        </button>
                                        <button
                                          type="submit"
                                          data-print="true"
                                          disabled={editSaving}
                                          title="Save the order and immediately print its waybill"
                                          className="px-4 py-1.5 text-xs font-bold rounded bg-violet-600 hover:bg-violet-500 text-white shadow-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                                        >
                                          {editSaving ? "..." : "Save & Print"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEditOrder}
                                          className="px-4 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-gray-300 transition-colors whitespace-nowrap"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                  {editError && (
                                    <p className="mt-2 text-xs text-red-400">
                                      {editError}
                                    </p>
                                  )}
                                </form>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Pagination Controls ── */}
                <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 border-t border-white/10">
                  {(() => {
                    const totalPages = Math.max(
                      1,
                      Math.ceil(filteredOrders.length / pageSize),
                    );
                    if (totalPages <= 1) return null;
                    return (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Prev
                        </button>
                        {(() => {
                          const pages: number[] = [];
                          const visible = [1, totalPages];
                          if (page > 1) pages.push(page - 1);
                          pages.push(page);
                          if (page < totalPages) pages.push(page + 1);
                          const sorted = [...new Set([...pages, ...visible])].sort(
                            (a, b) => a - b,
                          );
                          return sorted.map((p) => (
                            <button
                              key={p}
                              onClick={() => setPage(p)}
                              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                                page === p
                                  ? "bg-cyan-600 border-cyan-500 text-white"
                                  : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                              }`}
                            >
                              {p}
                            </button>
                          ));
                        })()}
                        <button
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                          disabled={page === totalPages}
                          className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    );
                  })()}
                </div>
                </>
              )}
            </>
          )}

          {/* ════════════════════════════════ */}
          {/* TAB 2: NEW ORDER REQUEST        */}
          {/* ════════════════════════════════ */}
          {activeTab === "newOrder" && (
            <>
              {/* ── Header Row: Import button ── */}
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => setSheetModalOpen(true)}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 hover:shadow-[0_0_16px_rgba(6,182,212,0.3)] transition-all duration-200"
                >
                  📄 Import Orders from Google Sheets
                </button>
                <span className="text-[10px] text-gray-500 font-mono">
                  {merchant.sheetImportConfig
                    ? "Saved template loaded for this seller"
                    : "No saved template — defaults will be used"}
                </span>
              </div>

              <div className="bg-[#121824] border border-white/5 rounded-xl p-4 shadow-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Order Entry
                  </h2>
                  <span className="text-[10px] text-gray-500 font-mono">
                    Fields auto-clear on save &middot; Press Enter to submit
                  </span>
                </div>

                {formMessage && (
                  <div
                    className={`mb-3 px-3 py-2 rounded-lg text-sm ${
                      formMessage.type === "success"
                        ? "bg-green-500/10 border border-green-500/30 text-green-400"
                        : "bg-red-500/10 border border-red-500/30 text-red-400"
                    }`}
                  >
                    {formMessage.text}
                  </div>
                )}

                <form onSubmit={handleCreateOrder}>
                  <div className="flex flex-nowrap gap-2 items-end overflow-x-auto pb-1">
                    {/* Order ID (auto-generated, read-only; copyable for
                        allowlisted merchants only) */}
                    <div className="flex flex-col gap-1 min-w-[100px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Order ID
                      </label>
                      {COPYABLE_PREVIEW_ID_MERCHANT_IDS.has(
                        merchant.merchantId,
                      ) ? (
                        <CopyOrderId
                          orderId={nextOrderIdPreview}
                          variant="field"
                        />
                      ) : (
                        <input
                          type="text"
                          value={nextOrderIdPreview}
                          readOnly
                          disabled
                          title="Automatically generated — cannot be changed"
                          className="px-2 py-1.5 text-xs rounded bg-slate-950/60 border border-gray-800 text-cyan-400 font-mono cursor-not-allowed opacity-70"
                        />
                      )}
                    </div>

                    {/* Customer */}
                    <div className="flex flex-col gap-1 min-w-[120px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Customer
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.customerName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            customerName: e.target.value,
                          })
                        }
                        placeholder="John Doe"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Phone */}
                    <div className="flex flex-col gap-1 min-w-[120px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Phone
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.customerPhone}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            customerPhone: e.target.value,
                          })
                        }
                        placeholder="+1 555 123 4567"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Address */}
                    <div className="flex flex-col gap-1 min-w-[200px] flex-1">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Address
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.customerAddress}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            customerAddress: e.target.value,
                          })
                        }
                        placeholder="123 Main St, City"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* USD */}
                    <div className="flex flex-col gap-1 min-w-[80px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        USD
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={formData.price}
                        onChange={(e) =>
                          setFormData({ ...formData, price: e.target.value })
                        }
                        placeholder="0.00"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* LBP */}
                    <div className="flex flex-col gap-1 min-w-[80px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        LBP
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={formData.amountLbp}
                        onChange={(e) =>
                          setFormData({ ...formData, amountLbp: e.target.value })
                        }
                        placeholder="0"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Pckgs */}
                    <div className="flex flex-col gap-1 min-w-[60px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Pckgs
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formData.packages}
                        onChange={(e) =>
                          setFormData({ ...formData, packages: e.target.value })
                        }
                        placeholder="1"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Exchange */}
                    <div className="flex flex-col gap-1 min-w-[60px] items-center">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Exchange
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.hasExchange}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              hasExchange: e.target.checked,
                            })
                          }
                          className="w-4 h-4 rounded border-gray-600 bg-slate-950 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </label>
                    </div>

                    {/* Open Parcel */}
                    <div className="flex flex-col gap-1 min-w-[60px] items-center">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Open P
                      </label>
                      <label className="flex items-center cursor-pointer" title="Open Parcel Allowed">
                        <input
                          type="checkbox"
                          checked={formData.openParcelAllowed}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              openParcelAllowed: e.target.checked,
                            })
                          }
                          className="w-4 h-4 rounded border-gray-600 bg-slate-950 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </label>
                    </div>

                    {/* Fragile */}
                    <div className="flex flex-col gap-1 min-w-[60px] items-center">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Fragile
                      </label>
                      <label className="flex items-center cursor-pointer" title="Fragile">
                        <input
                          type="checkbox"
                          checked={formData.isFragile}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              isFragile: e.target.checked,
                            })
                          }
                          className="w-4 h-4 rounded border-gray-600 bg-slate-950 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </label>
                    </div>

                    {/* Notes */}
                    <div className="flex flex-col gap-1 min-w-[120px]">
                      <label className="text-[10px] text-gray-500 font-mono uppercase">
                        Notes
                      </label>
                      <input
                        type="text"
                        value={formData.notes}
                        onChange={(e) =>
                          setFormData({ ...formData, notes: e.target.value })
                        }
                        placeholder="Optional"
                        className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Save / Save & Print */}
                    <div className="flex flex-col gap-1 min-w-[80px]">
                      <div className="h-[10px]" />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {submitting ? "..." : "Save"}
                        </button>
                        <button
                          type="submit"
                          data-print="true"
                          disabled={submitting}
                          title="Save the order and immediately print its waybill"
                          className="px-4 py-1.5 text-xs font-bold rounded bg-violet-600 hover:bg-violet-500 text-white shadow-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {submitting ? "..." : "Save & Print"}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              {/* ── Orders created in this session (click an ID to copy it) ── */}
              {sessionOrders.length > 0 && (
                <div className="bg-[#121824] border border-white/5 rounded-xl p-4 shadow-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                      Orders Created This Session
                    </h2>
                    <span className="text-[10px] text-gray-500 font-mono">
                      Click an Order ID to copy it to your clipboard
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {sessionOrders.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between gap-3 border border-white/5 rounded px-3 py-2 bg-white/[0.02]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <CopyOrderId orderId={o.orderId} className="text-xs" />
                          <span className="text-xs text-gray-400 truncate">
                            {o.customerName}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">
                          {formatDateTime(o.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════ */}
          {/* PICKUP BATCHES TAB               */}
          {/* ════════════════════════════════ */}
          {activeTab === "pickupBatches" && (
            <>
              {/* ── Toolbar ── */}
              <div className="flex flex-wrap items-center gap-3 mb-4 p-4 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10">
                <h2 className="text-sm font-semibold text-white">
                  Pickup Batches{" "}
                  <span className="text-gray-500 font-normal">
                    (سجلات الاستلام)
                  </span>
                </h2>
                <div className="flex-1" />
                <span className="text-xs text-gray-400 py-2 whitespace-nowrap">
                  {pickupBatches.length} batch(es)
                </span>
                <button
                  onClick={() => void fetchPickupBatches()}
                  disabled={pickupBatchesLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50"
                >
                  {pickupBatchesLoading ? "⏳ Loading…" : "🔄 Refresh"}
                </button>
              </div>

              {pickupBatches.length === 0 ? (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
                  <p className="text-gray-500 text-sm">
                    {pickupBatchesLoading
                      ? "Loading pickup batches…"
                      : "No pickup batches yet. Select your CP (Pickup) orders under All Orders and press “📦 Request Pickup”."}
                  </p>
                </div>
              ) : (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                          <th className="px-4 py-3 text-left font-medium">
                            Batch
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Created
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Driver
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Items
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pickupBatches.map((batch) => {
                          const meta =
                            PICKUP_STATUS_META[batch.status] ?? {
                              label: batch.status,
                              cls: "bg-white/5 text-gray-400 border-white/10",
                            };
                          const isExpanded =
                            expandedPickupBatchId === batch.id;
                          return (
                            <Fragment key={batch.id}>
                              <tr
                                onClick={() =>
                                  setExpandedPickupBatchId(
                                    isExpanded ? null : batch.id,
                                  )
                                }
                                className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors cursor-pointer"
                              >
                                <td className="px-4 py-3">
                                  <span className="font-mono text-purple-300">
                                    {batch.batchNumber}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-500">
                                  {formatDateTime(batch.createdAt)}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-300">
                                  {batch.driver
                                    ? `${batch.driver.firstName} ${batch.driver.lastName}`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.cls}`}
                                  >
                                    {meta.label}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-right">
                                  <span className="text-gray-300">
                                    {batch.receivedCount}/{batch.totalOrders}{" "}
                                    received
                                  </span>
                                  <br />
                                  <span className="text-gray-500">
                                    {batch.pickedUpCount} picked up
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span className="text-xs text-cyan-400">
                                    {isExpanded ? "▲ Hide" : "▼ Details"}
                                  </span>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-[#121824] border-b border-white/10">
                                  <td colSpan={6} className="px-4 py-3">
                                    {batch.discrepancyNote && (
                                      <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                                        ⚠️ {batch.discrepancyNote}
                                      </div>
                                    )}
                                    {batch.orders.length === 0 ? (
                                      <p className="text-gray-500 text-xs">
                                        No items in this batch.
                                      </p>
                                    ) : (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-gray-500 text-[10px] uppercase tracking-wider border-b border-white/10">
                                            <th className="py-2 pr-4 text-left font-medium">
                                              Order ID
                                            </th>
                                            <th className="py-2 pr-4 text-left font-medium">
                                              Customer
                                            </th>
                                            <th className="py-2 pr-4 text-left font-medium">
                                              Custody Stage
                                            </th>
                                            <th className="py-2 text-right font-medium">
                                              Financial
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {batch.orders.map((o) => (
                                            <tr
                                              key={o.id}
                                              className="border-b border-white/5"
                                            >
                                              <td className="py-2 pr-4 font-mono text-cyan-400">
                                                {o.orderId}
                                              </td>
                                              <td className="py-2 pr-4 text-gray-300">
                                                {o.customerName}
                                              </td>
                                              <td className="py-2 pr-4">
                                                <span
                                                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                                    o.location === "WAREHOUSE" ||
                                                    o.location === "DELIVERED"
                                                      ? "bg-green-500/10 text-green-400 border-green-500/30"
                                                      : o.location ===
                                                          "PICKED_UP"
                                                        ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                                                        : o.location === "CP"
                                                          ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                                                          : "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                                                  }`}
                                                >
                                                  {pickupItemStatusLabel(
                                                    o.location,
                                                  )}
                                                </span>
                                              </td>
                                              <td className="py-2 text-right text-gray-400">
                                                {o.financialStatus}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════ */}
          {/* MY STATEMENTS TAB                */}
          {/* ════════════════════════════════ */}
          {activeTab === "statements" && (
            <>
              {/* ── Date-range filter toolbar ── */}
              <div className="flex flex-wrap items-end gap-3 mb-4 p-4 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Filter by period
                  </label>
                  <select
                    value={payoutRange}
                    onChange={(e) => setPayoutRange(e.target.value)}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [&>option]:bg-slate-950 [&>option]:text-white"
                  >
                    <option value="all">All time</option>
                    <option value="day">Today</option>
                    <option value="week">Last 7 days</option>
                    <option value="month">Last month</option>
                    <option value="3months">Last 3 months</option>
                    <option value="6months">Last 6 months</option>
                    <option value="custom">Custom date range</option>
                  </select>
                </div>
                {payoutRange === "custom" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                        From
                      </label>
                      <input
                        type="date"
                        value={payoutStart}
                        onChange={(e) => setPayoutStart(e.target.value)}
                        className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [color-scheme:dark]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                        To
                      </label>
                      <input
                        type="date"
                        value={payoutEnd}
                        onChange={(e) => setPayoutEnd(e.target.value)}
                        className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [color-scheme:dark]"
                      />
                    </div>
                  </>
                )}
                <div className="flex-1" />
                <span className="text-xs text-gray-400 py-2 whitespace-nowrap">
                  Showing {isCashSeller ? filteredCashBatches.length : filteredPayouts.length} of{" "}
                  {isCashSeller ? cashBatches.length : payouts.length}{" "}
                  {isCashSeller ? "batch(es)" : "statement(s)"}
                </span>
              </div>

              {isCashSeller ? (
                /* ── CASH SELLER: PAID CASH PAYOUT BATCHES ──
                   Cash sellers are paid in advance, so instead of statements
                   they review the money they were paid. The company-only
                   profit figure is never shown here. */
                filteredCashBatches.length === 0 ? (
                  <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
                    <p className="text-gray-500 text-sm">
                      No cash payout batches have been generated yet.
                    </p>
                  </div>
                ) : (
                  <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                            <th className="px-4 py-3 text-left font-medium w-8" />
                            <th className="px-4 py-3 text-left font-medium">
                              Batch Ref
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Date
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              Gross Advance
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              Deducted Returns
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              Net Paid
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCashBatches.map((batch) => {
                            const isExpanded = expandedBatchId === batch.id;
                            return (
                              <Fragment key={batch.id}>
                                <tr
                                  onClick={() =>
                                    setExpandedBatchId(
                                      isExpanded ? null : batch.id,
                                    )
                                  }
                                  className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors cursor-pointer"
                                >
                                  <td className="px-4 py-3">
                                    <span
                                      className={`text-gray-500 text-xs transition-transform inline-block ${
                                        isExpanded ? "rotate-90" : ""
                                      }`}
                                    >
                                      ▶
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs font-mono text-cyan-400">
                                    {batch.batchReference}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-gray-400">
                                    {formatDate(batch.createdAt)}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-right">
                                    <span className="text-green-400 font-mono">
                                      ${formatCurrency(batch.grossAdvance)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-right">
                                    <span className="text-red-400 font-mono">
                                      -${formatCurrency(batch.deductedReturns)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-right">
                                    <span className="text-green-300 font-mono font-bold">
                                      ${formatCurrency(batch.netPaid)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-right">
                                    <div
                                      className="flex items-center justify-end gap-1.5"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        onClick={() => openBatchDetails(batch)}
                                        className="px-2.5 py-1.5 text-[11px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/25 transition-colors"
                                        title="View full payout batch details"
                                      >
                                        🔍 Details
                                      </button>
                                      <button
                                        onClick={() => openBatchInvoice(batch)}
                                        className="px-2.5 py-1.5 text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded hover:bg-amber-500/25 transition-colors"
                                        title="Open printable invoice"
                                      >
                                        📄 Invoice
                                      </button>
                                      <button
                                        onClick={() => exportBatchCSV(batch)}
                                        className="px-2.5 py-1.5 text-[11px] font-bold bg-green-500/15 text-green-400 border border-green-500/30 rounded hover:bg-green-500/25 transition-colors"
                                        title="Export orders to CSV"
                                      >
                                        📊 CSV
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr>
                                    <td
                                      colSpan={7}
                                      className="px-4 py-3 bg-[#0B0F17]/50"
                                    >
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-2">
                                            Advance Orders ({batch.orders.length})
                                          </p>
                                          {batch.orders.length === 0 ? (
                                            <p className="text-gray-600 text-xs">
                                              None
                                            </p>
                                          ) : (
                                            <div className="space-y-1">
                                              {batch.orders.map((o) => (
                                                <div
                                                  key={o.id}
                                                  className="border border-white/5 rounded px-2 py-1.5 bg-white/[0.02]"
                                                >
                                                  <div className="flex items-center justify-between mb-1">
                                                    <button
                                                      onClick={() =>
                                                        setDetailsModalOrder(
                                                          orders.find(
                                                            (x) => x.id === o.id,
                                                          ) ?? o,
                                                        )
                                                      }
                                                      title="View order details"
                                                      className="font-mono text-xs text-white font-semibold hover:text-cyan-300 underline decoration-cyan-500/40 decoration-dashed underline-offset-4 transition-colors"
                                                    >
                                                      {o.orderId}
                                                    </button>
                                                    <div className="flex items-center gap-2">
                                                      <span className="font-mono text-xs text-green-400">
                                                        ${o.amountUsd.toFixed(2)}
                                                      </span>
                                                      {o.amountLbp != null && o.amountLbp > 0 && (
                                                        <span className="font-mono text-[10px] text-gray-500">
                                                          {o.amountLbp.toLocaleString()} LBP
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                                                    {o.customerName && (
                                                      <div className="text-gray-400">
                                                        <span className="text-gray-600">Customer:</span> {o.customerName}
                                                      </div>
                                                    )}
                                                    {o.customerPhone && (
                                                      <div className="text-gray-400">
                                                        <span className="text-gray-600">Phone:</span> {o.customerPhone}
                                                      </div>
                                                    )}
                                                    {o.customerAddress && (
                                                      <div className="text-gray-400 col-span-2">
                                                        <span className="text-gray-600">Address:</span> {o.customerAddress}
                                                      </div>
                                                    )}
                                                    {o.location && (
                                                      <div className="text-gray-400">
                                                        <span className="text-gray-600">Location:</span> {o.location}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <div>
                                          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-2">
                                            Deducted Returns (
                                            {batch.resolvedReturns.length})
                                          </p>
                                          {batch.resolvedReturns.length === 0 ? (
                                            <p className="text-gray-600 text-xs">
                                              None
                                            </p>
                                          ) : (
                                            <div className="space-y-1">
                                              {batch.resolvedReturns.map((r) => (
                                                <div
                                                  key={r.id}
                                                  className="border border-white/5 rounded px-2 py-1.5 bg-white/[0.02]"
                                                >
                                                  <div className="flex items-center justify-between mb-1">
                                                    <button
                                                      onClick={() =>
                                                        setDetailsModalOrder(
                                                          orders.find(
                                                            (x) => x.id === r.id,
                                                          ) ?? r,
                                                        )
                                                      }
                                                      title="View order details"
                                                      className="font-mono text-xs text-white font-semibold hover:text-cyan-300 underline decoration-cyan-500/40 decoration-dashed underline-offset-4 transition-colors"
                                                    >
                                                      {r.orderId}
                                                    </button>
                                                    <div className="flex items-center gap-2">
                                                      <span className="font-mono text-xs text-orange-400">
                                                        -${r.amountUsd.toFixed(2)}
                                                      </span>
                                                      {r.amountLbp != null && r.amountLbp > 0 && (
                                                        <span className="font-mono text-[10px] text-gray-500">
                                                          {r.amountLbp.toLocaleString()} LBP
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                                                    {r.customerName && (
                                                      <div className="text-gray-400">
                                                        <span className="text-gray-600">Customer:</span> {r.customerName}
                                                      </div>
                                                    )}
                                                    {r.customerPhone && (
                                                      <div className="text-gray-400">
                                                        <span className="text-gray-600">Phone:</span> {r.customerPhone}
                                                      </div>
                                                    )}
                                                    {r.customerAddress && (
                                                      <div className="text-gray-400 col-span-2">
                                                        <span className="text-gray-600">Address:</span> {r.customerAddress}
                                                      </div>
                                                    )}
                                                    {r.location && (
                                                      <div className="text-gray-400">
                                                        <span className="text-gray-600">Location:</span> {r.location}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ) : (
                <>
                  {filteredPayouts.length === 0 ? (
                    <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
                      <p className="text-gray-500 text-sm">
                        No statements have been generated yet.
                      </p>
                    </div>
                  ) : (
                    <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                              <th className="px-4 py-3 text-left font-medium">
                                Statement #
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Date generated
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Gross Cash Collected
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Shipping Costs Deducted
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Net Cash Disbursed
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPayouts.map((p) => (
                              <tr
                                key={p.id}
                                className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                              >
                                <td className="px-4 py-3 text-xs font-mono text-cyan-400">
                                  #{p.sequentialIndex}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-400">
                                  {formatDate(p.createdAt)}
                                </td>
                                <td className="px-4 py-3 text-xs text-right">
                                  <span className="text-green-400 font-mono">
                                    ${formatCurrency(p.totalUsd)}
                                  </span>
                                  <span className="text-gray-600 mx-1">|</span>
                                  <span className="text-yellow-400 font-mono">
                                    {p.totalLbp.toLocaleString()} LL
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-right">
                                  <span className="text-red-400 font-mono">
                                    -${formatCurrency(p.shippingUsd)}
                                  </span>
                                  <span className="text-gray-600 mx-1">|</span>
                                  <span className="text-red-400 font-mono">
                                    -{p.shippingLbp.toLocaleString()} LL
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-right">
                                  <span className="text-green-300 font-mono font-bold">
                                    ${formatCurrency(p.netUsd)}
                                  </span>
                                  <span className="text-gray-600 mx-1">|</span>
                                  <span className="text-yellow-300 font-mono font-bold">
                                    {p.netLbp.toLocaleString()} LL
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      onClick={() => openStatementInvoice(p)}
                                      className="px-2.5 py-1.5 text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded hover:bg-amber-500/25 transition-colors"
                                      title="Open printable invoice"
                                    >
                                      📄 Invoice
                                    </button>
                                    <button
                                      onClick={() => handleExportStatementCSV(p)}
                                      className="px-2.5 py-1.5 text-[11px] font-bold bg-green-500/15 text-green-400 border border-green-500/30 rounded hover:bg-green-500/25 transition-colors"
                                      title="Export orders to CSV"
                                    >
                                      📊 CSV
                                    </button>
                                    <button
                                      onClick={() => fetchStatementDetail(p)}
                                      className="px-2.5 py-1.5 text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20 transition-colors"
                                      title="View statement details"
                                    >
                                      View Details
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
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
                  {merchant.merchantName} &middot;{" "}
                  {formatDateTime(selectedStatement.createdAt)}
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
            <div className="overflow-y-auto overflow-x-auto p-6 print:overflow-visible print:max-h-none">
              {selectedStatement.orders &&
              selectedStatement.orders.length > 0 ? (
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
                      const zoneRates =
                        selectedStatement.merchant?.zoneRates || [];
                      const rate = zoneRates.find(
                        (zr: any) =>
                          String(zr.zoneId) === String(order.zoneId) ||
                          String(zr.zoneId) === String(order.zone?.name),
                      );
                      const shipUsd =
                        rate?.rateUsd ?? rate?.rate ?? rate?.price ?? 0;
                      const shipLbp = rate?.rateLbp ?? 0;

                      const origUsd = order.amountUsd ?? 0;
                      const origLbp = order.amountLbp ?? 0;
                      const collUsd =
                        order.collectedUsd ?? order.amountUsd ?? 0;
                      const collLbp =
                        order.collectedLbp ?? order.amountLbp ?? 0;

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
              ) : (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No order details available for this statement.
                </div>
              )}

              {/* Print Footer */}
              <div className="hidden print:block mt-12 text-center text-sm text-gray-500">
                End of Statement #{selectedStatement.sequentialIndex} &mdash;
                Generated by Jet Delivery
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Order History Modal ──────────────────────────────────────────── */}
      {historyModalOrder && (
        <OrderHistoryModal
          orderId={historyModalOrder.id}
          initialHistory={historyModalOrder.history}
          onClose={() => setHistoryModalOrder(null)}
        />
      )}

      {/* ── Order Details Modal ──────────────────────────────────────────── */}
      {detailsModalOrder && (
        <OrderDetailsModal
          order={detailsModalOrder}
          onClose={() => setDetailsModalOrder(null)}
        />
      )}

      {/* ── Import Google Sheets Modal ───────────────────────────────────── */}
      {sheetModalOpen && (
        <ImportGoogleSheetsModal
          merchantId={merchant.merchantId}
          savedConfig={merchant.sheetImportConfig}
          apiPath="/api/merchant/orders/import-sheet"
          saveConfigPath="/api/merchant/orders/import-sheet/config"
          onSuccess={() => {
            setSheetModalOpen(false);
            window.location.reload();
          }}
          onClose={() => setSheetModalOpen(false)}
        />
      )}

      {/* ════════════════════════════════════════ */}
      {/* EXCEL COLUMN SELECTOR MODAL (glassmorphism) */}
      {/* ════════════════════════════════════════ */}
      {excelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setExcelModalOpen(false)}
          />

          {/* Modal */}
          <div
            className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                       border border-white/20 shadow-[0_0_40px_rgba(6,182,212,0.2)]
                       p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-1">
              Select Columns to Export
            </h2>
            <p className="text-xs text-gray-400 mb-5">
              Choose which columns to include in the Excel file.
            </p>

            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500">
                {Object.values(excelCols).filter(Boolean).length} of{" "}
                {MERCHANT_EXPORT_COLUMNS.length} columns selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setExcelCols(
                      Object.fromEntries(
                        MERCHANT_EXPORT_COLUMNS.map((c) => [c.key, true]),
                      ) as Record<string, boolean>,
                    )
                  }
                  className="px-2 py-1 text-[10px] font-semibold rounded-md
                             bg-white/5 text-gray-300 border border-white/10
                             hover:bg-white/10 transition-colors"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setExcelCols(
                      Object.fromEntries(
                        MERCHANT_EXPORT_COLUMNS.map((c) => [c.key, false]),
                      ) as Record<string, boolean>,
                    )
                  }
                  className="px-2 py-1 text-[10px] font-semibold rounded-md
                             bg-white/5 text-gray-300 border border-white/10
                             hover:bg-white/10 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6 max-h-[50vh] overflow-y-auto pr-1">
              {MERCHANT_EXPORT_COLUMNS.map((col) => {
                const val = excelCols[col.key];
                return (
                  <label
                    key={col.key}
                    className="flex items-center gap-3 cursor-pointer group"
                  >
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center
                                  transition-all duration-200
                                  ${
                                    val
                                      ? "bg-cyan-500 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                                      : "border-gray-600 group-hover:border-gray-500"
                                  }`}
                    >
                      {val && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={() =>
                        setExcelCols((prev) => ({
                          ...prev,
                          [col.key]: !prev[col.key],
                        }))
                      }
                      className="sr-only"
                    />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                      {col.label}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setExcelModalOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                           bg-white/5 text-gray-400 border border-white/10
                           hover:text-white hover:bg-white/10 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={exportSelectedOrders}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                           bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                           hover:bg-cyan-500/30 hover:shadow-[0_0_16px_rgba(6,182,212,0.3)]
                           transition-all duration-200"
              >
                Export to Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Notification toasts (new driver-scan alerts) ── */}
      {notificationToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
          {notificationToasts.map((toast) => (
            <div
              key={toast.id}
              className="bg-[#121824] border border-cyan-500/30 rounded-xl shadow-2xl p-4 flex items-start gap-3"
            >
              <span className="text-lg leading-5 shrink-0" aria-hidden>
                🔔
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{toast.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 break-words">
                  {toast.message}
                </p>
              </div>
              <button
                onClick={() => dismissNotificationToast(toast.id)}
                className="p-1 rounded text-gray-500 hover:text-white transition-colors shrink-0"
                aria-label="Dismiss notification"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Small Stat Card ──────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  color,
  isSelected,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  isSelected?: boolean;
  onClick?: () => void;
}) {
  const glowMap: Record<string, string> = {
    cyan: "shadow-[0_0_15px_rgba(6,182,212,0.2)] border-cyan-500/30",
    green: "shadow-[0_0_15px_rgba(34,197,94,0.2)] border-green-500/30",
    amber: "shadow-[0_0_15px_rgba(245,158,11,0.2)] border-amber-500/30",
    purple: "shadow-[0_0_15px_rgba(168,85,247,0.2)] border-purple-500/30",
    red: "shadow-[0_0_15px_rgba(239,68,68,0.2)] border-red-500/30",
    slate: "shadow-[0_0_15px_rgba(148,163,184,0.15)] border-slate-500/30",
  };

  const textMap: Record<string, string> = {
    cyan: "text-cyan-400",
    green: "text-green-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
    red: "text-red-400",
    slate: "text-slate-300",
  };

  const selectedBorder = isSelected
    ? "border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.35)]"
    : "";

  return (
    <div
      onClick={onClick}
      className={`backdrop-blur-xl bg-white/5 rounded-xl border p-4 cursor-pointer hover:border-cyan-500/50 transition-all duration-200 ${glowMap[color] || glowMap.cyan} ${selectedBorder}`}
    >
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-extrabold ${textMap[color] || textMap.cyan}`}
      >
        {value}
      </p>
    </div>
  );
}
