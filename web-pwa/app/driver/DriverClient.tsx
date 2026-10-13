"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  buildRateTableFromRates,
  computeOrderCommission,
  grossUsd,
  grossLbp,
} from "@/lib/commission";
import SettingsModal from "@/components/SettingsModal";
import ConfirmPayoutModal from "@/components/payouts/ConfirmPayoutModal";
import OrderHistoryModal from "@/components/OrderHistoryModal";
import BarcodeScannerModal from "@/components/BarcodeScannerModal";
import {
  POSTPONEMENT_REASONS,
  REJECTION_REASONS,
  splitReasonLabel,
} from "@/lib/driver-reasons";

type Order = {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  location: string;
  financialStatus?: string;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryPreference?: string | null;
  deliveryNotes?: string | null;
  zoneId: string;
  merchantId?: string;
  driverPayoutId?: string | null;
};

type ZoneRate = {
  zoneId: string;
  rate: number;
};

type SellerRate = {
  merchantId: string;
  rateUsd: number;
};

type Driver = {
  id: string;
  firstName: string;
  lastName: string;
  deliveries: Order[];
  zoneRates: ZoneRate[];
  driverSellerRates: SellerRate[];
};

type WarehouseOrder = {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  amountUsd: number;
  amountLbp: number;
  location: string;
  financialStatus?: string;
  notes?: string | null;
  zoneId: string;
  zone: { id: string; name: string } | null;
  merchant?: { id: string; merchantName: string } | null;
  merchantId?: string | null;
};

type AssignedZone = {
  id: string;
  name: string;
};

type Props = {
  driver: Driver;
  warehouseOrders?: WarehouseOrder[];
  assignedZones?: AssignedZone[];
};

// ── Payout History Types ────────────────────────────────────────────────
type PayoutOrder = {
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
};

type DriverPayoutItem = {
  id: string;
  sequentialIndex: number;
  status: string;
  totalUsd: number;
  totalLbp: number;
  commissionUsd: number;
  netUsd: number;
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
  orders: PayoutOrder[];
};

// ── Helper Functions ────────────────────────────────────────────────────
function beirutDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

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

const NOTE_OPTIONS = [
  "Canceled by customer",
  "Wrong Item",
  "No answer",
  "Refused to receive the package upon arrival",
  "Wrong number",
] as const;

// ── Bilingual Driver UI (EN / AR) ───────────────────────────────────────
type Lang = "en" | "ar";

const DRIVER_I18N: Record<Lang, Record<string, string>> = {
  en: {
    dashboard: "Driver Dashboard",
    logout: "Logout",
    active: "Active",
    switchLang: "عربي",
    langToggleTitle: "Switch language / تغيير اللغة",
    tabActive: "Active",
    tabDelivered: "Delivered",
    tabWarehouse: "Warehouse",
    tabPayouts: "Payout History",
    selectAll: "Select All",
    deselectAll: "Deselect All",
    clear: "Clear",
    ordersSelected: "orders selected",
    quickDeliverFull: "Quick Deliver (Full)",
    customAmount: "Custom Amount",
    deliverN: "Deliver {n} Order(s)",
    processing: "Processing...",
    perOrderAmounts: "Per-order collected amounts (leave 0 for unpaid)",
    deliverCustom: "Deliver with Custom Amounts",
    bulkFailed: "Bulk delivery failed. Check console for details.",
    noActive: "No active deliveries",
    allCaughtUp: "You're all caught up!",
    select: "Select",
    callCustomer: "Call Customer",
    customerNotes: "Customer Delivery Notes",
    navigateGps: "Navigate to GPS Pin",
    quickDeliverBtn: "✓ Quick Deliver (Full Price)",
    customCollectBtn: "Custom Collect",
    markReturnBtn: "↺ Mark Return",
    postponeBtn: "⏳ Postpone",
    addNoteBtn: "📝 Add Note",
    confirmDelivery: "Confirm Delivery",
    submitting: "Submitting…",
    cancel: "Cancel",
    noDelivered: "No delivered orders",
    completedHere: "Completed deliveries will appear here.",
    collectedLabel: "Collected:",
    cancelDeliveryBtn: "Cancel Delivery",
    canceling: "Canceling…",
    endOfDayPayout: "End-of-Day Payout",
    totalCollectedAcross: "Total collected across {n} delivered orders:",
    sendToOffice: "Send to Office (Pending Payout)",
    rateNotConfigured: "Rate not configured",
    noZones: "No zones assigned",
    noZonesHint:
      "You don't have any warehouse zones assigned yet. Contact your admin.",
    noOrders: "No orders available",
    noOrdersHint: "All orders from your assigned zones have been picked up.",
    noOrdersZone: "No orders in this zone.",
    pickupBtn: "📦 Pick Up & Assign to Me",
    pickingUp: "Picking up...",
    pickupConfirm:
      "Assign this order to yourself and move it to your active deliveries?",
    cancelDeliveryConfirm:
      "Are you sure you want to cancel this delivery and return it to active?",
    postponeTitle: "⏳ Postpone Delivery",
    newDate: "New Delivery Date",
    reasonTitle: "Reason for Postponement",
    otherPlaceholder: "Describe the reason…",
    confirmPostpone: "Confirm Postpone",
    saving: "Saving…",
    noteTitle: "📝 Add Driver Note",
    customLabel: "Custom",
    customNotePlaceholder: "Enter custom note…",
    saveNote: "Save Note",
    scanNext: "📷 Scan Next",
    close: "Close",
    scannedPackage: "Scanned Package",
    chooseAction: "Choose an action for this order",
    orderIdLabel: "Order ID",
    statusLabel: "Status",
    driverLabel: "Driver",
    markDeliveredBtn: "✓ Mark Delivered",
    pickUpBtn: "📦 Pick Up",
    dismiss: "Dismiss",
    scanFabTitle: "Scan a package barcode/QR code",
    scanHeading: "Scan Package Barcode / QR",
    packageNotFound: 'Package "{id}" not found.',
    lookupFailed: "Failed to look up order. Please try again.",
    deliveredTitle: "✓ Confirm Delivery",
    expectedCod: "Expected COD",
    actualCollected: "Actual Collected",
    discrepancyAlert:
      "The collected amount differs from the expected COD. A price adjustment reason is required.",
    adjustReasonLabel: "Price Adjustment Reason (required)",
    adjustReasonPlaceholder: "e.g. Customer paid a partial amount",
    rejectTitle: "↺ Reject / Return Order",
    codWarning: "This order will be marked as returned with $0.00 collected.",
    returnNotice:
      "The package must be returned to the office with the other returns at the end of the day.",
    confirmReturn: "Confirm Return",
    reasonRequired: "Please select a reason.",
    otherReasonRequired: "Please describe the custom reason.",
    adjustReasonRequired:
      "A price adjustment reason is required when the collected amount differs from the expected COD.",
    deliverFailed: "Failed to mark as delivered.",
    returnFailed: "Failed to mark as returned.",
    networkError: "Network error. Please try again.",
    orderHistoryTitle: "Order History",
  },
  ar: {
    dashboard: "لوحة تحكم السائق",
    logout: "تسجيل الخروج",
    active: "نشط",
    switchLang: "English",
    langToggleTitle: "تغيير اللغة / Switch language",
    tabActive: "نشطة",
    tabDelivered: "تم التسليم",
    tabWarehouse: "المستودع",
    tabPayouts: "سجل الدفعات",
    selectAll: "تحديد الكل",
    deselectAll: "إلغاء التحديد",
    clear: "مسح",
    ordersSelected: "طلب محدد",
    quickDeliverFull: "تسليم سريع (كامل)",
    customAmount: "مبلغ مخصص",
    deliverN: "تسليم {n} طلب",
    processing: "جارٍ المعالجة...",
    perOrderAmounts: "مبالغ التحصيل لكل طلب (اترك 0 لغير المحصّل)",
    deliverCustom: "تسليم بمبالغ مخصصة",
    bulkFailed: "فشل التسليم الجماعي. تحقق من سجل الأخطاء.",
    noActive: "لا توجد طلبات نشطة",
    allCaughtUp: "لا يوجد ما يستدعي المتابعة!",
    select: "تحديد",
    callCustomer: "اتصال بالزبون",
    customerNotes: "ملاحظات تسليم الزبون",
    navigateGps: "التوجه إلى الموقع المحدد",
    quickDeliverBtn: "✓ تسليم سريع (السعر الكامل)",
    customCollectBtn: "تحصيل مخصص",
    markReturnBtn: "↺ إرجاع الطلب",
    postponeBtn: "⏳ تأجيل",
    addNoteBtn: "📝 إضافة ملاحظة",
    confirmDelivery: "تأكيد التسليم",
    submitting: "جارٍ الإرسال…",
    cancel: "إلغاء",
    noDelivered: "لا توجد طلبات مسلَّمة",
    completedHere: "ستظهر هنا الطلبات المكتملة.",
    collectedLabel: "المحصَّل:",
    cancelDeliveryBtn: "إلغاء التسليم",
    canceling: "جارٍ الإلغاء…",
    endOfDayPayout: "دفعة نهاية اليوم",
    totalCollectedAcross: "إجمالي المحصَّل عن {n} طلب مسلَّم:",
    sendToOffice: "إرسال إلى المكتب (دفعة معلقة)",
    rateNotConfigured: "لم يتم تحديد نسبة العمولة",
    noZones: "لا توجد مناطق مسندة",
    noZonesHint: "لم يتم إسناد أي منطقة مستودع لك بعد. تواصل مع الإدارة.",
    noOrders: "لا توجد طلبات متاحة",
    noOrdersHint: "تم استلام جميع طلبات مناطقك المسندة.",
    noOrdersZone: "لا توجد طلبات في هذه المنطقة.",
    pickupBtn: "📦 استلام وإسناد لي",
    pickingUp: "جارٍ الاستلام...",
    pickupConfirm: "هل تريد إسناد هذا الطلب لنفسك ونقله إلى طلباتك النشطة؟",
    cancelDeliveryConfirm:
      "هل أنت متأكد من إلغاء هذا التسليم وإعادته إلى الطلبات النشطة؟",
    postponeTitle: "⏳ تأجيل التسليم",
    newDate: "تاريخ التسليم الجديد",
    reasonTitle: "سبب التأجيل",
    otherPlaceholder: "اكتب السبب…",
    confirmPostpone: "تأكيد التأجيل",
    saving: "جارٍ الحفظ…",
    noteTitle: "📝 إضافة ملاحظة السائق",
    customLabel: "مخصصة",
    customNotePlaceholder: "اكتب ملاحظة…",
    saveNote: "حفظ الملاحظة",
    scanNext: "📷 مسح التالي",
    close: "إغلاق",
    scannedPackage: "الطرد الممسوح",
    chooseAction: "اختر إجراءً لهذا الطلب",
    orderIdLabel: "رقم الطلب",
    statusLabel: "الحالة",
    driverLabel: "السائق",
    markDeliveredBtn: "✓ تم التسليم",
    pickUpBtn: "📦 استلام",
    dismiss: "إخفاء",
    scanFabTitle: "مسح باركود/QR للطرد",
    scanHeading: "مسح باركود الطرد",
    packageNotFound: 'الطرد "{id}" غير موجود.',
    lookupFailed: "تعذر العثور على الطلب. حاول مرة أخرى.",
    deliveredTitle: "✓ تأكيد التسليم",
    expectedCod: "المبلغ المتوقع تحصيله",
    actualCollected: "المبلغ المحصَّل فعلياً",
    discrepancyAlert:
      "المبلغ المحصَّل يختلف عن المتوقع. سبب تعديل السعر إلزامي.",
    adjustReasonLabel: "سبب تعديل السعر (إلزامي)",
    adjustReasonPlaceholder: "مثال: الزبون دفع جزءاً من المبلغ",
    rejectTitle: "↺ رفض / إرجاع الطلب",
    codWarning: "سيتم تعليم الطلب كمرتجع مع تحصيل 0.00$.",
    returnNotice:
      "يجب إعادة الطرد إلى المكتب مع باقي المرتجعات في نهاية اليوم.",
    confirmReturn: "تأكيد الإرجاع",
    reasonRequired: "يرجى اختيار سبب.",
    otherReasonRequired: "يرجى كتابة السبب المخصص.",
    adjustReasonRequired:
      "سبب تعديل السعر إلزامي عند اختلاف المبلغ المحصَّل عن المتوقع.",
    deliverFailed: "تعذر تعليم الطلب كمسلَّم.",
    returnFailed: "تعذر تعليم الطلب كمرتجع.",
    networkError: "خطأ في الشبكة. حاول مرة أخرى.",
    orderHistoryTitle: "سجل الطلب",
  },
};

export default function DriverClient({
  driver,
  warehouseOrders: initialWarehouseOrders = [],
  assignedZones: initialAssignedZones = [],
}: Props) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<Order[]>(driver.deliveries);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [historyModalOrder, setHistoryModalOrder] = useState<{
    id: string;
    history: any[];
  } | null>(null);

  // ── Bulk Selection State ─────────────────────────────────────────────
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkMode, setBulkMode] = useState<"quick" | "custom">("quick");
  const [bulkCollectedUsd, setBulkCollectedUsd] = useState<
    Record<string, string>
  >({});
  const [bulkCollectedLbp, setBulkCollectedLbp] = useState<
    Record<string, string>
  >({});

  // ── Logout Handler ──────────────────────────────────────────────────
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed");
    }
  };

  // ── Language State (persisted) ───────────────────────────────────────
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("driver_lang");
      if (stored === "en" || stored === "ar") setLang(stored);
    } catch {
      // localStorage unavailable (private mode, etc.) → keep default "en"
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let out = DRIVER_I18N[lang][key] ?? DRIVER_I18N.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
      }
      return out;
    },
    [lang],
  );

  const toggleLang = () => {
    setLang((prev) => {
      const next: Lang = prev === "en" ? "ar" : "en";
      try {
        window.localStorage.setItem("driver_lang", next);
      } catch {
        // ignore persistence failures
      }
      return next;
    });
  };

  // Localized label for a shared reason entry ("English / العربية" → one side)
  const reasonLabel = useCallback(
    (label: string) => splitReasonLabel(label, lang),
    [lang],
  );

  // ── Postpone Modal State ─────────────────────────────────────────────
  const [postponeModal, setPostponeModal] = useState<string | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReasonCode, setPostponeReasonCode] = useState("");
  const [postponeReasonText, setPostponeReasonText] = useState("");

  // ── Delivered (COD) Modal State ──────────────────────────────────────
  const [deliveredModal, setDeliveredModal] = useState<Order | null>(null);
  const [deliveredActualUsd, setDeliveredActualUsd] = useState("");
  const [deliveredActualLbp, setDeliveredActualLbp] = useState("");
  const [deliveredAdjustReason, setDeliveredAdjustReason] = useState("");

  // ── Reject / Return Modal State ──────────────────────────────────────
  const [rejectModal, setRejectModal] = useState<Order | null>(null);
  const [rejectReasonCode, setRejectReasonCode] = useState("");
  const [rejectReasonText, setRejectReasonText] = useState("");

  // ── Note Modal State ─────────────────────────────────────────────────
  const [noteModal, setNoteModal] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string>("");
  const [customNote, setCustomNote] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  // ── Warehouse State ──────────────────────────────────────────────────
  const [warehouseOrders, setWarehouseOrders] = useState<WarehouseOrder[]>(
    initialWarehouseOrders,
  );
  const [activeWarehouseZone, setActiveWarehouseZone] = useState<string>(
    initialAssignedZones.length > 0 ? initialAssignedZones[0].id : "",
  );
  const [warehousePickupSubmitting, setWarehousePickupSubmitting] = useState<
    string | null
  >(null);

  // ── Tab State ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<
    "ACTIVE" | "DELIVERED" | "PAYOUTS" | "WAREHOUSE"
  >("ACTIVE");

  // ── Settings Modal State ─────────────────────────────────────────────
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ── Payout Modal State ───────────────────────────────────────────────
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);

  // ── Scan Package State ───────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedOrder, setScannedOrder] = useState<any | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSubmitting, setScanSubmitting] = useState(false);

  // ── Payout History State ─────────────────────────────────────────────
  const [payoutHistory, setPayoutHistory] = useState<DriverPayoutItem[]>([]);
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState("ALL");
  const [payoutStartDate, setPayoutStartDate] = useState("");
  const [payoutEndDate, setPayoutEndDate] = useState("");
  const [payoutSortOrder, setPayoutSortOrder] = useState<"desc" | "asc">(
    "desc",
  );
  const [expandedPayoutIds, setExpandedPayoutIds] = useState<string[]>([]);

  // ── Fetch Payout History ─────────────────────────────────────────────
  const fetchPayoutHistory = useCallback(() => {
    const params = new URLSearchParams();
    if (payoutStatusFilter !== "ALL") params.set("status", payoutStatusFilter);
    if (payoutStartDate) params.set("startDate", payoutStartDate);
    if (payoutEndDate) params.set("endDate", payoutEndDate);
    params.set("sortBy", "createdAt");
    params.set("sortDir", payoutSortOrder);

    setPayoutLoading(true);
    fetch(`/api/driver/my-payouts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setPayoutHistory(Array.isArray(data) ? data : []);
        setPayoutLoading(false);
      })
      .catch(() => {
        setPayoutHistory([]);
        setPayoutLoading(false);
      });
  }, [payoutStatusFilter, payoutStartDate, payoutEndDate, payoutSortOrder]);

  useEffect(() => {
    if (activeTab === "PAYOUTS") {
      fetchPayoutHistory();
    }
  }, [activeTab, fetchPayoutHistory]);

  // ── Toggle expanded payout row ───────────────────────────────────────
  const togglePayoutExpanded = (payoutId: string) => {
    setExpandedPayoutIds((prev) =>
      prev.includes(payoutId)
        ? prev.filter((id) => id !== payoutId)
        : [...prev, payoutId],
    );
  };

  // ── View/Print payout orders ─────────────────────────────────────────
  const handleViewPrintPayout = useCallback((payout: DriverPayoutItem) => {
    if (!payout.orders || payout.orders.length === 0) {
      alert("No orders in this payout.");
      return;
    }
    const ids = payout.orders.map((o) => o.id).join(",");
    window.open(`/print/orders?ids=${ids}&payoutId=${payout.id}`, "_blank");
  }, []);

  // ── Print payout invoice (PDF via browser print) ─────────────────────
  const printPayoutInvoice = useCallback((payout: DriverPayoutItem) => {
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
        <title>Payout #${payout.sequentialIndex}</title>
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
          <h2>Payout — Batch #${payout.sequentialIndex}</h2>
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

  // ── Export single payout to Excel ────────────────────────────────────
  const exportPayoutToExcel = useCallback((payout: DriverPayoutItem) => {
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
      "Driver Commission USD":
        o.driverCommissionUsd == null ? "Rate not configured" : o.driverCommissionUsd.toFixed(2),
      "Fin Status": o.financialStatus,
      Location: o.location,
      Seller: o.merchant?.merchantName || "—",
    }));
    exportToExcel(`Payout_${payout.sequentialIndex}_Orders`, rows);
  }, []);

  // ── Split orders into active / delivered ─────────────────────────────
  const activeOrders = useMemo(
    () =>
      deliveries.filter((o) => {
        const loc = String(o.location).toUpperCase();
        // ASSIGNED_TR (transit batch) is driver-held like ASSIGNED.
        return loc === "WITH_DRIVER" || loc === "ASSIGNED" || loc === "ASSIGNED_TR";
      }),
    [deliveries],
  );

  const deliveredOrders = useMemo(
    () =>
      deliveries.filter((o) => {
        const loc = String(o.location).toUpperCase();
        const fin = String(o.financialStatus).toUpperCase();
        // Exchange proof orders ("-Exchange") never impact financials / driver payouts
        if (String(o.orderId).toLowerCase().endsWith("-exchange")) return false;
        const isDelivered = loc === "DELIVERED";
        const isReturned = loc === "RETURNED" || loc === "RETURN";
        const isUnpaid = !o.driverPayoutId; // Relational: not yet linked to a payout batch
        // Exclude PS (Paid to Seller) — these orders have been printed in a
        // merchant statement and should only appear in universal orders /
        // merchant profile "All Orders" tab, not in the driver delivered tab.
        const isPaidToSeller = fin === "PS";
        return (isDelivered || isReturned) && isUnpaid && !isPaidToSeller;
      }),
    [deliveries],
  );

  // ── Payout Receipt (Settlement Calculator) ────────────────────────────
  // Authoritative module: gross = collected > 0 else amount; commission =
  // seller exception (server already merged cash-seller rates into
  // driver.driverSellerRates, cash wins, a configured $0 is valid) → zone →
  // MISSING (no $0 default; an explicitly configured $0 is a valid override).
  const driverRateTable = useMemo(
    () =>
      buildRateTableFromRates(driver.id, {
        driverZoneRates: driver.zoneRates,
        driverSellerRates: driver.driverSellerRates || [],
        driverCashSellerRates: [],
      }),
    [driver.id, driver.zoneRates, driver.driverSellerRates],
  );

  const payoutReceipt = useMemo(() => {
    const totalUsdCollected = deliveredOrders.reduce(
      (sum, o) => sum + grossUsd(o),
      0,
    );
    const totalLbpCollected = deliveredOrders.reduce(
      (sum, o) => sum + grossLbp(o),
      0,
    );

    const lines = new Map<string, { rateUsd: number; count: number; label: string }>();
    let totalCommissionUsd = 0;
    let missingRateOrderCount = 0;
    for (const o of deliveredOrders) {
      const b = computeOrderCommission(driverRateTable, {
        merchantId: o.merchantId,
        zoneId: String(o.zoneId),
      });
      if (!b.ok) {
        missingRateOrderCount += 1;
        continue;
      }
      totalCommissionUsd += b.usd;
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

    const netToOfficeUsd = totalUsdCollected - totalCommissionUsd;
    const netToOfficeLbp = totalLbpCollected;

    return {
      totalUsdCollected,
      totalLbpCollected,
      totalCommissionUsd,
      netToOfficeUsd,
      netToOfficeLbp,
      commissionLines,
      missingRateOrderCount,
    };
  }, [deliveredOrders, driverRateTable]);

  const activeCount = activeOrders.length;

  // ── Cancel Delivery (from Delivered tab) ──────────────────────────────
  const handleCancelDelivery = async (orderId: string) => {
    const confirmed = window.confirm(
      t("cancelDeliveryConfirm"),
    );
    if (!confirmed) return;

    setSubmitting(orderId);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          location: "WITH_DRIVER",
          financialStatus: "UD",
          collectedUsd: 0,
          collectedLbp: 0,
          driverActionLog: "Delivery Canceled by Driver",
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  location: "WITH_DRIVER",
                  financialStatus: "UD",
                  collectedUsd: 0,
                  collectedLbp: 0,
                }
              : o,
          ),
        );
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Pick Up Warehouse Order (assign to self) ──────────────────────────
  const handlePickupOrder = async (orderId: string) => {
    const confirmed = window.confirm(
      t("pickupConfirm"),
    );
    if (!confirmed) return;

    setWarehousePickupSubmitting(orderId);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          driverId: driver.id,
          location: "ASSIGNED",
          financialStatus: "UD",
          collectedUsd: 0,
          collectedLbp: 0,
          driverActionLog: "PICKED_UP_FROM_WAREHOUSE",
        }),
      });

      if (res.ok) {
        // Remove from warehouse list
        setWarehouseOrders((prev) => prev.filter((o) => o.id !== orderId));
        // Refresh the page to update the active deliveries count
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to pick up order. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setWarehousePickupSubmitting(null);
    }
  };

  // ── Open Payout Modal ─────────────────────────────────────────────────
  const handleOpenPayoutModal = () => {
    if (deliveredOrders.length === 0) return;
    setPayoutModalOpen(true);
  };

  // ── Confirm Payout (from Modal) ───────────────────────────────────────
  const handleConfirmPayout = async () => {
    if (deliveredOrders.length === 0) return;

    setSubmitting("__payout__");
    try {
      const orderIds = deliveredOrders.map((o) => o.id);
      const res = await fetch(`/api/drivers/${driver.id}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          totalUsd: payoutReceipt.totalUsdCollected,
          totalLbp: payoutReceipt.totalLbpCollected,
          commissionUsd: payoutReceipt.totalCommissionUsd,
          netUsd: payoutReceipt.netToOfficeUsd,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Payout creation failed:", err);
        alert(err.error || "Failed to create payout. Please try again.");
        return;
      }

      setDeliveries((prev) => prev.filter((o) => o.financialStatus !== "WD"));
      setPayoutModalOpen(false);
    } finally {
      setSubmitting(null);
    }
  };

  // Append a line to an order's notes without clobbering existing content.
  // The GET endpoint returns { data, meta } (scoped to this driver), so the
  // shape is normalized before lookup; a large page avoids missing old rows.
  const fetchExistingNotes = async (orderId: string): Promise<string> => {
    const existingRes = await fetch(`/api/orders?take=5000`);
    const existingJson: unknown = await existingRes.json();
    const allOrders: Order[] = Array.isArray(existingJson)
      ? (existingJson as Order[])
      : ((existingJson as { data?: Order[] })?.data ?? []);
    return allOrders.find((o: Order) => o.id === orderId)?.notes || "";
  };

  // ── Submit Postpone ──────────────────────────────────────────────────
  const handlePostponeSubmit = async () => {
    if (!postponeModal) return;
    if (!postponeReasonCode) {
      alert(t("reasonRequired"));
      return;
    }
    if (postponeReasonCode === "other" && !postponeReasonText.trim()) {
      alert(t("otherReasonRequired"));
      return;
    }
    const orderId = postponeModal;
    const reasonEntry = POSTPONEMENT_REASONS.find(
      (r) => r.code === postponeReasonCode,
    );
    const reasonDisplay =
      postponeReasonCode === "other"
        ? postponeReasonText.trim()
        : reasonLabel(reasonEntry?.label ?? postponeReasonCode);
    const logAction = `POSTPONED${postponeDate ? ` to ${postponeDate}` : ""} - ${reasonDisplay}`;
    const noteText = `[POSTPONED${postponeDate ? `: ${postponeDate}` : ""}] ${reasonDisplay}`;

    setSubmitting(orderId);
    try {
      const existingNotes = await fetchExistingNotes(orderId);
      const updatedNotes = existingNotes
        ? `${existingNotes}\n${noteText}`
        : noteText;

      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          notes: updatedNotes,
          reasonCode: postponeReasonCode,
          reasonCategory: "postponement",
          reasonText: reasonDisplay,
          driverActionLog: logAction,
        }),
      });
      if (res.ok) {
        setPostponeModal(null);
        setPostponeDate("");
        setPostponeReasonCode("");
        setPostponeReasonText("");
        setScannedOrder(null);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || t("networkError"));
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Submit Delivered (COD confirmation modal) ────────────────────────
  const handleDeliveredSubmit = async () => {
    if (!deliveredModal) return;
    const order = deliveredModal;
    const expectedUsd = order.amountUsd ?? 0;
    const expectedLbp = order.amountLbp ?? 0;
    const actualUsd = parseFloat(deliveredActualUsd) || 0;
    const actualLbp = parseFloat(deliveredActualLbp) || 0;
    const hasDiscrepancy = actualUsd !== expectedUsd || actualLbp !== expectedLbp;
    if (hasDiscrepancy && !deliveredAdjustReason.trim()) {
      alert(t("adjustReasonRequired"));
      return;
    }

    setSubmitting(order.id);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.id,
          location: "DELIVERED",
          financialStatus: "WD",
          collectedUsd: actualUsd,
          collectedLbp: actualLbp,
          expectedCod: expectedUsd,
          actualCodCollected: actualUsd,
          ...(hasDiscrepancy
            ? {
                reasonCategory: "price_adjustment",
                reasonText: deliveredAdjustReason.trim(),
                driverActionLog: "DELIVERED_WITH_PRICE_ADJUSTMENT",
              }
            : { driverActionLog: "DELIVERED" }),
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  location: "DELIVERED",
                  financialStatus: "WD",
                  collectedUsd: actualUsd,
                  collectedLbp: actualLbp,
                }
              : o,
          ),
        );
        setDeliveredModal(null);
        setScannedOrder(null);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || t("deliverFailed"));
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Submit Reject / Return ───────────────────────────────────────────
  const handleRejectSubmit = async () => {
    if (!rejectModal) return;
    if (!rejectReasonCode) {
      alert(t("reasonRequired"));
      return;
    }
    if (rejectReasonCode === "other" && !rejectReasonText.trim()) {
      alert(t("otherReasonRequired"));
      return;
    }
    const order = rejectModal;
    const reasonEntry = REJECTION_REASONS.find(
      (r) => r.code === rejectReasonCode,
    );
    const reasonDisplay =
      rejectReasonCode === "other"
        ? rejectReasonText.trim()
        : reasonLabel(reasonEntry?.label ?? rejectReasonCode);
    const noteText = `[RETURNED] ${reasonDisplay}`;
    const logAction = `RETURNED - ${reasonDisplay}`;

    setSubmitting(order.id);
    try {
      const existingNotes = await fetchExistingNotes(order.id);
      const updatedNotes = existingNotes
        ? `${existingNotes}\n${noteText}`
        : noteText;

      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.id,
          location: "RETURN",
          financialStatus: "Re",
          status: "Re",
          notes: updatedNotes,
          reasonCode: rejectReasonCode,
          reasonCategory: "rejection",
          reasonText: reasonDisplay,
          driverActionLog: logAction,
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, location: "RETURN", financialStatus: "Re" }
              : o,
          ),
        );
        setRejectModal(null);
        setScannedOrder(null);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || t("returnFailed"));
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Submit Note ──────────────────────────────────────────────────────
  const handleNoteSubmit = async () => {
    if (!noteModal) return;
    const orderId = noteModal;

    const allSelected = [];
    if (selectedNote) allSelected.push(selectedNote);
    if (customNote.trim()) allSelected.push(customNote.trim());

    if (allSelected.length === 0) return;

    const noteText = allSelected.join(" | ");
    const logAction = `DRIVER NOTE: ${noteText}`;

    setSubmitting(orderId);
    try {
      // Fetch current order to append to existing notes. The endpoint
      // returns { data, meta } (and now only this driver's own orders), so
      // normalize the shape before looking the order up. Request a large
      // page so older orders are never missing from the lookup window.
      const existingRes = await fetch(`/api/orders?take=5000`);
      const existingJson: unknown = await existingRes.json();
      const allOrders: Order[] = Array.isArray(existingJson)
        ? (existingJson as Order[])
        : ((existingJson as { data?: Order[] })?.data ?? []);
      const existingOrder = allOrders.find((o: Order) => o.id === orderId);
      const existingNotes = existingOrder?.notes || "";
      const updatedNotes = existingNotes
        ? `${existingNotes}\n[DRIVER NOTE] ${noteText}`
        : `[DRIVER NOTE] ${noteText}`;

      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          notes: updatedNotes,
          driverActionLog: logAction,
        }),
      });
      if (res.ok) {
        setNoteModal(null);
        setSelectedNote("");
        setCustomNote("");
        setShowCustomInput(false);
        router.refresh();
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Toggle expanded form for a card ───────────────────────────────────
  // Bulk selection handlers
  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedOrderIds((prev) => {
      if (prev.size === activeOrders.length) {
        return new Set();
      }
      return new Set(activeOrders.map((o) => o.id));
    });
  };

  const clearSelection = () => {
    setSelectedOrderIds(new Set());
    setBulkCollectedUsd({});
    setBulkCollectedLbp({});
  };

  const handleBulkQuickDeliver = async () => {
    if (selectedOrderIds.size === 0) return;
    setSubmitting("bulk");
    try {
      const items = Array.from(selectedOrderIds).map((id) => {
        const order = deliveries.find((o) => o.id === id);
        return {
          id,
          location: "DELIVERED",
          financialStatus: "WD",
          collectedUsd: order?.amountUsd || 0,
          collectedLbp: order?.amountLbp || 0,
          driverActionLog: "BULK_QUICK_DELIVER",
        };
      });

      const res = await fetch("/api/orders/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) throw new Error("Bulk delivery failed");

      const data = await res.json();
      const updatedIds = new Set(
        (data.results || [])
          .filter((r: any) => r.success)
          .map((r: any) => r.id),
      );

      setDeliveries((prev) =>
        prev.map((o) =>
          updatedIds.has(o.id)
            ? { ...o, location: "DELIVERED", financialStatus: "WD" }
            : o,
        ),
      );
      clearSelection();
    } catch (err) {
      console.error("Bulk delivery error:", err);
      alert("Bulk delivery failed. Check console for details.");
    } finally {
      setSubmitting(null);
    }
  };

  const handleBulkCustomDeliver = async () => {
    if (selectedOrderIds.size === 0) return;
    setSubmitting("bulk");
    try {
      const items = Array.from(selectedOrderIds).map((id) => {
        const order = deliveries.find((o) => o.id === id);
        const usd = parseFloat(bulkCollectedUsd[id] || "0") || 0;
        const lbp = parseFloat(bulkCollectedLbp[id] || "0") || 0;
        return {
          id,
          location: "DELIVERED",
          financialStatus: usd > 0 || lbp > 0 ? "WD" : "UD",
          collectedUsd: usd,
          collectedLbp: lbp,
          driverActionLog: "BULK_CUSTOM_DELIVER",
        };
      });

      const res = await fetch("/api/orders/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) throw new Error("Bulk delivery failed");

      const data = await res.json();
      const updatedIds = new Set(
        (data.results || [])
          .filter((r: any) => r.success)
          .map((r: any) => r.id),
      );

      setDeliveries((prev) =>
        prev.map((o) =>
          updatedIds.has(o.id)
            ? { ...o, location: "DELIVERED", financialStatus: "WD" }
            : o,
        ),
      );
      clearSelection();
    } catch (err) {
      console.error("Bulk delivery error:", err);
      alert("Bulk delivery failed. Check console for details.");
    } finally {
      setSubmitting(null);
    }
  };

  // ── Toggle note checkbox (single select) ─────────────────────────────
  const handleNoteSelect = (note: string) => {
    setSelectedNote((prevNote) => (prevNote === note ? "" : note));
  };

  // ── Open/Close modals with cleanup ────────────────────────────────────
  const openPostponeModal = (orderId: string) => {
    setPostponeModal(orderId);
    setPostponeDate("");
    setPostponeReasonCode("");
    setPostponeReasonText("");
  };

  const openDeliveredModal = (order: Order) => {
    setDeliveredModal(order);
    setDeliveredActualUsd(String(order.amountUsd ?? 0));
    setDeliveredActualLbp(String(order.amountLbp ?? 0));
    setDeliveredAdjustReason("");
  };

  const openRejectModal = (order: Order) => {
    setRejectModal(order);
    setRejectReasonCode("");
    setRejectReasonText("");
  };

  const openNoteModal = (orderId: string) => {
    setNoteModal(orderId);
    setSelectedNote("");
    setCustomNote("");
    setShowCustomInput(false);
  };

  // ── Scan Package Handler ──────────────────────────────────────────────
  const handleScanPackage = async (decodedText: string) => {
    setScannerOpen(false);
    setScanError(null);
    setScanSubmitting(true);
    try {
      const res = await fetch("/api/orders/bulk/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [decodedText.trim()] }),
      });
      const { found, notFound } = await res.json();
      if (!found || found.length === 0) {
        setScanError(t("packageNotFound", { id: decodedText.trim() }));
        return;
      }
      setScannedOrder(found[0]);
    } catch {
      setScanError(t("lookupFailed"));
    } finally {
      setScanSubmitting(false);
    }
  };

  // ── Scan Action: Open Delivered (COD) Modal ───────────────────────────
  const handleScanDeliver = () => {
    if (!scannedOrder) return;
    openDeliveredModal(scannedOrder as Order);
  };

  // ── Scan Action: Open Reject / Return Modal ───────────────────────────
  const handleScanReturn = () => {
    if (!scannedOrder) return;
    openRejectModal(scannedOrder as Order);
  };

  // ── Scan Action: Pick Up from Warehouse ───────────────────────────────
  const handleScanPickup = async () => {
    if (!scannedOrder) return;
    setScanSubmitting(true);
    try {
      await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scannedOrder.id,
          driverId: driver.id,
          location: "ASSIGNED",
          financialStatus: "UD",
          collectedUsd: 0,
          collectedLbp: 0,
          driverActionLog: "PICKED_UP via Scanner",
        }),
      });
      setScannedOrder(null);
      router.refresh();
    } catch {
      alert("Failed to pick up order.");
    } finally {
      setScanSubmitting(false);
    }
  };

  // ── Scan Action: Open Postpone (reuses existing postpone modal) ────────
  const handleScanPostpone = () => {
    if (!scannedOrder) return;
    openPostponeModal(scannedOrder.id);
  };

  return (
    <div
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="w-full min-h-screen bg-gray-950 text-white font-sans"
    >
      {/* ── Sticky Header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4 py-4">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">
              {driver.firstName} {driver.lastName}
            </h1>
            <p className="text-xs text-gray-500">{t("dashboard")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLang}
              aria-label={t("langToggleTitle")}
              title={t("langToggleTitle")}
              className="px-2.5 py-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/30 rounded-lg bg-cyan-500/10 transition-colors"
            >
              {t("switchLang")}
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="px-2.5 py-1.5 text-lg text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 border border-white/10 rounded-lg transition-colors"
              title="Account Settings"
            >
              ⚙️
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-bold text-red-400 border border-red-500/30 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
            >
              {t("logout")}
            </button>
            <span className="text-xs text-gray-400">{t("active")}</span>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 text-sm font-bold border border-cyan-500/30">
              {activeCount}
            </span>
          </div>
        </div>
      </header>

      {/* ── Sticky Tab Menu ────────────────────────────────────────────── */}
      <div className="sticky top-[73px] z-10 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4">
        <div className="max-w-7xl mx-auto w-full flex gap-1 py-2">
          <button
            onClick={() => setActiveTab("ACTIVE")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
              activeTab === "ACTIVE"
                ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            {t("tabActive")} ({activeOrders.length})
          </button>
          <button
            onClick={() => setActiveTab("DELIVERED")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
              activeTab === "DELIVERED"
                ? "bg-green-500/20 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            {t("tabDelivered")} ({deliveredOrders.length})
          </button>
          <button
            onClick={() => setActiveTab("WAREHOUSE")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
              activeTab === "WAREHOUSE"
                ? "bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            {t("tabWarehouse")} ({warehouseOrders.length})
          </button>
          <button
            onClick={() => setActiveTab("PAYOUTS")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
              activeTab === "PAYOUTS"
                ? "bg-violet-500/20 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            {t("tabPayouts")}
          </button>
        </div>
      </div>

      {/* ── Bulk Action Bar (shown when orders are selected) ─────────────── */}
      {selectedOrderIds.size > 0 && activeTab === "ACTIVE" && (
        <div className="sticky z-20 bg-cyan-500/10 backdrop-blur border-y border-cyan-500/30 px-4">
          <div className="max-w-7xl mx-auto w-full flex flex-col gap-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSelectAll}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
                >
                  {selectedOrderIds.size === activeOrders.length
                    ? t("deselectAll")
                    : t("selectAll")}
                </button>
                <span className="text-sm font-bold text-white">
                  {selectedOrderIds.size} {t("ordersSelected")}
                </span>
              </div>
              <button
                onClick={clearSelection}
                className="text-xs text-gray-400 hover:text-white"
              >
                {t("clear")}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setBulkMode("quick")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  bulkMode === "quick"
                    ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/40"
                    : "bg-white/5 text-gray-400 border border-white/10 hover:text-gray-300"
                }`}
              >
                {t("quickDeliverFull")}
              </button>
              <button
                onClick={() => setBulkMode("custom")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  bulkMode === "custom"
                    ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/40"
                    : "bg-white/5 text-gray-400 border border-white/10 hover:text-gray-300"
                }`}
              >
                {t("customAmount")}
              </button>
              <div className="flex-1" />
              <button
                onClick={handleBulkQuickDeliver}
                disabled={submitting !== null}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50"
              >
                {submitting === "bulk"
                  ? t("processing")
                  : t("deliverN", { n: selectedOrderIds.size })}
              </button>
            </div>

            {bulkMode === "custom" && (
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider">
                  {t("perOrderAmounts")}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                  {Array.from(selectedOrderIds).map((id) => {
                    const order = deliveries.find((o) => o.id === id);
                    if (!order) return null;
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2 bg-white/5 rounded p-2"
                      >
                        <span className="text-[10px] text-cyan-400 font-mono flex-shrink-0 w-16 truncate">
                          {order.orderId}
                        </span>
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="USD"
                            value={bulkCollectedUsd[id] || ""}
                            onChange={(e) =>
                              setBulkCollectedUsd((prev) => ({
                                ...prev,
                                [id]: e.target.value,
                              }))
                            }
                            className="w-full px-2 py-1 rounded bg-gray-900/50 border border-white/10 text-green-400 text-xs font-mono"
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="LBP"
                            value={bulkCollectedLbp[id] || ""}
                            onChange={(e) =>
                              setBulkCollectedLbp((prev) => ({
                                ...prev,
                                [id]: e.target.value,
                              }))
                            }
                            className="w-full px-2 py-1 rounded bg-gray-900/50 border border-white/10 text-yellow-400 text-xs font-mono"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={handleBulkCustomDeliver}
                  disabled={submitting !== null}
                  className="mt-3 w-full px-4 py-2 rounded-lg text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50"
                >
                  {submitting === "bulk"
                    ? t("processing")
                    : t("deliverCustom")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <main className="px-4 py-6 pb-24 max-w-7xl mx-auto w-full">
        {/* ═══════════════════════════════════════════════════════════════
            ACTIVE TAB
            ════════════════════════════════════════════════════════════ */}
        {activeTab === "ACTIVE" && (
          <>
            {activeOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-1.414 1.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-1.414-1.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 font-medium">{t("noActive")}</p>
                <p className="text-gray-600 text-sm mt-1">
                  {t("allCaughtUp")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {activeOrders.map((order) => {
                  const isSubmitting = submitting === order.id;

                  return (
                    <div
                      key={order.id}
                      className={`bg-white/[0.03] border rounded-xl overflow-hidden flex flex-col transition-colors ${
                        selectedOrderIds.has(order.id)
                          ? "border-cyan-500/50 bg-cyan-500/5"
                          : "border-white/10"
                      }`}
                    >
                      {/* ── Card Header with Checkbox ──────────────────────── */}
                      <div className="flex items-center justify-between px-4 pt-3 pb-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.has(order.id)}
                            onChange={() => toggleOrderSelection(order.id)}
                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                          />
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                            {t("select")}
                          </span>
                        </label>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            order.location === "DELIVERED"
                              ? "bg-green-500/20 text-green-400"
                              : order.location === "WITH_DRIVER"
                                ? "bg-yellow-500/20 text-yellow-400"
                                : "bg-blue-500/20 text-blue-400"
                          }`}
                        >
                          {order.location}
                        </span>
                      </div>
                      {/* ── Card Body ──────────────────────────────────────── */}
                      <div className="p-4 pt-1 flex-1">
                        {/* Tracking ID + Phone */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                setHistoryModalOrder({
                                  id: order.id,
                                  history: [],
                                })
                              }
                              title={t("orderHistoryTitle")}
                              className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                            >
                              &#9776;
                            </button>
                            <span className="font-mono text-cyan-400 text-sm font-semibold">
                              {order.orderId}
                            </span>
                          </div>
                          <a
                            href={`tel:${order.customerPhone}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold border border-green-500/20 hover:bg-green-500/20 transition-colors"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                              />
                            </svg>
                            {t("callCustomer")}
                          </a>
                        </div>

                        {/* Customer Name & Phone */}
                        <h2 className="text-white font-semibold text-base mb-1">
                          {order.customerName}
                        </h2>
                        <p className="text-gray-500 text-xs font-mono mb-1">
                          📞 {order.customerPhone}
                        </p>

                        {/* Address */}
                        <p className="text-gray-400 text-sm mb-3 leading-relaxed">
                          {order.customerAddress}
                        </p>

                        {/* Delivery Preference Chip */}
                        {order.deliveryPreference && (
                          <div className="mb-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30">
                              📌 {order.deliveryPreference}
                            </span>
                          </div>
                        )}

                        {/* Customer Delivery Notes / Gate Code */}
                        {order.deliveryNotes && (
                          <div className="mb-3 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <svg
                              className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <div className="text-xs text-amber-200 leading-relaxed">
                              <span className="block text-[10px] font-bold text-amber-300 uppercase tracking-wider mb-0.5">
                                {t("customerNotes")}
                              </span>
                              {order.deliveryNotes}
                            </div>
                          </div>
                        )}

                        {/* Amounts */}
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-green-400 font-mono font-semibold">
                            ${(order.amountUsd ?? 0).toFixed(2)}
                          </span>
                          <span className="text-yellow-400 font-mono font-semibold">
                            {(order.amountLbp ?? 0).toLocaleString()} LL
                          </span>
                        </div>
                      </div>

                      {/* ── GPS Navigation (large, tap-friendly) ───────────────── */}
                      {order.latitude != null && order.longitude != null && (
                        <div className="px-4 mt-4">
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${order.latitude},${order.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full px-4 py-4 rounded-xl text-base font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 active:bg-cyan-500/40 transition-colors shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            {t("navigateGps")}
                          </a>
                        </div>
                      )}

                      {/* ── Action Buttons (Quick Deliver + 2x2 Grid) ──────────── */}
                      <div className="grid grid-cols-2 gap-2 mt-4 px-4 pb-4">
                        <button
                          onClick={() => openDeliveredModal(order)}
                          disabled={isSubmitting}
                          className="col-span-2 px-4 py-3 rounded-lg text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                        >
                          {t("quickDeliverBtn")}
                        </button>
                        <button
                          onClick={() => openDeliveredModal(order)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-white/[0.03] hover:text-emerald-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          {t("customCollectBtn")}
                        </button>
                        <button
                          onClick={() => openRejectModal(order)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-red-500/10 hover:text-red-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          {t("markReturnBtn")}
                        </button>
                        <button
                          onClick={() => openPostponeModal(order.id)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-amber-500/10 hover:text-amber-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          {t("postponeBtn")}
                        </button>
                        <button
                          onClick={() => openNoteModal(order.id)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-blue-500/10 hover:text-blue-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          {t("addNoteBtn")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            DELIVERED TAB
            ════════════════════════════════════════════════════════════ */}
        {activeTab === "DELIVERED" && (
          <>
            {deliveredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 font-medium">{t("noDelivered")}</p>
                <p className="text-gray-600 text-sm mt-1">
                  {t("completedHere")}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {deliveredOrders.map((order) => {
                    const isSubmitting = submitting === order.id;

                    return (
                      <div
                        key={order.id}
                        className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden flex flex-col"
                      >
                        {/* ── Card Body ──────────────────────────────────── */}
                        <div className="p-4 flex-1">
                          {/* Tracking ID */}
                          <div className="flex items-center gap-2 mb-3">
                            <button
                              onClick={() =>
                                setHistoryModalOrder({
                                  id: order.id,
                                  history: [],
                                })
                              }
                              title={t("orderHistoryTitle")}
                              className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                            >
                              &#9776;
                            </button>
                            <span className="font-mono text-green-400 text-sm font-semibold">
                              {order.orderId}
                            </span>
                          </div>

                          {/* Customer Name & Phone */}
                          <h2 className="text-white font-semibold text-base mb-1">
                            {order.customerName}
                          </h2>
                          <p className="text-gray-500 text-xs font-mono mb-1">
                            📞 {order.customerPhone}
                          </p>

                          {/* Address */}
                          <p className="text-gray-400 text-sm mb-3 leading-relaxed">
                            {order.customerAddress}
                          </p>

                          {/* Cash Collected */}
                          <div className="flex items-center gap-4 text-sm border-t border-white/5 pt-3 mt-3">
                            <span className="text-gray-400 text-xs uppercase tracking-wider">
                              {t("collectedLabel")}
                            </span>
                            <span className="text-green-400 font-mono font-semibold">
                              ${(order.collectedUsd ?? 0).toFixed(2)}
                            </span>
                            <span className="text-yellow-400 font-mono font-semibold">
                              {(order.collectedLbp ?? 0).toLocaleString()} LL
                            </span>
                          </div>
                        </div>

                        {/* ── Action Button ─────────────────────────────── */}
                        <div className="px-4 pb-4">
                          <button
                            onClick={() => handleCancelDelivery(order.id)}
                            disabled={
                              isSubmitting || submitting === "__payout__"
                            }
                            className="w-full px-4 py-3 rounded-lg text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                          >
                            {isSubmitting
                              ? t("canceling")
                              : t("cancelDeliveryBtn")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Payout Footer ─────────────────────────────────────── */}
                <div className="mt-8 p-6 bg-white/[0.03] border border-white/10 rounded-2xl">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
                        {t("endOfDayPayout")}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {t("totalCollectedAcross", { n: deliveredOrders.length })}
                      </p>
                      <div className="flex items-center gap-4 mt-1.5">
                        <span className="text-green-400 font-mono font-bold text-lg">
                          ${payoutReceipt.totalUsdCollected.toFixed(2)}
                        </span>
                        <span className="text-yellow-400 font-mono font-bold text-lg">
                          {payoutReceipt.totalLbpCollected.toLocaleString()} LL
                        </span>
                      </div>
                      {payoutReceipt.missingRateOrderCount > 0 && (
                        <div className="mt-2 border border-red-500/40 bg-red-500/10 rounded-md px-3 py-2 text-xs text-red-300">
                          <span className="font-bold">{t("rateNotConfigured")}</span>{" "}
                          ({payoutReceipt.missingRateOrderCount}) — the payout
                          cannot be sent until a seller or zone rate is set.
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleOpenPayoutModal}
                      disabled={
                        submitting === "__payout__" ||
                        payoutReceipt.missingRateOrderCount > 0
                      }
                      className="px-6 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 transition-all shadow-lg shadow-green-500/20"
                    >
                      {submitting === "__payout__"
                        ? t("submitting")
                        : t("sendToOffice")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            WAREHOUSE TAB
            ════════════════════════════════════════════════════════════ */}
        {activeTab === "WAREHOUSE" && (
          <>
            {initialAssignedZones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-1.414 1.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-1.414-1.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 font-medium">{t("noZones")}</p>
                <p className="text-gray-600 text-sm mt-1">
                  {t("noZonesHint")}
                </p>
              </div>
            ) : warehouseOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 font-medium">{t("noOrders")}</p>
                <p className="text-gray-600 text-sm mt-1">
                  {t("noOrdersHint")}
                </p>
              </div>
            ) : (
              <>
                {/* Zone sub-tabs */}
                <div className="flex gap-1 mb-6 p-1 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 overflow-x-auto">
                  {initialAssignedZones.map((zone) => {
                    const count = warehouseOrders.filter(
                      (o) => o.zoneId === zone.id,
                    ).length;
                    return (
                      <button
                        key={zone.id}
                        onClick={() => setActiveWarehouseZone(zone.id)}
                        className={`whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                          activeWarehouseZone === zone.id
                            ? "bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                            : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                        }`}
                      >
                        {zone.name} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Orders for selected zone */}
                {(() => {
                  const zoneOrders = warehouseOrders.filter(
                    (o) => o.zoneId === activeWarehouseZone,
                  );
                  if (zoneOrders.length === 0) {
                    return (
                      <div className="text-center py-16">
                        <p className="text-gray-500 text-sm">
                          {t("noOrdersZone")}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {zoneOrders.map((order) => (
                        <div
                          key={order.id}
                          className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden flex flex-col"
                        >
                          {/* Card Body */}
                          <div className="p-4 flex-1">
                            {/* Tracking ID */}
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-mono text-amber-400 text-sm font-semibold">
                                {order.orderId}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-yellow-500/20 text-yellow-400">
                                WAREHOUSE
                              </span>
                            </div>

                            {/* Customer Details */}
                            <h2 className="text-white font-semibold text-base mb-1">
                              {order.customerName}
                            </h2>
                            <p className="text-gray-500 text-xs font-mono mb-1">
                              📞 {order.customerPhone}
                            </p>
                            <p className="text-gray-400 text-sm mb-3 leading-relaxed">
                              {order.customerAddress}
                            </p>

                            {/* Seller & Zone Info */}
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 text-gray-400 border border-white/10">
                                📦 {order.merchant?.merchantName || "—"}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                🏭 {order.zone?.name || "—"}
                              </span>
                            </div>

                            {/* Amounts */}
                            <div className="flex items-center gap-4 text-sm border-t border-white/5 pt-3 mt-3">
                              <span className="text-green-400 font-mono font-semibold">
                                ${(order.amountUsd ?? 0).toFixed(2)}
                              </span>
                              <span className="text-yellow-400 font-mono font-semibold">
                                {(order.amountLbp ?? 0).toLocaleString()} LL
                              </span>
                            </div>
                          </div>

                          {/* Pick Up Button */}
                          <div className="px-4 pb-4">
                            <button
                              onClick={() => handlePickupOrder(order.id)}
                              disabled={warehousePickupSubmitting === order.id}
                              className="w-full px-4 py-3 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                            >
                              {warehousePickupSubmitting === order.id
                                ? t("pickingUp")
                                : t("pickupBtn")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PAYOUT HISTORY TAB
            ════════════════════════════════════════════════════════════ */}
        {activeTab === "PAYOUTS" && (
          <div>
            {/* ── Filter Ribbon ── */}
            <div className="bg-[#121824] border border-white/5 rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Status */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Status
                </label>
                <select
                  value={payoutStatusFilter}
                  onChange={(e) => setPayoutStatusFilter(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                >
                  <option value="ALL">All</option>
                  <option value="CLEARED">Cleared</option>
                  <option value="PAID">Paid</option>
                  <option value="PENDING">Pending</option>
                </select>
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={payoutStartDate}
                  onChange={(e) => setPayoutStartDate(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors [color-scheme:dark]"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  value={payoutEndDate}
                  onChange={(e) => setPayoutEndDate(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors [color-scheme:dark]"
                />
              </div>

              {/* Sort */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Sort by Date
                </label>
                <button
                  onClick={() =>
                    setPayoutSortOrder((prev) =>
                      prev === "desc" ? "asc" : "desc",
                    )
                  }
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white hover:border-cyan-500/50 transition-colors text-left flex justify-between items-center"
                >
                  <span>
                    {payoutSortOrder === "desc"
                      ? "↓ Newest First"
                      : "↑ Oldest First"}
                  </span>
                  <span className="text-gray-500 text-xs">↻</span>
                </button>
              </div>
            </div>

            {/* ── Payouts Table ── */}
            <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold">Payout #</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Net USD
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Amount Paid
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Carried Debt
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
                    {payoutLoading ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="text-center py-12 text-gray-500"
                        >
                          Loading payout history...
                        </td>
                      </tr>
                    ) : payoutHistory.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="text-center py-12 text-gray-500 italic"
                        >
                          No payouts found matching the current filters.
                        </td>
                      </tr>
                    ) : (
                      payoutHistory.map((payout) => {
                        const isExpanded = expandedPayoutIds.includes(
                          payout.id,
                        );
                        const carriedDebtUsd = payout.remainingUsd ?? 0;
                        const hasShortPay = carriedDebtUsd > 0.01;

                        return (
                          <Fragment key={payout.id}>
                            {/* Main row */}
                            <tr
                              onClick={() => togglePayoutExpanded(payout.id)}
                              className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
                            >
                              <td className="px-4 py-3 font-mono text-cyan-400 text-sm">
                                #{payout.sequentialIndex}
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-xs">
                                {beirutDate(
                                  payout.clearedAt || payout.createdAt,
                                )}
                                {payout.createdBy?.username && (
                                  <span className="block text-gray-600">
                                    by {payout.createdBy.username}
                                  </span>
                                )}
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
                                {hasShortPay
                                  ? `$${carriedDebtUsd.toFixed(2)}`
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
                                    onClick={() =>
                                      handleViewPrintPayout(payout)
                                    }
                                    disabled={
                                      !payout.orders ||
                                      payout.orders.length === 0
                                    }
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
                                    onClick={() => exportPayoutToExcel(payout)}
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
                                  colSpan={8}
                                  className="bg-[#0a0f1a] border-b border-white/10 px-6 py-5"
                                >
                                  <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                                      Itemized Orders — Payout #
                                      {payout.sequentialIndex}
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
                                              Date Received
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Tracking ID
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Customer
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Address
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Phone
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Zone
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Fin. Status
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Seller
                                            </th>
                                            <th className="px-4 py-2 font-semibold">
                                              Location
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
                                              Commission
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
                                                className={`border-b border-white/5 text-sm transition-colors ${
                                                  isMismatched
                                                    ? "bg-yellow-500/20"
                                                    : "hover:bg-white/[0.02]"
                                                }`}
                                              >
                                                <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                                                  {beirutDate(order.createdAt)}
                                                </td>
                                                <td className="px-4 py-2 font-mono text-cyan-400">
                                                  {order.orderId}
                                                </td>
                                                <td className="px-4 py-2 text-gray-300">
                                                  {order.customerName}
                                                </td>
                                                <td className="px-4 py-2 text-gray-400 text-xs max-w-[160px] truncate">
                                                  {order.customerAddress || "—"}
                                                </td>
                                                <td className="px-4 py-2 text-gray-400 font-mono text-xs">
                                                  {order.customerPhone || "—"}
                                                </td>
                                                <td className="px-4 py-2 text-gray-400">
                                                  {order.zone?.name || "—"}
                                                </td>
                                                <td className="px-4 py-2">
                                                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-white/5 border border-white/10">
                                                    {order.financialStatus ||
                                                      "—"}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2 text-gray-400">
                                                  {order.merchant
                                                    ?.merchantName || "—"}
                                                </td>
                                                <td className="px-4 py-2 text-gray-500 text-xs">
                                                  {order.location || "—"}
                                                </td>
                                                <td className="px-4 py-2 text-green-400 text-right font-mono">
                                                  $
                                                  {(
                                                    order.amountUsd ?? 0
                                                  ).toFixed(2)}
                                                </td>
                                                <td className="px-4 py-2 text-yellow-400 text-right font-mono">
                                                  {(
                                                    order.amountLbp ?? 0
                                                  ).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-2 text-green-400 text-right font-mono">
                                                  $
                                                  {(
                                                    order.collectedUsd ?? 0
                                                  ).toFixed(2)}
                                                </td>
                                                <td className="px-4 py-2 text-yellow-400 text-right font-mono">
                                                  {(
                                                    order.collectedLbp ?? 0
                                                  ).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-2 text-cyan-400 text-right font-mono">
                                                  {order.driverCommissionUsd == null
                                                    ? "—"
                                                    : `$${order.driverCommissionUsd.toFixed(2)}`}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
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
          </div>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════════════
          POSTPONE MODAL (standardized reason picker)
          ════════════════════════════════════════════════════════════════ */}
      {postponeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPostponeModal(null)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-4">
              {t("postponeTitle")}
            </h2>

            {/* Optional Date Picker */}
            <label className="block text-xs text-gray-400 mb-1.5">
              {t("newDate")}
            </label>
            <input
              type="date"
              value={postponeDate}
              onChange={(e) => setPostponeDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 mb-4"
            />

            {/* Reason Radio List */}
            <p className="text-xs text-gray-400 mb-2">{t("reasonTitle")}</p>
            <div className="space-y-2 mb-4">
              {POSTPONEMENT_REASONS.map((reason) => (
                <label
                  key={reason.code}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    postponeReasonCode === reason.code
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                      : "bg-gray-800/50 border-white/10 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="postpone_reason"
                    checked={postponeReasonCode === reason.code}
                    onChange={() => setPostponeReasonCode(reason.code)}
                    className="w-4 h-4 border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500/50 focus:ring-offset-0"
                  />
                  <span className="text-sm">{reasonLabel(reason.label)}</span>
                </label>
              ))}
            </div>

            {/* Custom "Other" Text */}
            {postponeReasonCode === "other" && (
              <textarea
                placeholder={t("otherPlaceholder")}
                value={postponeReasonText}
                onChange={(e) => setPostponeReasonText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 mb-4 resize-none"
              />
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setPostponeModal(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handlePostponeSubmit}
                disabled={
                  !postponeReasonCode ||
                  (postponeReasonCode === "other" &&
                    !postponeReasonText.trim()) ||
                  submitting === postponeModal
                }
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-amber-500/20"
              >
                {submitting === postponeModal
                  ? t("saving")
                  : t("confirmPostpone")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          DELIVERED (COD CONFIRMATION) MODAL
          ════════════════════════════════════════════════════════════════ */}
      {deliveredModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeliveredModal(null)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-1">
              {t("deliveredTitle")}
            </h2>
            <p className="font-mono text-cyan-400 text-sm mb-4">
              {deliveredModal.orderId}
            </p>

            {/* Expected COD (read-only) */}
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10">
              <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                {t("expectedCod")}
              </span>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-400 font-mono font-semibold">
                  ${(deliveredModal.amountUsd ?? 0).toFixed(2)}
                </span>
                <span className="text-yellow-400 font-mono font-semibold">
                  {(deliveredModal.amountLbp ?? 0).toLocaleString()} LL
                </span>
              </div>
            </div>

            {/* Actual Collected Inputs */}
            <label className="block text-xs text-gray-400 mb-1.5">
              {t("actualCollected")}
            </label>
            <div className="flex gap-2 mb-4">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="USD"
                value={deliveredActualUsd}
                onChange={(e) => setDeliveredActualUsd(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30"
              />
              <input
                type="number"
                step="1"
                min="0"
                placeholder="LBP"
                value={deliveredActualLbp}
                onChange={(e) => setDeliveredActualLbp(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30"
              />
            </div>

            {/* Discrepancy Alert + Required Adjustment Reason */}
            {(() => {
              const expectedUsd = deliveredModal.amountUsd ?? 0;
              const expectedLbp = deliveredModal.amountLbp ?? 0;
              const actualUsd = parseFloat(deliveredActualUsd) || 0;
              const actualLbp = parseFloat(deliveredActualLbp) || 0;
              const hasDiscrepancy =
                actualUsd !== expectedUsd || actualLbp !== expectedLbp;
              if (!hasDiscrepancy) return null;
              return (
                <div className="mb-4">
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-3">
                    <svg
                      className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <p className="text-xs text-amber-200 leading-relaxed">
                      {t("discrepancyAlert")}
                    </p>
                  </div>
                  <label className="block text-xs text-amber-300 mb-1.5">
                    {t("adjustReasonLabel")}
                  </label>
                  <textarea
                    placeholder={t("adjustReasonPlaceholder")}
                    value={deliveredAdjustReason}
                    onChange={(e) => setDeliveredAdjustReason(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-amber-500/30 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 resize-none"
                  />
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setDeliveredModal(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleDeliveredSubmit}
                disabled={submitting === deliveredModal.id}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-green-500/20"
              >
                {submitting === deliveredModal.id
                  ? t("submitting")
                  : t("confirmDelivery")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          REJECT / RETURN MODAL (standardized reason picker)
          ════════════════════════════════════════════════════════════════ */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setRejectModal(null)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-1">
              {t("rejectTitle")}
            </h2>
            <p className="font-mono text-cyan-400 text-sm mb-4">
              {rejectModal.orderId}
            </p>

            {/* COD $0.00 Warning */}
            <div className="mb-3 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <svg
                className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-red-200 leading-relaxed">
                {t("codWarning")}
              </p>
            </div>

            {/* Package Return Notice */}
            <div className="mb-4 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <svg
                className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-blue-200 leading-relaxed">
                {t("returnNotice")}
              </p>
            </div>

            {/* Reason Radio List */}
            <p className="text-xs text-gray-400 mb-2">{t("reasonTitle")}</p>
            <div className="space-y-2 mb-4">
              {REJECTION_REASONS.map((reason) => (
                <label
                  key={reason.code}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    rejectReasonCode === reason.code
                      ? "bg-red-500/10 border-red-500/30 text-red-300"
                      : "bg-gray-800/50 border-white/10 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="reject_reason"
                    checked={rejectReasonCode === reason.code}
                    onChange={() => setRejectReasonCode(reason.code)}
                    className="w-4 h-4 border-gray-600 bg-gray-700 text-red-500 focus:ring-red-500/50 focus:ring-offset-0"
                  />
                  <span className="text-sm">{reasonLabel(reason.label)}</span>
                </label>
              ))}
            </div>

            {/* Custom "Other" Text */}
            {rejectReasonCode === "other" && (
              <textarea
                placeholder={t("otherPlaceholder")}
                value={rejectReasonText}
                onChange={(e) => setRejectReasonText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 mb-4 resize-none"
              />
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleRejectSubmit}
                disabled={
                  !rejectReasonCode ||
                  (rejectReasonCode === "other" &&
                    !rejectReasonText.trim()) ||
                  submitting === rejectModal.id
                }
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-red-500/20"
              >
                {submitting === rejectModal.id
                  ? t("saving")
                  : t("confirmReturn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          ADD NOTE MODAL
          ════════════════════════════════════════════════════════════════ */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setNoteModal(null)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-4">
              {t("noteTitle")}
            </h2>

            {/* Note Checkboxes */}
            <div className="space-y-2.5 mb-4">
              {NOTE_OPTIONS.map((note) => (
                <label
                  key={note}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedNote === note
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                      : "bg-gray-800/50 border-white/10 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedNote === note}
                    onChange={() => handleNoteSelect(note)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0"
                  />
                  <span className="text-sm">{note}</span>
                </label>
              ))}
            </div>

            {/* Custom Checkbox */}
            <label
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors mb-4 ${
                showCustomInput
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                  : "bg-gray-800/50 border-white/10 text-gray-300 hover:bg-gray-800"
              }`}
            >
              <input
                type="checkbox"
                checked={showCustomInput}
                onChange={(e) => {
                  setShowCustomInput(e.target.checked);
                  if (!e.target.checked) setCustomNote("");
                }}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0"
              />
              <span className="text-sm">{t("customLabel")}</span>
            </label>

            {/* Custom Text Input */}
            {showCustomInput && (
              <input
                type="text"
                placeholder={t("customNotePlaceholder")}
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 mb-4"
              />
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setNoteModal(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleNoteSubmit}
                disabled={
                  submitting === noteModal ||
                  (!selectedNote && !customNote.trim())
                }
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-blue-500/20"
              >
                {submitting === noteModal ? t("saving") : t("saveNote")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          PAYOUT SETTLEMENT MODAL
          ════════════════════════════════════════════════════════════════ */}
      {payoutModalOpen && (
        <ConfirmPayoutModal
          orders={deliveredOrders}
          totalUsd={payoutReceipt.totalUsdCollected}
          totalLbp={payoutReceipt.totalLbpCollected}
          commissionLines={payoutReceipt.commissionLines}
          totalCommissionUsd={payoutReceipt.totalCommissionUsd}
          missingRateOrderCount={payoutReceipt.missingRateOrderCount}
          onConfirm={handleConfirmPayout}
          onCancel={() => setPayoutModalOpen(false)}
          submitting={submitting === "__payout__"}
        />
      )}

      {/* ── Settings Modal ──────────────────────────────────────────────── */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* ── Order History Modal ──────────────────────────────────────────── */}
      {historyModalOrder && (
        <OrderHistoryModal
          orderId={historyModalOrder.id}
          initialHistory={historyModalOrder.history}
          onClose={() => setHistoryModalOrder(null)}
        />
      )}

      {/* ════════════════════════════════════════ */}
      {/* SCAN-TO-ACTION QUICK MODAL              */}
      {/* ════════════════════════════════════════ */}
      {scannedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setScannedOrder(null)}
          />
          <div className="relative z-10 w-full max-w-sm bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-1">
              {t("scannedPackage")}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {t("chooseAction")}
            </p>

            {/* Order summary */}
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 mb-5 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t("orderIdLabel")}</span>
                <span className="text-cyan-400 font-mono font-semibold">
                  {scannedOrder.orderId}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t("statusLabel")}</span>
                <span className="text-gray-300">
                  {scannedOrder.location || "—"} /{" "}
                  {scannedOrder.financialStatus || "—"}
                </span>
              </div>
              {scannedOrder.driver && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">{t("driverLabel")}</span>
                  <span className="text-yellow-400">
                    {scannedOrder.driver.firstName}{" "}
                    {scannedOrder.driver.lastName}
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons — 2x2 grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={handleScanDeliver}
                disabled={scanSubmitting}
                className="px-4 py-3 rounded-xl text-sm font-bold
                           bg-green-500/20 text-green-400 border border-green-500/30
                           hover:bg-green-500/30 transition-colors disabled:opacity-50"
              >
                {t("markDeliveredBtn")}
              </button>
              <button
                onClick={handleScanReturn}
                disabled={scanSubmitting}
                className="px-4 py-3 rounded-xl text-sm font-bold
                           bg-red-500/20 text-red-400 border border-red-500/30
                           hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {t("markReturnBtn")}
              </button>
              <button
                onClick={handleScanPostpone}
                disabled={scanSubmitting}
                className="px-4 py-3 rounded-xl text-sm font-bold
                           bg-amber-500/20 text-amber-400 border border-amber-500/30
                           hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {t("postponeBtn")}
              </button>
              {String(scannedOrder.location).toUpperCase() === "WAREHOUSE" && (
                <button
                  onClick={handleScanPickup}
                  disabled={scanSubmitting}
                  className="px-4 py-3 rounded-xl text-sm font-bold
                             bg-amber-500/20 text-amber-400 border border-amber-500/30
                             hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                >
                  {t("pickUpBtn")}
                </button>
              )}
            </div>

            {/* Dismiss / Scan Next */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setScannedOrder(null);
                  // Re-open scanner for next package
                  setTimeout(() => setScannerOpen(true), 200);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                           bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                           hover:bg-cyan-500/30 transition-colors"
              >
                {t("scanNext")}
              </button>
              <button
                onClick={() => setScannedOrder(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                           bg-white/5 text-gray-400 border border-white/10
                           hover:bg-white/10 hover:text-white transition-colors"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════ */}
      {/* SCAN ERROR TOAST                       */}
      {/* ════════════════════════════════════════ */}
      {scanError && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-red-500/90 backdrop-blur border border-red-400/30 rounded-xl text-white text-sm font-medium shadow-lg max-w-sm text-center">
          {scanError}
          <button
            onClick={() => setScanError(null)}
            className="ml-3 text-red-200 hover:text-white underline text-xs"
          >
            {t("dismiss")}
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════ */}
      {/* FLOATING ACTION BUTTON — SCAN PACKAGE   */}
      {/* ════════════════════════════════════════ */}
      {(activeTab === "ACTIVE" || activeTab === "WAREHOUSE") && (
        <button
          onClick={() => setScannerOpen(true)}
          className={`fixed bottom-6 z-30 flex flex-col items-center gap-1
                     w-16 h-16 rounded-full
                     bg-gradient-to-br from-cyan-500 to-purple-600
                     text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]
                     hover:shadow-[0_0_32px_rgba(6,182,212,0.6)]
                     hover:scale-105 active:scale-95
                     transition-all duration-200 ${
                       lang === "ar" ? "left-6" : "right-6"
                     }`}
          title={t("scanFabTitle")}
        >
          <span className="text-2xl mt-2.5">📷</span>
        </button>
      )}

      {/* ════════════════════════════════════════ */}
      {/* BARCODE SCANNER MODAL                   */}
      {/* ════════════════════════════════════════ */}
      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleScanPackage}
        heading={t("scanHeading")}
      />
    </div>
  );
}
