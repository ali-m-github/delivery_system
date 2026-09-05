"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import SharedOrderTable, {
  formatDDMMYYYY,
  SortableTh,
  getOrderSortValue,
  compareSortValues,
} from "@/components/SharedOrderTable";
import GlobalSheetImportModal from "@/components/orders/GlobalSheetImportModal";
import OrderHistoryModal from "@/components/OrderHistoryModal";
import BarcodeScannerModal from "@/components/BarcodeScannerModal";
import PermissionGuard from "@/components/PermissionGuard";
import { hasPermission } from "@/lib/permissions";

// ─── Header Alias Mapping for Bulk Upload ─────────────────────────────────────
const HEADER_ALIASES: Record<string, string> = {
  // orderId aliases
  "order id": "orderId",
  order_id: "orderId",
  orderid: "orderId",
  tracking: "orderId",
  barcode: "orderId",
  id: "orderId",
  // seller aliases
  "seller id": "seller",
  seller_id: "seller",
  seller: "seller",
  merchant: "seller",
  "merchant id": "seller",
  store: "seller",
  // customer aliases
  customer: "customer",
  "customer name": "customer",
  client: "customer",
  "client name": "customer",
  recipient: "customer",
  name: "customer",
  // phone aliases
  "tel number": "phone",
  tel: "phone",
  telephone: "phone",
  "mobile number": "phone",
  mobile: "phone",
  "phone number": "phone",
  phone: "phone",
  contact: "phone",
  phone_number: "phone",
  // address aliases
  address: "address",
  "delivery address": "address",
  location: "address",
  destination: "address",
  // zone aliases
  zone: "zone",
  area: "zone",
  region: "zone",
  // usd aliases
  amount$: "usd",
  amount: "usd",
  "amount usd": "usd",
  usd: "usd",
  "usd amount": "usd",
  price: "usd",
  total: "usd",
  // lbp aliases
  "amount lbp": "lbp",
  lbp: "lbp",
  "lbp amount": "lbp",
  "price lbp": "lbp",
  // date received aliases
  "date rcvd": "dateReceived",
  "date received": "dateReceived",
  "received date": "dateReceived",
  received: "dateReceived",
  date: "dateReceived",
};

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[$#@!&*()%~`^{}[\]|;:,<>?/+=\\]/g, "")
    .replace(/[\s_]+/g, " ")
    .trim();
}

function mapHeaders(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  headers.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    const fieldName = HEADER_ALIASES[normalized];
    if (fieldName) {
      mapping[fieldName] = index;
    }
  });
  return mapping;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Zone {
  id: string;
  name: string;
}

interface Order {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  city: string | null;
  zoneId: string;
  zone: { id: string; name: string } | null;
  hasExchange: boolean;
  location: string;
  financialStatus: string;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  notes: string;
  merchantId: string | null;
  merchant: {
    id: string;
    ownerFirstName: string;
    ownerLastName: string;
    merchantName: string;
  } | null;
  driverId: string | null;
  driver: {
    id: string;
    firstName: string;
    lastName: string;
    driverId: string;
    userId: string;
  } | null;
  waybillUrl?: string | null;
  trackToken?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  history: Array<{
    id: string;
    action: string;
    location: string | null;
    driverId: string | null;
    user: { id: string; username: string };
    createdAt: string;
  }>;
  driverPayout: {
    payoutReference: string | null;
  } | null;
}

type Tab =
  | "all"
  | "warehouse"
  | "cp"
  | "reports"
  | "order-entry"
  | "returns"
  | "rwd";

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  CP: "CP (Pickup)",
  WITH_DRIVER: "With Driver",
  DELIVERED: "Delivered",
  RETURN: "Returned",
  Re: "Returned",
  RTS: "Returned to Seller",
  EWD: "Exchange w/ Driver",
  EX: "Exchange (Warehouse)",
};

const LOCATION_COLORS: Record<string, string> = {
  WAREHOUSE: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  CP: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  WITH_DRIVER: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  DELIVERED: "text-green-400 bg-green-500/10 border-green-500/30",
  RETURN: "text-red-400 bg-red-500/10 border-red-500/30",
  Re: "text-red-400 bg-red-500/10 border-red-500/30",
  RTS: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  EWD: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  EX: "text-orange-400 bg-orange-500/10 border-orange-500/30",
};

const ZONE_BADGE_COLORS = [
  "text-blue-400 bg-blue-500/10 border-blue-500/30",
  "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  "text-orange-400 bg-orange-500/10 border-orange-500/30",
  "text-pink-400 bg-pink-500/10 border-pink-500/30",
  "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
  "text-teal-400 bg-teal-500/10 border-teal-500/30",
];

const LOCATION_FILTERS = [
  { key: "WAREHOUSE", label: "Warehouse" },
  { key: "CP", label: "CP (Pickup)" },
  { key: "WITH_DRIVER", label: "With Driver" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "RETURN", label: "Returned" },
];

const NOTES_OPTIONS = [
  "No response",
  "Postponed",
  "Rejected Item",
  "Canceled by customer",
];

// ─── Excel export column definitions ─────────────────────────────────────────
// Each entry drives both the column-selection modal and the actual export, so
// adding a new exportable column only requires adding one definition here.
const EXPORT_COLUMNS: {
  key: string;
  label: string;
  header: string;
  width: number;
  value: (order: Order) => string | number;
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
    value: (o) => formatDDMMYYYY(o.createdAt),
  },
  {
    key: "seller",
    label: "Seller",
    header: "Seller",
    width: 20,
    value: (o) => o.merchant?.ownerFirstName || o.merchant?.merchantName || "—",
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
    value: (o) => o.customerPhone,
  },
  {
    key: "address",
    label: "Address",
    header: "Address",
    width: 35,
    value: (o) => o.customerAddress,
  },
  {
    key: "zone",
    label: "Zone",
    header: "Zone",
    width: 12,
    value: (o) => o.zone?.name || o.zoneId || "—",
  },
  {
    key: "city",
    label: "City",
    header: "City",
    width: 20,
    value: (o) => o.city || "-",
  },
  {
    key: "driver",
    label: "Driver",
    header: "Driver",
    width: 25,
    value: (o) =>
      o.driver
        ? `${o.driver.firstName} ${o.driver.lastName} (${o.driver.driverId})`
        : "Unassigned",
  },
  {
    key: "location",
    label: "Location",
    header: "Location",
    width: 18,
    value: (o) => LOCATION_LABELS[o.location] || o.location,
  },
  {
    key: "fin",
    label: "Fin Status",
    header: "Fin Status",
    width: 12,
    value: (o) => o.financialStatus,
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
    key: "waybill",
    label: "Waybill",
    header: "Waybill",
    width: 30,
    value: (o) => o.waybillUrl || "",
  },
  {
    key: "deliveredAt",
    label: "Delivered At",
    header: "Delivered At",
    width: 15,
    value: (o) => formatDDMMYYYY(o.deliveredAt || ""),
  },
  {
    key: "notes",
    label: "Notes",
    header: "Notes",
    width: 25,
    value: (o) => o.notes || "",
  },
  {
    key: "payoutReference",
    label: "Payout Ref",
    header: "Payout Ref",
    width: 20,
    value: (o) => o.driverPayout?.payoutReference || "",
  },
];

// ─── Helper to group orders by date ───────────────────────────────────────────
function groupByDate(orders: Order[]): Record<string, Order[]> {
  const map: Record<string, Order[]> = {};
  for (const o of orders) {
    const day = new Date(o.createdAt).toISOString().slice(0, 10);
    if (!map[day]) map[day] = [];
    map[day].push(o);
  }
  return map;
}

// ─── Helper to format short date ──────────────────────────────────────────────
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
function OrdersPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = (searchParams.get("tab") || "all") as Tab;

  const handleTabChange = (tabName: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabName);
    router.push(`${pathname}?${params.toString()}`);
  };

  // ── Data ──
  const [orders, setOrders] = useState<Order[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [availableDrivers, setAvailableDrivers] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [sellersList, setSellersList] = useState<
    { id: string; numericId: number; name: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [totalOrders, setTotalOrders] = useState(0);
  const [rwdTotal, setRwdTotal] = useState(0);
  const [cpTotal, setCpTotal] = useState(0);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    username: string;
    role: string;
    permissions: string[];
    permissionGroup?: { id: string; name: string; permissions: string[] } | null;
    customPermissions?: string[];
    effectivePermissions?: string[];
  } | null>(null);

  // ── Filters ──
  const [searchTerm, setSearchTerm] = useState("");
  const [missingTokens, setMissingTokens] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState<string>("ALL");
  const [dateFilter, setDateFilter] = useState("");

  // ── Returns tab filter states ──
  const [returnDate, setReturnDate] = useState("");
  const [returnSeller, setReturnSeller] = useState("ALL");
  const [returnStatus, setReturnStatus] = useState("ALL");

  // ── Multi-select state ──
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const orderIdInputRef = useRef<HTMLInputElement>(null);

  // ── Excel column selector state ──
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  // All exportable columns are derived from EXPORT_COLUMNS and default to on.
  const [excelCols, setExcelCols] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, true])) as Record<
        string,
        boolean
      >,
  );

  // ── Order Entry Form ──
  const [formData, setFormData] = useState({
    orderId: "",
    merchantId: "",
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    zoneId: "",
    price: "",
    hasExchange: false,
    extraShipping: "",
    amountLbp: "",
    packages: "1",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  // ── Bulk CSV Upload Handler ──
  const [csvUploading, setCsvUploading] = useState(false);

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    let rows: string[][];

    setCsvUploading(true);

    try {
      if (ext === "xlsx" || ext === "xls") {
        const buffer = await file.arrayBuffer();
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
        });
        rows = allRows.filter((r) => r.some((c) => String(c).trim()));
      } else {
        const text = await file.text();
        rows = text
          .split("\n")
          .map((line) => line.split(","))
          .filter((r) => r.some((c) => c.trim()));
      }
    } catch {
      alert(
        "Failed to parse file. Please ensure it is a valid CSV or Excel file.",
      );
      setCsvUploading(false);
      e.target.value = "";
      return;
    }

    if (rows.length < 2) {
      alert("File must have a header row and at least one data row.");
      setCsvUploading(false);
      e.target.value = "";
      return;
    }

    const headers = rows[0];
    const mapping = mapHeaders(headers);

    // Validate that essential headers were found (customer name is optional)
    const hasPhone = mapping.phone !== undefined;
    const hasAddress = mapping.address !== undefined;
    const hasUsd = mapping.usd !== undefined;
    const hasLbp = mapping.lbp !== undefined;

    if (!hasPhone || !hasAddress) {
      alert("Missing required headers. Expected headers for: phone, address.");
      setCsvUploading(false);
      e.target.value = "";
      return;
    }

    if (!hasUsd && !hasLbp) {
      alert("Missing pricing headers. Expected at least one of: usd, lbp.");
      setCsvUploading(false);
      e.target.value = "";
      return;
    }

    const dataRows = rows.slice(1);
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      const customer =
        mapping.customer !== undefined
          ? String(row[mapping.customer] ?? "").trim()
          : "";
      const phone =
        mapping.phone !== undefined
          ? String(row[mapping.phone] ?? "").trim()
          : "";
      const address =
        mapping.address !== undefined
          ? String(row[mapping.address] ?? "").trim()
          : "";
      const orderId =
        mapping.orderId !== undefined
          ? String(row[mapping.orderId] ?? "").trim()
          : "";
      const seller =
        mapping.seller !== undefined
          ? String(row[mapping.seller] ?? "").trim()
          : "";
      const zone =
        mapping.zone !== undefined
          ? String(row[mapping.zone] ?? "").trim()
          : "";
      const usdRaw =
        mapping.usd !== undefined ? String(row[mapping.usd] ?? "").trim() : "";
      const lbpRaw =
        mapping.lbp !== undefined ? String(row[mapping.lbp] ?? "").trim() : "";
      const dateReceivedRaw =
        mapping.dateReceived !== undefined
          ? String(row[mapping.dateReceived] ?? "").trim()
          : "";

      // Parse date if provided
      let parsedDate: string | undefined;
      if (dateReceivedRaw) {
        // Try parsing as ISO date string first
        const isoMatch = dateReceivedRaw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        const usMatch = dateReceivedRaw.match(
          /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
        );
        const euMatch = dateReceivedRaw.match(
          /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
        );
        if (isoMatch) {
          parsedDate = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
        } else if (usMatch) {
          parsedDate = `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
        } else if (euMatch) {
          const year = euMatch[3].length === 2 ? `20${euMatch[3]}` : euMatch[3];
          parsedDate = `${year}-${euMatch[2].padStart(2, "0")}-${euMatch[1].padStart(2, "0")}`;
        } else {
          // Try parsing as Excel serial date (days since 1900-01-01)
          const serial = parseFloat(dateReceivedRaw);
          if (!isNaN(serial) && serial > 3000 && serial < 60000) {
            const excelDate = new Date((serial - 25569) * 86400 * 1000);
            parsedDate = excelDate.toISOString().split("T")[0];
          }
        }
      }

      // Validate required fields (customer name is optional and defaults to "Unknown")
      if (!phone || !address) {
        failCount++;
        errors.push(`Row ${i + 2}: Missing phone or address.`);
        if (errors.length > 10) errors.push("... (truncated)");
        continue;
      }

      // Strip leading $ and any non-numeric characters (except . and -) from price fields
      const cleanNumeric = (val: string) =>
        val.replace(/[^0-9.\-]/g, "").trim();
      const usd = usdRaw ? parseFloat(cleanNumeric(usdRaw)) : null;
      const lbp = lbpRaw ? parseFloat(cleanNumeric(lbpRaw)) : null;

      if ((usd === null || isNaN(usd)) && (lbp === null || isNaN(lbp))) {
        failCount++;
        errors.push(`Row ${i + 2}: Invalid pricing (usd/lbp).`);
        if (errors.length > 10) errors.push("... (truncated)");
        continue;
      }

      // Resolve Seller ID
      let finalSellerId = seller;
      const matchedSeller = sellersList.find(
        (s: any) =>
          s.numericId?.toString() === seller ||
          s.name?.toLowerCase() === seller.toLowerCase() ||
          `${s.numericId} - ${s.name}` === seller,
      );
      if (matchedSeller) finalSellerId = matchedSeller.id;

      // Resolve Zone ID - default to zone "99" if not provided or not found
      let zoneId: string | null = null;
      if (zone) {
        const matchedZone = zones.find(
          (z: any) => z.name.toLowerCase() === zone.toLowerCase(),
        );
        if (matchedZone) zoneId = matchedZone.id;
      }
      // Fallback: try to find zone named "99", then first available zone
      const zone99 = zones.find((z: any) => z.name === "99");
      const finalZoneId = zoneId ?? zone99?.id ?? zones[0]?.id ?? null;

      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: orderId || undefined,
            merchantId: finalSellerId,
            customerName: customer || "Unknown",
            customerPhone: phone,
            customerAddress: address,
            zoneId: finalZoneId,
            price: usd !== null && !isNaN(usd) ? String(usd) : "0",
            amountLbp: lbp !== null && !isNaN(lbp) ? String(lbp) : "0",
            hasExchange: false,
            extraShipping: "0",
            packages: "1",
            notes: "Imported via Bulk Excel/CSV tool",
            dateReceived: parsedDate,
          }),
        });

        if (res.ok) {
          successCount++;
        } else {
          failCount++;
          const errData = await res.json().catch(() => ({}));
          errors.push(
            `Row ${i + 2}: API error - ${errData.error || res.statusText}`,
          );
          if (errors.length > 10) errors.push("... (truncated)");
        }
      } catch {
        failCount++;
        errors.push(`Row ${i + 2}: Network error.`);
        if (errors.length > 10) errors.push("... (truncated)");
      }
    }

    const message = `Import complete: ${successCount} succeeded, ${failCount} failed.`;
    if (errors.length > 0) {
      alert(`${message}\n\nFirst errors:\n${errors.join("\n")}`);
    } else {
      alert(message);
    }

    await fetchOrders();
    setCsvUploading(false);
    e.target.value = "";
  };

  // ── Waybill Upload State & Handler ──
  const [waybillUploading, setWaybillUploading] = useState(false);
  const waybillInputRef = useRef<HTMLInputElement>(null);

  const handleWaybillUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setWaybillUploading(true);

    const fileList = Array.from(files);
    let successCount = 0;
    const failedFiles: string[] = [];

    // Sequential execution prevents CPU starvation on the backend
    for (const file of fileList) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/orders/waybill", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          // API returns { results: [{ fileName, success, error?, ... }] }
          const fileResult = data.results?.[0];
          if (fileResult?.success) {
            successCount++;
          } else {
            failedFiles.push(
              `${file.name}: ${fileResult?.error || "Unknown error"}`,
            );
          }
        } else {
          const errorData = await res.json().catch(() => null);
          failedFiles.push(
            `${file.name}: ${errorData?.error || res.statusText || "Request failed"}`,
          );
        }
      } catch (error) {
        failedFiles.push(`${file.name}: Network or Server Error`);
      }
    }

    // Handle alert rendering after the entire queue finishes
    if (failedFiles.length > 0) {
      alert(
        `Uploaded ${successCount} successfully.\n${failedFiles.length} failed:\n${failedFiles.join("\n")}`,
      );
    } else {
      alert(`Successfully uploaded all ${successCount} waybills.`);
    }

    await fetchOrders();
    setWaybillUploading(false);
    e.target.value = "";
  };

  // ── Zone text input for order creation ──
  const [zoneInput, setZoneInput] = useState("");

  // ── History Modal ──
  const [historyModalOrder, setHistoryModalOrder] = useState<{
    id: string;
    history: any[];
    payoutReference: string | null;
  } | null>(null);

  // ── Modals ──
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [notesModal, setNotesModal] = useState<Order | null>(null);
  const [sellerModal, setSellerModal] = useState<Order | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [customNote, setCustomNote] = useState("");
  const [newMerchantId, setNewMerchantId] = useState("");

  // ── Edit Modal ──
  const [editModal, setEditModal] = useState<Order | null>(null);
  const [editFormData, setEditFormData] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    zoneId: "",
    amountUsd: "",
    amountLbp: "",
    hasExchange: false,
    extraShipping: "",
  });

  // ── Assign Driver Modal ──
  const [driverModal, setDriverModal] = useState<Order | null>(null);
  const [newDriverId, setNewDriverId] = useState("");

  // ── Revert Modal ──
  const [revertModal, setRevertModal] = useState<Order | null>(null);

  // ── Custom Payment Modal ──
  const [customPayModalOpen, setCustomPayModalOpen] = useState(false);
  const [customPayOrder, setCustomPayOrder] = useState<any>(null);
  const [customUsd, setCustomUsd] = useState("");
  const [customLbp, setCustomLbp] = useState("");

  // ── Archive tab state ──
  const [showArchived, setShowArchived] = useState(false);

  // ── Seller Correction Modal state ──
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [correctionOrder, setCorrectionOrder] = useState<any>(null);
  const [selectedNewMerchantId, setSelectedNewMerchantId] = useState("");

  // ── Change Seller Modal (bulk) ──
  const [isSellerModalOpen, setIsSellerModalOpen] = useState(false);
  const [newSellerInput, setNewSellerInput] = useState("");

  // ── Global Google Sheets Import Modal ──
  const [globalSheetModalOpen, setGlobalSheetModalOpen] = useState(false);

  // ── Warehouse active zone sub-tab ──
  const [activeWarehouseZone, setActiveWarehouseZone] = useState<string>("");
  const [batchSearchQuery, setBatchSearchQuery] = useState("");
  const [warehousePage, setWarehousePage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  // Pagination for "all" tab
  const [allPage, setAllPage] = useState(1);
  const [allItemsPerPage, setAllItemsPerPage] = useState(50);
  // Pagination for "returns" tab
  const [returnsItemsPerPage, setReturnsItemsPerPage] = useState(50);
  const [returnsPage, setReturnsPage] = useState(1);
  // Pagination for "rwd" tab
  const [rwdPage, setRwdPage] = useState(1);
  const [rwdItemsPerPage, setRwdItemsPerPage] = useState(50);

  // ── Warehouse column sorting (click header to toggle asc/desc) ──
  const [warehouseSortKey, setWarehouseSortKey] = useState<string>("");
  const [warehouseSortDir, setWarehouseSortDir] = useState<"asc" | "desc">(
    "asc",
  );

  const handleWarehouseSort = (key: string) => {
    if (warehouseSortKey === key) {
      setWarehouseSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setWarehouseSortKey(key);
      setWarehouseSortDir("asc");
    }
  };

  // Reset warehouse pagination when zone or search query changes
  useEffect(() => {
    setWarehousePage(1);
  }, [activeWarehouseZone, batchSearchQuery]);

  // ── Bulk Zone Reassignment State ──
  const [bulkTargetZoneId, setBulkTargetZoneId] = useState<string>("");

  // ── Bulk Dispatch State ──
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [driverSearchTerm, setDriverSearchTerm] = useState("");

  // ── Quick Assign State (type order IDs + pick driver) ──
  const [quickAssignModalOpen, setQuickAssignModalOpen] = useState(false);
  const [quickAssignOrderIdsText, setQuickAssignOrderIdsText] = useState("");
  const [quickAssignDriverId, setQuickAssignDriverId] = useState("");

  // ── Scan-to-Assign State ──
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedOrder, setScannedOrder] = useState<any | null>(null);
  const [scannedAssignDriverId, setScannedAssignDriverId] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);

  // ── Fetch all tab data ──
  // When called without params on the "All" tab, reuses current pagination state
  const fetchOrders = async (params?: Record<string, string>) => {
    if (!params && currentTab === "all") {
      // For comma-separated (multi-order) searches, fetch ALL orders (up to API max)
      // so the client-side filter can match orders across all pages. This keeps the
      // searched results visible after refetches (e.g. status changes) too.
      const isCommaSearch = searchTerm.includes(",");
      params = {
        skip: isCommaSearch ? "0" : String((allPage - 1) * allItemsPerPage),
        take: isCommaSearch ? "5000" : String(allItemsPerPage),
      };
      // Skip server-side search for comma-separated queries
      if (searchTerm.trim() && !searchTerm.includes(",")) {
        params.search = searchTerm.trim();
      }
      if (locationFilter !== "ALL") params.location = locationFilter;
      if (dateFilter) params.dateFrom = dateFilter;
    }

    // On the "all" tab, always request the currently-viewed set (active vs
    // archived) so the client-side isArchived filter always has data to show.
    if (currentTab === "all") {
      params = { ...(params || {}), isArchived: String(showArchived) };
    }

    setLoading(true);
    try {
      // Build query string for pagination/filters
      const query = params ? "?" + new URLSearchParams(params).toString() : "";
      const [ordersRes, zonesRes, driversRes, merchantsRes, sellersRes] =
        await Promise.all([
          fetch(`/api/orders${query}`),
          fetch("/api/admin/zones"),
          fetch("/api/admin/drivers"),
          fetch("/api/admin/merchants"),
          fetch("/api/admin/merchants/list"),
        ]);
      if (ordersRes.ok) {
        const result = await ordersRes.json();
        // Support both new { data, meta } format and legacy array format
        const orderList = Array.isArray(result) ? result : (result.data ?? []);
        setOrders(orderList);
        // Track total count for server-side pagination
        if (!Array.isArray(result) && result.meta) {
          setTotalOrders(result.meta.total);
          setRwdTotal(result.meta.rwdTotal ?? orderList.length);
          setCpTotal(result.meta.cpTotal ?? orderList.length);
        } else {
          setTotalOrders(orderList.length);
          setRwdTotal(orderList.filter((o: Order) => String(o.location).toUpperCase() === "RETURN" && ["RWD", "EWD"].includes(String(o.financialStatus).toUpperCase())).length);
          setCpTotal(orderList.filter((o: Order) => String(o.location).toUpperCase() === "CP").length);
        }
      }
      if (zonesRes.ok) {
        const data = await zonesRes.json();
        const sorted = data.sort((a: Zone, b: Zone) => {
          const numA = parseInt(a.name, 10);
          const numB = parseInt(b.name, 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.name.localeCompare(b.name);
        });
        setZones(sorted);
      }
      if (driversRes.ok) {
        const data = await driversRes.json();
        setAvailableDrivers(data);
      }
      if (merchantsRes.ok) {
        const data = await merchantsRes.json();
        setMerchants(data);
      }
      if (sellersRes.ok) {
        const data = await sellersRes.json();
        setSellersList(data);
      }
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Copy tracking link to clipboard ────────────────────────────────────
  const handleCopyLink = (order: Order) => {
    const trackingUrl = order.trackToken
      ? window.location.origin + "/track/" + order.trackToken + "/" + order.orderId
      : window.location.origin + "/track/" + order.orderId;

    if (navigator.clipboard && window.isSecureContext) {
      // Modern HTTPS approach
      navigator.clipboard
        .writeText(trackingUrl)
        .then(() => alert(`Tracking link copied!\n${trackingUrl}`))
        .catch(() => alert(`Failed to copy. Manual link:\n${trackingUrl}`));
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
        alert(`Tracking link copied!\n${trackingUrl}`);
      } catch (err) {
        alert(`Failed to copy link. Manual link:\n${trackingUrl}`);
      }
      textArea.remove();
    }
  };

  // ── Initial fetch ──
  useEffect(() => {
    fetchOrders({
      skip: "0",
      take: String(allItemsPerPage === 0 ? 500 : allItemsPerPage),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-fetch when "All" tab pagination changes ──
  useEffect(() => {
    if (currentTab === "all") {
      // For comma-separated (multi-order) searches, fetch ALL orders (up to API max)
      // so the client-side filter can match orders across all pages.
      const isCommaSearch = searchTerm.includes(",");
      const params: Record<string, string> = {
        skip: "0",
        take: isCommaSearch ? "5000" : String(allItemsPerPage),
      };
      if (searchTerm.trim() && !isCommaSearch) {
        params.search = searchTerm.trim();
      }
      if (locationFilter !== "ALL") params.location = locationFilter;
      if (dateFilter) params.dateFrom = dateFilter;
      fetchOrders(params);
    } else if (currentTab === "rwd") {
      // RWD/EWD tab: filter server-side to avoid missing orders beyond the fetch limit
      fetchOrders({
        skip: "0",
        take: "5000",
        location: "RETURN",
        financialStatus: "RWD,EWD",
      });
    } else if (currentTab === "cp") {
      // CP tab: only merchant orders staged in the CP pickup warehouse
      fetchOrders({ skip: "0", take: "5000", location: "CP" });
    } else if (currentTab === "returns") {
      // Returns tab: filter server-side by location to avoid missing
      // older return orders beyond the default fetch limit
      fetchOrders({
        skip: "0",
        take: "5000",
        location: "RETURN",
      });
    } else {
      // For non-"all" tabs (warehouse, reports, order-entry, etc.),
      // fetch orders with a reasonable limit
      fetchOrders({ skip: "0", take: "500" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allPage,
    allItemsPerPage,
    currentTab,
    searchTerm,
    locationFilter,
    dateFilter,
    showArchived,
  ]);

  // ── Fetch auth state ──
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCurrentUser(data));
  }, []);

  // ── Close export dropdown on outside click ──
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Permission helper ──
  // Shared composite check: ADMIN bypass ∪ group permissions ∪ custom
  // permissions (single source of truth with the server-side guards).
  const userHasPermission = (perm: string) => hasPermission(currentUser, perm);

  // Auto-select first zone when zones load and none is selected
  useEffect(() => {
    if (zones.length > 0 && activeWarehouseZone === "") {
      setActiveWarehouseZone(zones[0].id);
    }
  }, [zones]);

  // ── Patch helper ──
  const patchOrder = async (id: string, payload: Record<string, unknown>) => {
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error("PATCH error", err);
      return false;
    }
    await fetchOrders();
    return true;
  };

  // ── Create order ──
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    // Reverse-lookup zone name → UUID
    const matchedZone = zones.find(
      (z) => z.name.toLowerCase() === zoneInput.trim().toLowerCase(),
    );
    if (!matchedZone) {
      alert(
        `Zone "${zoneInput}" not found. Please verify it exists in the Admin panel.`,
      );
      return;
    }

    // Reverse-lookup seller display value → UUID
    const sellerInput = formData.merchantId;
    let resolvedMerchantId = sellerInput;
    const matchedSeller = sellersList.find(
      (s: any) =>
        s.numericId?.toString() === sellerInput ||
        s.name?.toLowerCase() === sellerInput.toLowerCase() ||
        `${s.numericId} - ${s.name}` === sellerInput,
    );
    if (matchedSeller) {
      resolvedMerchantId = matchedSeller.id;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          customerName: formData.customerName?.trim() || "Unknown",
          merchantId: resolvedMerchantId,
          zoneId: matchedZone.id,
        }),
      });
      if (res.ok) {
        setFormData({
          orderId: "",
          merchantId: "",
          customerName: "",
          customerPhone: "",
          customerAddress: "",
          zoneId: "",
          price: "",
          hasExchange: false,
          extraShipping: "",
          amountLbp: "",
          packages: "1",
          notes: "",
        });
        setZoneInput("");
        await fetchOrders();
        orderIdInputRef.current?.focus();
      } else {
        const err = await res.json();
        console.error("POST error", err);
        alert(err.error || "Failed to create order.");
      }
    } catch (err) {
      console.error("Failed to create order", err);
      alert("Failed to create order.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Multi-select functions ──
  const toggleSelectAll = () => {
    if (selectedOrderIds.length === allFiltered.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(allFiltered.map((o) => o.id));
    }
  };

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((oid) => oid !== id) : [...prev, id],
    );
  };

  // ── Bulk Assign to Driver ──
  const handleBulkAssign = async () => {
    if (!driverSearchTerm) return alert("Please select a driver.");

    // Reverse-lookup driver UUID from the datalist string
    const matchedDriver = availableDrivers.find(
      (d: any) =>
        `${d.firstName} ${d.lastName} (${d.driverId})` === driverSearchTerm,
    );

    if (!matchedDriver)
      return alert("Driver not found. Please select from the list.");

    // ── Filter out delivered/paid-out orders (WD/WO) ──
    const selectedOrders = orders.filter((o) =>
      selectedOrderIds.includes(o.id),
    );
    const lockedOrders = selectedOrders.filter((o) =>
      ["WD", "WO"].includes(o.financialStatus),
    );
    const assignableOrderIds = selectedOrderIds.filter(
      (id) => !lockedOrders.some((lo) => lo.id === id),
    );

    if (lockedOrders.length > 0) {
      alert(
        `⚠️ Skipped ${lockedOrders.length} order(s) with status WD/WO (Delivered/Paid-out). These cannot be reassigned.\nProceeding with ${assignableOrderIds.length} order(s).`,
      );
    }

    if (assignableOrderIds.length === 0) return;

    try {
      await Promise.all(
        assignableOrderIds.map((id) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              driverId: matchedDriver.id,
              location: "ASSIGNED",
              financialStatus: "UD",
            }),
          }),
        ),
      );

      setAssignModalOpen(false);
      setSelectedOrderIds([]);
      setDriverSearchTerm("");
      fetchOrders();
    } catch (error) {
      console.error("Failed to bulk assign orders", error);
      alert("An error occurred during bulk assignment.");
    }
  };

  // ── Quick Assign (type order IDs + pick driver) ──
  const handleQuickAssign = async () => {
    if (!quickAssignDriverId) return alert("Please select a driver.");
    if (!quickAssignOrderIdsText.trim())
      return alert("Please enter at least one order ID.");

    const matchedDriver = availableDrivers.find(
      (d: any) => d.id === quickAssignDriverId,
    );
    if (!matchedDriver)
      return alert("Driver not found. Please select from the list.");

    // Parse order IDs: one per line, strip whitespace and leading #, deduplicate
    const seen = new Set<string>();
    const rawIds = quickAssignOrderIdsText
      .split("\n")
      .map((id) => id.trim().replace(/^#/, ""))
      .filter((id) => {
        if (!id || seen.has(id.toLowerCase())) return false;
        seen.add(id.toLowerCase());
        return true;
      });
    if (rawIds.length === 0) return alert("No valid order IDs found.");

    // ── Server-side lookup: find orders by orderId in the database ──
    let lookupResult: { found: any[]; notFound: string[]; stats: any };
    try {
      const res = await fetch("/api/orders/bulk/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: rawIds }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Lookup failed");
      }
      lookupResult = await res.json();
    } catch (error: any) {
      console.error("Quick assign lookup failed:", error);
      return alert(
        `Failed to look up orders: ${error.message || "Network error"}. Please try again.`,
      );
    }

    const { found: matchedOrders, notFound } = lookupResult;

    if (matchedOrders.length === 0)
      return alert(
        `None of the entered order IDs matched any orders in the database. Found ${rawIds.length} unique ID(s) but 0 matched.`,
      );

    // ── Filter out delivered/paid-out orders (WD/WO) ──
    const lockedOrders = matchedOrders.filter((o: any) =>
      ["WD", "WO"].includes(o.financialStatus),
    );
    const assignableOrders = matchedOrders.filter(
      (o: any) => !["WD", "WO"].includes(o.financialStatus),
    );

    if (notFound.length > 0) {
      alert(
        `⚠️ ${notFound.length} order(s) could not be found in the database.\nProceeding with ${matchedOrders.length} matched order(s).`,
      );
    }

    if (lockedOrders.length > 0) {
      alert(
        `⚠️ Skipped ${lockedOrders.length} delivered/paid-out order(s) (WD/WO). These cannot be reassigned.\nProceeding with ${assignableOrders.length} order(s).`,
      );
    }

    if (assignableOrders.length === 0) return;

    try {
      await Promise.all(
        assignableOrders.map((o) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: o.id,
              driverId: matchedDriver.id,
              location: "ASSIGNED",
              financialStatus: "UD",
            }),
          }),
        ),
      );

      setQuickAssignModalOpen(false);
      setQuickAssignOrderIdsText("");
      setQuickAssignDriverId("");
      fetchOrders();
      alert(
        `Successfully assigned ${assignableOrders.length} order(s) to ${matchedDriver.firstName} ${matchedDriver.lastName}.`,
      );
    } catch (error) {
      console.error("Failed to quick-assign orders", error);
      alert("An error occurred during assignment.");
    }
  };

  // ── Scan Order Handler (from barcode/QR scanner) ──
  const handleScanOrder = async (decodedText: string) => {
    setScannerOpen(false);
    setScanError(null);
    setScanLoading(true);
    try {
      const res = await fetch("/api/orders/bulk/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [decodedText.trim()] }),
      });
      const { found, notFound } = await res.json();
      if (!found || found.length === 0) {
        setScanError(`Order "${decodedText.trim()}" not found in the system.`);
        return;
      }
      setScannedOrder(found[0]);
      setScannedAssignDriverId("");
    } catch (err) {
      setScanError("Failed to look up order. Please try again.");
    } finally {
      setScanLoading(false);
    }
  };

  // ── Confirm Scan-to-Assign ──
  const handleScanAssign = async () => {
    if (!scannedOrder || !scannedAssignDriverId) {
      alert("Please select a driver.");
      return;
    }
    if (["WD", "WO"].includes(scannedOrder.financialStatus)) {
      alert(
        `Cannot reassign order "${scannedOrder.orderId}" — it is already delivered or paid out (status: ${scannedOrder.financialStatus}).`,
      );
      return;
    }
    await patchOrder(scannedOrder.id, {
      driverId: scannedAssignDriverId,
      location: "ASSIGNED",
      financialStatus: "UD",
      collectedUsd: 0,
      collectedLbp: 0,
    });
    setScannedOrder(null);
    setScannedAssignDriverId("");
  };

  // ── Archived filter ──
  const activeOrArchivedOrders = useMemo(
    () => orders.filter((o) => o.isArchived === showArchived),
    [orders, showArchived],
  );

  // Helper: check if a term matches a single order (with suffix matching for numeric terms)
  const termMatchesOrder = (term: string, order: Order): boolean => {
    const orderIdLower = order.orderId.toLowerCase();
    // Suffix match for numeric terms (4+ digits): allows searching by last 4-5 digits
    const isNumeric = /^\d{4,}$/.test(term);
    if (isNumeric && orderIdLower.endsWith(term)) return true;
    // Standard includes match
    return (
      orderIdLower.includes(term) ||
      order.customerName.toLowerCase().includes(term) ||
      order.customerPhone.toLowerCase().includes(term) ||
      (order.customerAddress &&
        order.customerAddress.toLowerCase().includes(term)) ||
      (order.city && order.city.toLowerCase().includes(term)) ||
      order.location.toLowerCase().includes(term) ||
      String(order.amountUsd).includes(term) ||
      String(order.amountLbp).includes(term) ||
      !!(
        order.driver?.firstName &&
        order.driver.firstName.toLowerCase().includes(term)
      )
    );
  };

  // Helper: comma-separated multi-search token match against Order ID or phone number.
  // Order ID: exact or suffix match (as before).
  // Phone: numeric tokens (4+ digits) match the full number or just trailing digits
  // (e.g. "78981891" or "981891"), ignoring spaces/+ signs in the stored phone.
  const tokenMatchesOrderIdOrPhone = (token: string, order: Order): boolean => {
    const displayId = String(order.orderId || order.id || "");
    const displayIdLower = displayId.toLowerCase();
    if (displayIdLower.endsWith(token) || displayIdLower === token) return true;
    if (/^\d{4,}$/.test(token)) {
      const phoneDigits = (order.customerPhone || "").replace(/\D/g, "");
      if (phoneDigits.endsWith(token)) return true;
    }
    return false;
  };

  // ── Filtered & sorted orders ──
  const allFiltered = useMemo(() => {
    let list = [...activeOrArchivedOrders];

    // Search by comma-separated terms against multiple fields
    if (searchTerm.trim()) {
      const terms = searchTerm
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      list = list.filter((order) => {
        if (terms.length === 0) return true;

        // Multi-order comma-separated search: match Order ID (exact/suffix) or phone
        // number (full or trailing digits). Return true if ANY token matches.
        if (searchTerm.includes(",")) {
          return terms.some((token) => tokenMatchesOrderIdOrPhone(token, order));
        }

        // AND logic: Order must match ALL terms (great for parameter filtering)
        const matchesAnd = terms.every((term) => termMatchesOrder(term, order));

        // OR logic: If ANY numeric/orderId-like term matches the Order ID (including suffix), include it
        const matchesOrId = terms.some((term) => {
          const orderIdLower = order.orderId.toLowerCase();
          const isNumeric = /^\d{4,}$/.test(term);
          if (isNumeric && orderIdLower.endsWith(term)) return true;
          return orderIdLower.includes(term);
        });

        return matchesAnd || matchesOrId;
      });
    }

    // Location filter
    if (locationFilter !== "ALL") {
      list = list.filter((o) => o.location === locationFilter);
    }

    // Date filter
    if (dateFilter) {
      list = list.filter(
        (o) => new Date(o.createdAt).toISOString().slice(0, 10) === dateFilter,
      );
    }

    return list;
  }, [activeOrArchivedOrders, searchTerm, locationFilter, dateFilter]);

  // ── Not-found order numbers (for numeric search terms only) ──
  // ── Not-found order numbers (for numeric search terms only) ──
  const notFoundOrderNumbers = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const terms = searchTerm
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    // Only track numeric terms (4+ digits) that look like order numbers
    const numericTerms = terms.filter((t) => /^\d{4,}$/.test(t));
    if (numericTerms.length === 0) return [];

    const notFound: string[] = [];
    for (const term of numericTerms) {
      // Use the same matching logic as allFiltered for consistency
      const found = activeOrArchivedOrders.some((order) =>
        termMatchesOrder(term, order),
      );
      if (!found) {
        notFound.push(term);
      }
    }
    return notFound;
  }, [activeOrArchivedOrders, searchTerm]);

  // ── Compute missing tokens from comma-separated search ──
  useEffect(() => {
    if (!searchTerm.trim()) {
      setMissingTokens([]);
      return;
    }
    const tokens = searchTerm
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) {
      setMissingTokens([]);
      return;
    }
    // Multi-order comma-separated search: a token is "found" if it matches any
    // order ID (exact/suffix) or phone number (full or trailing digits).
    if (tokens.length > 0 && searchTerm.includes(",")) {
      const notFound = tokens.filter(
        (token) =>
          !activeOrArchivedOrders.some((order) =>
            tokenMatchesOrderIdOrPhone(token, order),
          ),
      );
      setMissingTokens(notFound);
    } else {
      const missing: string[] = [];
      for (const token of tokens) {
        const found = activeOrArchivedOrders.some((order) =>
          termMatchesOrder(token, order),
        );
        if (!found) {
          missing.push(token);
        }
      }
      setMissingTokens(missing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, activeOrArchivedOrders]);

  // ── Warehouse filtered & grouped ──
  const warehouseOrders = useMemo(
    () => orders.filter((o) => o.location === "WAREHOUSE"),
    [orders],
  );

  // ── CP (customer pickup) warehouse — merchant orders awaiting transfer ──
  const cpOrders = useMemo(
    () => orders.filter((o) => o.location === "CP"),
    [orders],
  );
  const warehouseByZone = useMemo(() => {
    const map: Record<string, Order[]> = {};
    for (const o of warehouseOrders) {
      const key = o.zoneId;
      if (!map[key]) map[key] = [];
      map[key].push(o);
    }
    return map;
  }, [warehouseOrders]);

  // ── Returns filtered & grouped ──
  const returnsOrders = useMemo(() => {
    let list = orders.filter((o) => {
      const loc = String(o.location).toUpperCase();
      const fin = String(o.financialStatus).toUpperCase();
      return (
        loc === "RETURN" && (fin === "RE" || fin === "RTS" || fin === "EX")
      );
    });

    if (returnDate) {
      list = list.filter(
        (o) => new Date(o.createdAt).toISOString().slice(0, 10) === returnDate,
      );
    }

    if (returnSeller !== "ALL") {
      list = list.filter((o) => {
        const name =
          o.merchant?.ownerFirstName || o.merchant?.merchantName || "—";
        return name === returnSeller;
      });
    }

    if (returnStatus !== "ALL") {
      list = list.filter((o) => o.financialStatus === returnStatus);
    }

    return list;
  }, [orders, returnDate, returnSeller, returnStatus]);

  const returnsBySeller = useMemo(() => {
    const map: Record<string, Order[]> = {};
    for (const o of returnsOrders) {
      const seller =
        o.merchant?.ownerFirstName || o.merchant?.merchantName || "—";
      if (!map[seller]) map[seller] = [];
      map[seller].push(o);
    }
    return map;
  }, [returnsOrders]);

  const returnSellerOptions = useMemo(() => {
    const sellers = new Set<string>();
    for (const o of orders) {
      const loc = String(o.location).toUpperCase();
      const fin = String(o.financialStatus).toUpperCase();
      if (loc === "RETURN" && (fin === "RE" || fin === "RTS")) {
        const name =
          o.merchant?.ownerFirstName || o.merchant?.merchantName || "—";
        sellers.add(name);
      }
    }
    return Array.from(sellers).sort();
  }, [orders]);

  // ── RWD (Return With Driver) / EWD (Exchange With Driver) orders ──
  const rwdOrders = useMemo(() => {
    return orders.filter((o) => {
      const loc = String(o.location).toUpperCase();
      const fin = String(o.financialStatus).toUpperCase();
      return loc === "RETURN" && (fin === "RWD" || fin === "EWD");
    });
  }, [orders]);

  // ── Reports data ──
  const reports = useMemo(() => {
    const byDate = groupByDate(orders);
    const entries = Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, items]) => {
        const total = items.length;
        const delivered = items.filter(
          (o) => o.location === "DELIVERED",
        ).length;
        const returned = items.filter((o) => o.location === "RETURN").length;
        const successRate =
          total > 0 ? ((delivered / total) * 100).toFixed(1) : "0.0";

        const deliveredItems = items.filter((o) => o.deliveredAt);
        const avgTime =
          deliveredItems.length > 0
            ? deliveredItems.reduce((acc, o) => {
                const created = new Date(o.createdAt).getTime();
                const delivered = new Date(o.deliveredAt!).getTime();
                return acc + (delivered - created);
              }, 0) /
              deliveredItems.length /
              3600000
            : 0;

        return { date, total, delivered, returned, successRate, avgTime };
      });

    return entries;
  }, [orders]);

  // ── Paginated values (for count displays) ──
  const paginatedAll = useMemo(() => {
    // Use allFiltered for the "all" tab so client-side search filters apply
    return allFiltered.slice(
      (allPage - 1) * allItemsPerPage,
      allPage * allItemsPerPage,
    );
  }, [allFiltered, allPage, allItemsPerPage, currentTab]);

  const zoneItems = useMemo(() => {
    if (!activeWarehouseZone) return [];
    return warehouseOrders.filter((o) => o.zoneId === activeWarehouseZone);
  }, [warehouseOrders, activeWarehouseZone]);

  const warehouseItems = useMemo(() => {
    if (!activeWarehouseZone) return [];
    if (!batchSearchQuery.trim()) return zoneItems;
    const targetIds = batchSearchQuery
      .split(/[\s,]+/)
      .map((id) => id.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean);
    if (targetIds.length === 0) return zoneItems;
    return zoneItems.filter((order) => {
      const orderNumStr = String(order.orderId || order.id || "")
        .replace(/^#/, "")
        .toLowerCase();
      const trackingStr = String((order as any).trackingNumber || "")
        .replace(/^#/, "")
        .toLowerCase();
      const phoneStr = String(order.customerPhone || "").replace(/\D/g, "");
      return (
        targetIds.includes(orderNumStr) ||
        targetIds.includes(trackingStr) ||
        targetIds.some((target) => phoneStr.includes(target.replace(/\D/g, "")))
      );
    });
  }, [zoneItems, batchSearchQuery]);

  const sortedWarehouseItems = useMemo(() => {
    if (!warehouseSortKey) return warehouseItems;
    const dir = warehouseSortDir;
    return [...warehouseItems].sort((a, b) => {
      const va = getOrderSortValue(a, warehouseSortKey);
      const vb = getOrderSortValue(b, warehouseSortKey);
      const cmp = compareSortValues(va, vb);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [warehouseItems, warehouseSortKey, warehouseSortDir]);

  const paginatedWarehouseItems = useMemo(() => {
    return sortedWarehouseItems.slice(
      (warehousePage - 1) * itemsPerPage,
      warehousePage * itemsPerPage,
    );
  }, [sortedWarehouseItems, warehousePage, itemsPerPage]);

  const paginatedReturns = useMemo(() => {
    return returnsOrders.slice(
      (returnsPage - 1) * returnsItemsPerPage,
      returnsPage * returnsItemsPerPage,
    );
  }, [returnsOrders, returnsPage, returnsItemsPerPage]);

  // ── Quick location actions ──
  const updateOrder = (id: string, payload: Record<string, unknown>) =>
    patchOrder(id, payload);

  const handleWarehouse = (id: string) =>
    patchOrder(id, {
      location: "WAREHOUSE",
      financialStatus: "UD",
      driverId: null,
      isArchived: false,
    });
  const handleDeliver = (order: Order) =>
    patchOrder(order.id, {
      location: "DELIVERED",
      financialStatus: "WD",
    });
  const handleReturn = (id: string) =>
    patchOrder(id, { location: "RETURN", status: "Re" });

  // ── Return Delivered (WO/WD) to Warehouse ──
  // Calls the permission-gated /api/admin/orders/return endpoint (requires
  // ACTION_ORDER_RETURN) so delivered orders can be rolled back into the
  // returns pipeline even when they're WO (cleared payout) or WD.
  const handleReturnDelivered = async () => {
    const deliveredIds = orders
      .filter(
        (o) =>
          selectedOrderIds.includes(o.id) &&
          o.location === "DELIVERED" &&
          ["WO", "WD"].includes(o.financialStatus),
      )
      .map((o) => o.id);

    if (deliveredIds.length === 0) {
      alert(
        "No delivered (WO/WD) orders selected to return. Select delivered orders first.",
      );
      return;
    }

    if (
      !window.confirm(
        `Return ${deliveredIds.length} delivered order(s) to the warehouse (Returned / Re)?\n\nThis unlinks them from any payout and clears collected amounts.`,
      )
    )
      return;

    try {
      const res = await fetch("/api/admin/orders/return", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: deliveredIds,
          location: "RETURN",
          financialStatus: "Re",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to return delivered orders.");
        return;
      }
      alert(
        `Returned ${data.count} delivered order(s) to the warehouse (Returned / Re).`,
      );
      setSelectedOrderIds([]);
      await fetchOrders();
    } catch (error) {
      console.error("Return delivered failed", error);
      alert("Failed to return delivered orders.");
    }
  };

  // ── Shared helper: call the permission-gated return endpoint ─────────────
  // Handles delivered WO/WD orders only — unlinks payouts, clears collected
  // amounts, and recalculates/deletes the affected pending payout.
  const returnDeliveredViaApi = async (
    orderIds: string[],
    location: string,
    financialStatus: string,
  ) => {
    const res = await fetch("/api/admin/orders/return", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, location, financialStatus }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to return delivered orders");
    }
    return data;
  };

  // ── Return a single delivered order to the warehouse (per-row action) ──
  const handleReturnOrderToWarehouse = async (order: Order) => {
    if (
      !window.confirm(
        `Return order ${order.orderId} (${order.financialStatus}) to the warehouse (Returned / Re)?\n\nThis unlinks it from any payout and clears collected amounts.`,
      )
    )
      return;
    try {
      const data = await returnDeliveredViaApi([order.id], "RETURN", "Re");
      alert(`Returned ${data.count} delivered order(s) to the warehouse.`);
      setSelectedOrderIds((prev) => prev.filter((id) => id !== order.id));
      await fetchOrders();
    } catch (error: any) {
      alert(error.message || "Failed to return the order to warehouse.");
    }
  };

  // ── Bulk "Warehouse" — routes delivered (WO/WD) orders through the new
  // permission-gated endpoint (which unlinks + recalculates payouts) and keeps
  // the legacy PATCH behavior for all other selected orders. ──
  const handleBulkMoveToWarehouse = async () => {
    if (selectedOrderIds.length === 0) return;
    if (
      !window.confirm(
        `Move ${selectedOrderIds.length} order(s) to the warehouse?`,
      )
    )
      return;

    const selectedById = new Map(
      orders
        .filter((o) => selectedOrderIds.includes(o.id))
        .map((o) => [o.id, o]),
    );
    const deliveredIds = selectedOrderIds.filter((id) => {
      const o = selectedById.get(id);
      return (
        o?.location === "DELIVERED" && ["WO", "WD"].includes(o.financialStatus)
      );
    });
    const otherIds = selectedOrderIds.filter(
      (id) => !deliveredIds.includes(id),
    );

    try {
      if (deliveredIds.length > 0) {
        await returnDeliveredViaApi(deliveredIds, "WAREHOUSE", "UD");
      }
      if (otherIds.length > 0) {
        await Promise.all(
          otherIds.map((id) =>
            fetch("/api/orders", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                location: "WAREHOUSE",
                financialStatus: "UD",
                driverId: null,
                isArchived: false,
              }),
            }),
          ),
        );
      }
      setSelectedOrderIds([]);
      await fetchOrders();
    } catch (error: any) {
      alert(error.message || "Failed to move orders to warehouse.");
    }
  };

  // ── Move selected CP orders into the main warehouse ───────────────────
  // Each order is matched to its delivery zone from the cities database and
  // unknown addresses fall back to zone "99". Only CP orders are affected.
  const [movingFromCp, setMovingFromCp] = useState(false);
  const handleMoveFromCpToWarehouse = async () => {
    const cpIds = selectedOrderIds.filter((id) => {
      const o = orders.find((ord) => ord.id === id);
      return o?.location === "CP";
    });
    if (cpIds.length === 0) {
      alert("Select CP (pickup) orders to move to the warehouse first.");
      return;
    }
    if (
      !window.confirm(
        `Move ${cpIds.length} CP order(s) to the warehouse?\n\nZones will be auto-assigned from the cities database (unknown addresses go to zone 99).`,
      )
    )
      return;

    setMovingFromCp(true);
    try {
      const res = await fetch("/api/admin/orders/move-from-cp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: cpIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to move orders from CP");
      }
      alert(`Moved ${data.movedCount} order(s) to the warehouse.`);
      setSelectedOrderIds([]);
      await fetchOrders();
    } catch (error: any) {
      alert(error.message || "Failed to move orders from CP.");
    } finally {
      setMovingFromCp(false);
    }
  };

  // ── Generic Bulk Action Handler ──
  const handleBulkAction = async (
    actionName: string,
    updateData: Record<string, unknown>,
  ) => {
    if (
      !window.confirm(
        `Are you sure you want to ${actionName} ${selectedOrderIds.length} order(s)?`,
      )
    )
      return;
    try {
      await Promise.all(
        selectedOrderIds.map((id) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...updateData }),
          }),
        ),
      );
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (error) {
      alert(`Failed to execute ${actionName}.`);
    }
  };

  // ── Permanent Archive Deletion Handler ──
  const handlePermanentDelete = async (deleteAll: boolean = false) => {
    const countText = deleteAll
      ? "ALL archived orders"
      : `${selectedOrderIds.length} selected order(s)`;

    // Mandatory confirmation safeguard
    const isConfirmed = window.confirm(
      `⚠️ WARNING: You are about to PERMANENTLY DELETE ${countText}.\n\nThis action cannot be undone and will erase these records from the database forever. Do you wish to proceed?`,
    );

    if (!isConfirmed) return;

    try {
      const res = await fetch("/api/admin/orders/archive", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: selectedOrderIds,
          deleteAll: deleteAll,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(`Error: ${data.error}`);
        return;
      }

      alert(`Successfully deleted ${data.count} order(s) permanently.`);
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (err) {
      console.error("Deletion failed:", err);
      alert("A network error occurred while attempting to delete orders.");
    }
  };

  // ── Bulk Zone Reassignment Handler ──
  const handleBulkZoneMove = async () => {
    if (!bulkTargetZoneId) {
      alert("Please select a target zone.");
      return;
    }
    if (selectedOrderIds.length === 0) {
      alert("No orders selected.");
      return;
    }
    const zoneName =
      zones.find((z) => z.id === bulkTargetZoneId)?.name || bulkTargetZoneId;
    if (
      !window.confirm(
        `Move ${selectedOrderIds.length} order(s) to zone "${zoneName}"?`,
      )
    )
      return;

    try {
      const res = await fetch("/api/admin/orders/bulk-zone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: selectedOrderIds,
          targetZoneId: bulkTargetZoneId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reassign zones");
      }

      const data = await res.json();
      setSelectedOrderIds([]);
      setBulkTargetZoneId("");
      fetchOrders();
      alert(`Successfully moved ${data.count} order(s) to "${zoneName}".`);
    } catch (error: any) {
      alert(error.message || "Failed to reassign zones.");
    }
  };

  // ── Clear Returns Handler (Re/EX -> RTS) ──
  const handleClearReturns = async (sellerName: string, orderIds: string[]) => {
    if (
      !window.confirm(
        `Mark ${orderIds.length} returned/exchange orders as "Returned to Seller" for ${sellerName}?\nThis changes their status to RTS (Returned to Seller).`,
      )
    )
      return;
    try {
      const res = await fetch("/api/admin/orders/returns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, newStatus: "RTS" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update returns");
      }
      fetchOrders();
    } catch (error: any) {
      alert(error.message || "Failed to clear returned orders.");
    }
  };

  // ── Bulk Returned to Seller Handler (Re/EX -> RTS) ──
  const [rtsUpdating, setRtsUpdating] = useState(false);
  const [rwdUpdating, setRwdUpdating] = useState(false);
  const handleBulkRTS = async () => {
    if (selectedOrderIds.length === 0) return;
    // Validate: all selected must have financialStatus "Re" or "EX" (warehouse)
    const selectedOrders = orders.filter((o) =>
      selectedOrderIds.includes(o.id),
    );
    const allWarehouse = selectedOrders.every((o) =>
      ["Re", "EX"].includes(o.financialStatus),
    );
    if (!allWarehouse) {
      alert(
        "All selected orders must have financial status 'Re' (Warehouse) or 'EX' (Exchange at Warehouse).",
      );
      return;
    }
    if (
      !window.confirm(
        `Mark ${selectedOrderIds.length} order(s) as "Returned to Seller"?`,
      )
    )
      return;
    setRtsUpdating(true);
    try {
      const res = await fetch("/api/admin/orders/returns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrderIds, newStatus: "RTS" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update returns");
      }
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (error: any) {
      alert(error.message || "Failed to update returns.");
    } finally {
      setRtsUpdating(false);
    }
  };

  // ── Bulk RWD/EWD to Warehouse Handler (RWD -> Re, EWD -> EX) ──
  const handleBulkRWDToWarehouse = async () => {
    if (selectedOrderIds.length === 0) return;
    const selectedOrders = orders.filter((o) =>
      selectedOrderIds.includes(o.id),
    );
    const allWithDriver = selectedOrders.every((o) =>
      ["RWD", "EWD"].includes(o.financialStatus),
    );
    if (!allWithDriver) {
      alert(
        "All selected orders must have financial status 'RWD' (Return with Driver) or 'EWD' (Exchange with Driver).",
      );
      return;
    }
    if (
      !window.confirm(
        `Move ${selectedOrderIds.length} order(s) to returns warehouse?`,
      )
    )
      return;
    setRwdUpdating(true);
    try {
      const res = await fetch("/api/admin/orders/returns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrderIds, newStatus: "Re" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update orders");
      }
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (error: any) {
      alert(error.message || "Failed to update orders.");
    } finally {
      setRwdUpdating(false);
    }
  };

  // ── Notes modal ──
  const parseNotes = (notes: string): string[] => {
    if (!notes) return [];
    return notes
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
  };

  const openNotesModal = (order: Order) => {
    setNotesModal(order);
    const parsed = parseNotes(order.notes);
    setSelectedNotes(parsed.filter((n) => NOTES_OPTIONS.includes(n)));
    const custom = parsed.filter((n) => !NOTES_OPTIONS.includes(n));
    setCustomNote(custom.length > 0 ? custom.join(", ") : "");
  };

  const toggleNote = (note: string) => {
    setSelectedNotes((prev) =>
      prev.includes(note) ? prev.filter((n) => n !== note) : [...prev, note],
    );
  };

  const submitNotes = async () => {
    if (!notesModal) return;
    const merged = [
      ...selectedNotes,
      ...(customNote.trim() ? [customNote.trim()] : []),
    ];
    await patchOrder(notesModal.id, { notes: merged.join(", ") });
    setNotesModal(null);
  };

  // ── Seller modal ──
  const openSellerModal = (order: Order) => {
    setSellerModal(order);
    setNewMerchantId(order.merchantId || "");
  };

  const submitSeller = async () => {
    if (!sellerModal) return;
    await patchOrder(sellerModal.id, { merchantId: newMerchantId || null });
    setSellerModal(null);
  };

  // ── Edit modal ──
  const openEditModal = (order: Order) => {
    setEditModal(order);
    setEditFormData({
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      zoneId: order.zoneId,
      amountUsd: order.amountUsd.toString(),
      amountLbp: order.amountLbp.toString(),
      hasExchange: order.hasExchange,
      extraShipping: (order as any).extraShipping?.toString() || "0",
    });
  };

  const submitEdit = async () => {
    if (!editModal) return;
    const payload: Record<string, unknown> = {
      customerName: editFormData.customerName,
      customerPhone: editFormData.customerPhone,
      customerAddress: editFormData.customerAddress,
      zoneId: editFormData.zoneId,
      hasExchange: editFormData.hasExchange,
    };
    // Monetary fields require ORDERS_FINANCIAL (ADMIN bypasses); staff
    // without the permission submit the non-financial fields only.
    if (userHasPermission("ORDERS_FINANCIAL")) {
      payload.amountUsd = parseFloat(editFormData.amountUsd) || 0;
      payload.amountLbp = parseFloat(editFormData.amountLbp) || 0;
      payload.extraShipping = parseFloat(editFormData.extraShipping) || 0;
    }
    const success = await patchOrder(editModal.id, payload);
    if (success) setEditModal(null);
  };

  // ── Assign Driver modal ──
  const openDriverModal = (order: Order) => {
    setDriverModal(order);
    setNewDriverId(order.driverId || "");
  };

  const submitDriver = async () => {
    if (!driverModal) return;
    // Block reassignment on delivered/paid-out orders
    if (["WD", "WO"].includes(driverModal.financialStatus)) {
      alert(
        `Cannot reassign driver on this order (status: ${driverModal.financialStatus}). Use the payout section to return it to warehouse first.`,
      );
      return;
    }
    await patchOrder(driverModal.id, { driverId: newDriverId || null });
    setDriverModal(null);
  };

  // ── Revert ──
  const handleRevert = (id: string, targetLocation: string) => {
    patchOrder(id, { location: targetLocation, financialStatus: "UD" });
    setRevertModal(null);
  };

  // ── Table row renderer (delegated to SharedOrderTable) ──

  // ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
  //  MAIN RENDER
  // ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Background grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] pointer-events-none z-0" />

      <div className="relative z-10 w-full max-w-full px-2 lg:px-6 py-4 md:py-6">
        {/* ── Header ── */}
        <div className="mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
              Orders
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage, track, and report on all your deliveries.
            </p>
          </div>
        </div>

        {/* ── Hidden Datalist for seller search ── */}
        <datalist id="seller-options">
          {sellersList.map((s) => (
            <option key={s.id} value={`${s.numericId} - ${s.name}`} />
          ))}
        </datalist>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 w-fit">
          {[
            { key: "all" as Tab, label: "All Orders" },
            { key: "warehouse" as Tab, label: "Warehouse" },
            {
              key: "cp" as Tab,
              label: `CP (Pickup) (${cpTotal})`,
            },
            { key: "reports" as Tab, label: "Reports" },
            {
              key: "rwd" as Tab,
              label: `Return w/ Driver (${rwdTotal})`,
            },
            { key: "returns" as Tab, label: "Returns & Exchange" },
            ...(userHasPermission("ORDERS_CREATE")
              ? [{ key: "order-entry" as Tab, label: "Order Entry" }]
              : []),
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                currentTab === tab.key
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════ */}
        {/* ALL ORDERS TAB                   */}
        {/* ════════════════════════════════ */}
        {currentTab === "all" && (
          <>
            {/* Smart Universal Action Bar */}
            <div className="flex flex-col gap-3 mb-4">
              {/* Row 1: Print/Export + Bulk Actions + Single Actions + New Order */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Export Buttons (inline) */}
                  {selectedOrderIds.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 mr-1">
                        {selectedOrderIds.length} selected
                      </span>
                      <button
                        onClick={() =>
                          window.open(
                            "/orders/print?ids=" + selectedOrderIds.join(","),
                            "_blank",
                          )
                        }
                        title="Open printable waybills for the selected orders"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                      >
                        🖨️ Print Waybills
                      </button>
                      <button
                        onClick={() =>
                          window.open(
                            "/print/orders?ids=" +
                              selectedOrderIds.join(",") +
                              "&simple=true",
                            "_blank",
                          )
                        }
                        title="Open a printable financial summary of the selected orders (non-waybill)"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-colors"
                      >
                        📋 Summary
                      </button>
                      <button
                        onClick={() => setExcelModalOpen(true)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                      >
                        📊 Excel
                      </button>
                      <button
                        onClick={() =>
                          window.open(
                            "/orders/print?ids=" +
                              selectedOrderIds.join(",") +
                              "&pdf=true",
                            "_blank",
                          )
                        }
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                      >
                        📑 PDF
                      </button>
                    </div>
                  )}

                  {/* Separator */}
                  <div className="w-px h-6 bg-white/10 mx-1" />

                  {/* ── Bulk Action Buttons (enabled when selectedOrderIds.length > 0) ── */}
                  <button
                    onClick={() => setAssignModalOpen(true)}
                    disabled={selectedOrderIds.length === 0}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-sky-500/20 text-sky-300 border border-sky-500/30
                               hover:bg-sky-500/30 hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    Assign
                  </button>
                  {/* ── Scan Order to Assign (single-order scanner) ── */}
                  <button
                    onClick={() => setScannerOpen(true)}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                               hover:bg-cyan-500/30 hover:shadow-[0_0_12px_rgba(6,182,212,0.3)]
                               transition-all duration-200"
                    title="Scan a barcode/QR code to find and assign an order to a driver"
                  >
                    📷 Scan to Assign
                  </button>
                  <button
                    onClick={handleBulkMoveToWarehouse}
                    disabled={selectedOrderIds.length === 0}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-yellow-500/20 text-yellow-400 border border-yellow-500/30
                               hover:bg-yellow-500/30 hover:shadow-[0_0_12px_rgba(234,179,8,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    Warehouse
                  </button>
                  <button
                    onClick={handleMoveFromCpToWarehouse}
                    disabled={selectedOrderIds.length === 0 || movingFromCp}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-purple-500/20 text-purple-300 border border-purple-500/30
                               hover:bg-purple-500/30 hover:shadow-[0_0_12px_rgba(168,85,247,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                    title="Move selected CP (pickup) orders to the warehouse with auto-assigned zones"
                  >
                    {movingFromCp ? "Moving..." : "Move from CP to Warehouse"}
                  </button>
                  <button
                    onClick={() =>
                      handleBulkAction("Deliver", {
                        location: "DELIVERED",
                        financialStatus: "WD",
                      })
                    }
                    disabled={selectedOrderIds.length === 0}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-green-500/20 text-green-400 border border-green-500/30
                               hover:bg-green-500/30 hover:shadow-[0_0_12px_rgba(34,197,94,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    Deliver
                  </button>
                  <button
                    onClick={() =>
                      handleBulkAction("Return", {
                        location: "RETURN",
                        status: "Re",
                      })
                    }
                    disabled={selectedOrderIds.length === 0}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-red-500/20 text-red-400 border border-red-500/30
                               hover:bg-red-500/30 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    Return
                  </button>

                  {/* ── Return Delivered (WO/WD) to Warehouse — permission-gated ── */}
                  <PermissionGuard requires="ACTION_ORDER_RETURN">
                    <button
                      onClick={handleReturnDelivered}
                      disabled={selectedOrderIds.length === 0}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                                 bg-orange-500/20 text-orange-400 border border-orange-500/30
                                 hover:bg-orange-500/30 hover:shadow-[0_0_12px_rgba(249,115,22,0.3)]
                                 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all duration-200"
                      title="Return selected delivered (WO/WD) orders to the warehouse (Returned / Re)"
                    >
                      Return Delivered
                    </button>
                  </PermissionGuard>

                  {currentUser?.role === "ADMIN" && (
                    <button
                      onClick={() =>
                        handleBulkAction("Archive", {
                          isArchived: true,
                          location: "Archive",
                          financialStatus: "Arc",
                        })
                      }
                      disabled={selectedOrderIds.length === 0}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                                 bg-red-500/20 text-red-400 border border-red-500/30
                                 hover:bg-red-500/30 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)]
                                 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all duration-200"
                    >
                      Delete
                    </button>
                  )}

                  {/* ── Archive Permanent Deletion Controls (archive view only) ── */}
                  {showArchived && currentUser?.role === "ADMIN" && (
                    <>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        onClick={() => handlePermanentDelete(false)}
                        disabled={selectedOrderIds.length === 0}
                        className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                                   bg-red-500/20 text-red-400 border border-red-500/30
                                   hover:bg-red-500/30 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)]
                                   disabled:opacity-30 disabled:cursor-not-allowed
                                   transition-all duration-200"
                      >
                        Delete Selected Permanently
                      </button>
                      <button
                        onClick={() => handlePermanentDelete(true)}
                        disabled={allFiltered.length === 0}
                        className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                                   bg-red-600/20 text-red-400 border border-red-600/40
                                   hover:bg-red-600/30 hover:shadow-[0_0_12px_rgba(220,38,38,0.3)]
                                   disabled:opacity-30 disabled:cursor-not-allowed
                                   transition-all duration-200"
                      >
                        Empty Entire Archive
                      </button>
                    </>
                  )}

                  {/* Separator */}
                  <div className="w-px h-6 bg-white/10 mx-1" />

                  {/* ── Single Order Action Buttons (enabled ONLY when length === 1) ── */}
                  <button
                    onClick={() => {
                      const o = orders.find(
                        (o) => o.id === selectedOrderIds[0],
                      );
                      if (o) openEditModal(o);
                    }}
                    disabled={selectedOrderIds.length !== 1}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-blue-500/20 text-blue-400 border border-blue-500/30
                               hover:bg-blue-500/30 hover:shadow-[0_0_12px_rgba(59,130,246,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      const o = orders.find(
                        (o) => o.id === selectedOrderIds[0],
                      );
                      if (o) {
                        setCustomPayOrder(o);
                        setCustomUsd("");
                        setCustomLbp("");
                        setCustomPayModalOpen(true);
                      }
                    }}
                    disabled={selectedOrderIds.length !== 1}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-amber-500/20 text-amber-400 border border-amber-500/30
                               hover:bg-amber-500/30 hover:shadow-[0_0_12px_rgba(245,158,11,0.3)]
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    $ Custom
                  </button>
                  {currentUser?.role === "ADMIN" && (
                    <button
                      onClick={() => {
                        setNewSellerInput("");
                        setIsSellerModalOpen(true);
                      }}
                      disabled={selectedOrderIds.length === 0}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                                 bg-amber-500/20 text-amber-400 border border-amber-500/30
                                 hover:bg-amber-500/30 hover:shadow-[0_0_12px_rgba(245,158,11,0.3)]
                                 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all duration-200"
                    >
                      Seller Change
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {userHasPermission("ORDERS_CREATE") && (
                    <button
                      onClick={() => setIsCreateModalOpen(true)}
                      className="px-5 py-2.5 text-sm font-semibold rounded-xl
                                 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                                 hover:bg-cyan-500/30 hover:shadow-[0_0_16px_rgba(6,182,212,0.3)]
                                 transition-all duration-200"
                    >
                      + New Order
                    </button>
                  )}
                  {currentUser?.role === "ADMIN" && (
                    <button
                      onClick={() => {
                        // Reset location/date filters when entering the archive so
                        // the archived set isn't hidden by active-only filters.
                        if (!showArchived) {
                          setLocationFilter("ALL");
                          setDateFilter("");
                        }
                        setShowArchived(!showArchived);
                      }}
                      className="px-4 py-2.5 text-xs font-semibold rounded-xl
                                 bg-white/5 text-gray-400 border border-white/10
                                 hover:text-gray-200 hover:bg-white/10
                                 transition-all duration-200"
                    >
                      {showArchived ? "View Active Orders" : "View Archive"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              {/* Search */}
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  placeholder="Search orders by order id / phone, comma-separated (e.g., 8627,78981891,981891) or text (e.g., Hamra)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl
                             backdrop-blur-xl bg-white/5 border border-white/10
                             text-white placeholder-gray-500
                             focus:outline-none focus:border-cyan-500/50
                             focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                             transition-all duration-200"
                />
              </div>

              {/* Missing tokens warning — shown below search input */}
              {missingTokens.length > 0 && (
                <div className="text-red-500 text-sm mt-1 font-medium">
                  Orders not found: {missingTokens.join(", ")}
                </div>
              )}

              {/* Location filter */}
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="px-4 py-2.5 text-sm rounded-xl
                           backdrop-blur-xl bg-slate-950 text-white border border-gray-700
                           outline-none focus:border-cyan-500
                           focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                           transition-all duration-200"
              >
                <option value="ALL" className="bg-slate-950 text-white">
                  All Locations
                </option>
                {LOCATION_FILTERS.map((f) => (
                  <option
                    key={f.key}
                    value={f.key}
                    className="bg-slate-950 text-white"
                  >
                    {f.label}
                  </option>
                ))}
              </select>

              {/* Date filter */}
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-4 py-2.5 text-sm rounded-xl
                           backdrop-blur-xl bg-white/5 border border-white/10
                           text-gray-300 [color-scheme:dark]
                           focus:outline-none focus:border-cyan-500/50
                           focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                           transition-all duration-200"
              />
            </div>

            {/* Rows per page dropdown - top right */}
            <div className="flex justify-end mb-3">
              <div className="flex items-center space-x-2">
                <label className="text-xs text-slate-400">Rows per page:</label>
                <select
                  value={
                    [50, 100, 200, 500, 1000].includes(allItemsPerPage)
                      ? allItemsPerPage
                      : "all"
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setAllItemsPerPage(val === "all" ? 5000 : Number(val));
                    setAllPage(1);
                  }}
                  className="bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500 transition-all"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                  <option value={5000}>5000 (max)</option>
                </select>
                <span className="text-xs text-gray-500 ml-2">
                  Showing {paginatedAll.length} of {totalOrders} order(s)
                </span>
              </div>
            </div>

            {/* High-Density Table */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg
                  className="animate-spin h-8 w-8 text-cyan-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
            ) : (
              (() => {
                const allTotalPages = Math.ceil(totalOrders / allItemsPerPage);
                return (
                  <>
                    <SharedOrderTable
                      orders={paginatedAll}
                      selectedOrderIds={selectedOrderIds}
                      onToggleSelectOrder={toggleSelectOrder}
                      onToggleSelectAll={toggleSelectAll}
                      isAllSelected={
                        selectedOrderIds.length === paginatedAll.length &&
                        paginatedAll.length > 0
                      }
                      availableDrivers={availableDrivers}
                      onUpdateOrder={updateOrder}
                      currentUser={currentUser}
                      onCopyLink={handleCopyLink}
                      onReturnDelivered={handleReturnOrderToWarehouse}
                    />
                    {allTotalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 px-2">
                        <p className="text-xs text-gray-500">
                          Showing {(allPage - 1) * allItemsPerPage + 1}–
                          {Math.min(allPage * allItemsPerPage, totalOrders)} of{" "}
                          {totalOrders}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() =>
                              setAllPage((p) => Math.max(1, p - 1))
                            }
                            disabled={allPage === 1}
                            className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            Prev
                          </button>
                          {(() => {
                            const pages: number[] = [];
                            const visible = [1, allTotalPages];
                            if (allPage > 1) pages.push(allPage - 1);
                            pages.push(allPage);
                            if (allPage < allTotalPages)
                              pages.push(allPage + 1);
                            const sorted = [
                              ...new Set([...pages, ...visible]),
                            ].sort((a, b) => a - b);
                            return sorted.map((page) => (
                              <button
                                key={page}
                                onClick={() => setAllPage(page)}
                                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                                  allPage === page
                                    ? "bg-cyan-600 border-cyan-500 text-white"
                                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                {page}
                              </button>
                            ));
                          })()}
                          <button
                            onClick={() =>
                              setAllPage((p) => Math.min(allTotalPages, p + 1))
                            }
                            disabled={allPage === allTotalPages}
                            className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </>
        )}

        {/* ════════════════════════════════ */}
        {/* WAREHOUSE TAB                    */}
        {/* ════════════════════════════════ */}
        {currentTab === "warehouse" && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg
                  className="animate-spin h-8 w-8 text-cyan-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
            ) : zones.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-sm">No zones configured.</p>
              </div>
            ) : (
              <>
                {/* Batch Search Input */}
                <div className="mb-4">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                      🔍
                    </span>
                    <input
                      type="text"
                      placeholder="Batch Select (Paste comma-separated Order IDs) — e.g. 10049805, 10049806, #10049810..."
                      value={batchSearchQuery}
                      onChange={(e) => setBatchSearchQuery(e.target.value)}
                      className="w-full md:w-[32rem] pl-9 pr-3 py-1.5 border border-gray-700 rounded-lg bg-slate-900 text-white text-sm placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                    />
                  </div>
                  {batchSearchQuery.trim() && (
                    <p className="text-[11px] text-cyan-400 mt-1 ml-1">
                      Filtering by batch IDs — select all will only apply to
                      visible results.
                    </p>
                  )}
                </div>

                {/* Zone sub-tabs */}
                <div className="flex gap-1 mb-6 p-1 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 overflow-x-auto">
                  {zones.map((zone) => {
                    const count = warehouseOrders.filter(
                      (o) => o.zoneId === zone.id,
                    ).length;
                    return (
                      <button
                        key={zone.id}
                        onClick={() => setActiveWarehouseZone(zone.id)}
                        className={`whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                          activeWarehouseZone === zone.id
                            ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                            : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                        }`}
                      >
                        {zone.name} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Bulk action bar */}
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs text-gray-500">
                    {selectedOrderIds.length > 0 ? (
                      <span className="text-cyan-400 font-semibold">
                        {selectedOrderIds.length} order(s) selected
                      </span>
                    ) : (
                      <span>Select orders to assign</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Quick Assign (type IDs + pick driver) */}
                    <button
                      onClick={() => setQuickAssignModalOpen(true)}
                      className="px-4 py-2 text-xs font-semibold rounded-lg
                                 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30
                                 hover:bg-emerald-500/30 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)]
                                 transition-all duration-200"
                    >
                      ⚡ Quick Assign
                    </button>

                    {/* Assign to Driver */}
                    <button
                      onClick={() => setAssignModalOpen(true)}
                      disabled={selectedOrderIds.length === 0}
                      className="px-4 py-2 text-xs font-semibold rounded-lg
                                 bg-sky-500/20 text-sky-300 border border-sky-500/30
                                 hover:bg-sky-500/30 hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]
                                 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all duration-200"
                    >
                      Assign Selected to Driver ({selectedOrderIds.length})
                    </button>

                    {/* Zone Dropdown + Move Button */}
                    <select
                      value={bulkTargetZoneId}
                      onChange={(e) => setBulkTargetZoneId(e.target.value)}
                      disabled={selectedOrderIds.length === 0}
                      className="px-2 py-2 text-xs rounded-lg bg-slate-950 text-white border border-gray-700
                                 outline-none focus:border-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all duration-200"
                    >
                      <option value="" className="bg-slate-950 text-white">
                        Move to zone...
                      </option>
                      {zones.map((z) => (
                        <option
                          key={z.id}
                          value={z.id}
                          className="bg-slate-950 text-white"
                        >
                          {z.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleBulkZoneMove}
                      disabled={
                        selectedOrderIds.length === 0 || !bulkTargetZoneId
                      }
                      className="px-3 py-2 text-xs font-semibold rounded-lg
                                  bg-purple-500/20 text-purple-300 border border-purple-500/30
                                  hover:bg-purple-500/30 hover:shadow-[0_0_12px_rgba(168,85,247,0.3)]
                                  disabled:opacity-30 disabled:cursor-not-allowed
                                  transition-all duration-200"
                    >
                      Move
                    </button>

                    {/* Rows per page selector */}
                    <div className="flex items-center space-x-2">
                      <label className="text-xs text-slate-400">
                        Rows per page:
                      </label>
                      <select
                        value={
                          [50, 100, 200, 300].includes(itemsPerPage)
                            ? itemsPerPage
                            : "all"
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setItemsPerPage(
                            val === "all"
                              ? warehouseOrders.length
                              : Number(val),
                          );
                          setWarehousePage(1);
                        }}
                        className="bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500 transition-all"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                        <option value={300}>300</option>
                        <option value="all">All</option>
                      </select>
                      <span className="text-xs text-gray-500 ml-2">
                        Showing {paginatedWarehouseItems.length} of{" "}
                        {warehouseItems.length} order(s)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Orders for selected zone — compact table */}
                {activeWarehouseZone ? (
                  (() => {
                    const totalPages = Math.ceil(
                      warehouseItems.length / itemsPerPage,
                    );
                    const paginatedItems = paginatedWarehouseItems;

                    const handleWarehouseSelectAll = () => {
                      if (
                        selectedOrderIds.length === warehouseItems.length &&
                        warehouseItems.length > 0
                      ) {
                        setSelectedOrderIds([]);
                      } else {
                        setSelectedOrderIds(warehouseItems.map((o) => o.id));
                      }
                    };

                    return warehouseItems.length === 0 ? (
                      <div className="text-center py-20">
                        <p className="text-gray-500 text-sm">
                          {batchSearchQuery.trim()
                            ? "No orders match the batch search."
                            : "No orders in this zone."}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="w-full overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-max whitespace-nowrap text-sm">
                            <thead>
                              <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                                <th className="px-2 py-2 text-left font-medium w-8">
                                  <input
                                    type="checkbox"
                                    checked={
                                      selectedOrderIds.length ===
                                        warehouseItems.length &&
                                      warehouseItems.length > 0
                                    }
                                    onChange={handleWarehouseSelectAll}
                                    className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                                  />
                                </th>
                                <SortableTh
                                  label="Order ID"
                                  sortKey="orderId"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Date Received"
                                  sortKey="dateReceived"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Seller"
                                  sortKey="seller"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Customer"
                                  sortKey="customer"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Phone"
                                  sortKey="phone"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Address"
                                  sortKey="address"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Driver"
                                  sortKey="driver"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Fin Status"
                                  sortKey="fin"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Amt $"
                                  sortKey="amountUsd"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  align="text-right"
                                  className="px-2"
                                />
                                <SortableTh
                                  label="Amt LL"
                                  sortKey="amountLbp"
                                  activeKey={warehouseSortKey}
                                  dir={warehouseSortDir}
                                  onSort={handleWarehouseSort}
                                  align="text-right"
                                  className="px-2"
                                />
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedItems.map((order) => (
                                <tr
                                  key={order.id}
                                  className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                                >
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="checkbox"
                                      checked={selectedOrderIds.includes(
                                        order.id,
                                      )}
                                      onChange={() =>
                                        toggleSelectOrder(order.id)
                                      }
                                      className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 text-xs font-mono text-gray-300 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() =>
                                          setHistoryModalOrder({
                                            id: order.id,
                                            history: order.history || [],
                                            payoutReference:
                                              order.driverPayout
                                                ?.payoutReference ?? null,
                                          })
                                        }
                                        title="Order History"
                                        className="text-[10px] px-1 py-0.5 rounded border transition-all bg-white/5 text-gray-500 border-white/10 hover:bg-cyan-500/10 hover:text-cyan-400"
                                      >
                                        &#9776;
                                      </button>
                                      <span>#{order.orderId}</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                                    {formatDDMMYYYY(order.createdAt)}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-cyan-300 whitespace-nowrap">
                                    {order.merchant
                                      ? order.merchant.ownerFirstName ||
                                        order.merchant.merchantName
                                      : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-white whitespace-nowrap">
                                    {order.customerName}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                                    {order.customerPhone}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-400 max-w-[120px] truncate">
                                    {order.customerAddress}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                                    {order.driver
                                      ? `${order.driver.firstName} ${order.driver.lastName}`
                                      : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                                    {order.financialStatus}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-300 text-right whitespace-nowrap">
                                    ${order.amountUsd.toFixed(2)}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-gray-300 text-right whitespace-nowrap">
                                    {order.amountLbp.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Pagination controls */}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between mt-3 px-2">
                            <p className="text-xs text-gray-500">
                              Showing {(warehousePage - 1) * itemsPerPage + 1} –{" "}
                              {Math.min(
                                warehousePage * itemsPerPage,
                                warehouseItems.length,
                              )}{" "}
                              of {warehouseItems.length}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  setWarehousePage((p) => Math.max(1, p - 1))
                                }
                                disabled={warehousePage === 1}
                                className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                ← Prev
                              </button>
                              {Array.from(
                                { length: totalPages },
                                (_, i) => i + 1,
                              )
                                .filter((page) => {
                                  // Show first, last, current ± 1 pages
                                  if (
                                    page === 1 ||
                                    page === totalPages ||
                                    Math.abs(page - warehousePage) <= 1
                                  ) {
                                    return true;
                                  }
                                  return false;
                                })
                                .reduce((acc: number[], page, idx, arr) => {
                                  if (idx > 0 && page - arr[idx - 1] > 1) {
                                    acc.push(-1); // ellipsis marker
                                  }
                                  acc.push(page);
                                  return acc;
                                }, [])
                                .map((page, idx) =>
                                  page === -1 ? (
                                    <span
                                      key={`ellipsis-${idx}`}
                                      className="px-1 text-gray-600"
                                    >
                                      …
                                    </span>
                                  ) : (
                                    <button
                                      key={page}
                                      onClick={() => setWarehousePage(page)}
                                      className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                                        warehousePage === page
                                          ? "bg-cyan-600 border-cyan-500 text-white"
                                          : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                                      }`}
                                    >
                                      {page}
                                    </button>
                                  ),
                                )}
                              <button
                                onClick={() =>
                                  setWarehousePage((p) =>
                                    Math.min(totalPages, p + 1),
                                  )
                                }
                                disabled={warehousePage === totalPages}
                                className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                Next →
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-center py-20">
                    <p className="text-gray-500 text-sm">
                      Select a zone above to view orders.
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ════════════════════════════════ */}
        {/* CP (PICKUP) WAREHOUSE TAB        */}
        {/* ════════════════════════════════ */}
        {currentTab === "cp" && (
          <>
            {/* Header + Move to Warehouse action */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-200">
                  CP (Customer Pickup) — Merchant Orders
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Orders created by merchants are staged here. Select orders and
                  move them to the warehouse — zones are auto-assigned from the
                  cities database (unknown addresses go to zone 99).
                </p>
              </div>
              <button
                onClick={handleMoveFromCpToWarehouse}
                disabled={selectedOrderIds.length === 0 || movingFromCp}
                className="px-4 py-2 text-xs font-bold rounded-lg
                           bg-purple-500/20 text-purple-300 border border-purple-500/30
                           hover:bg-purple-500/30 hover:shadow-[0_0_12px_rgba(168,85,247,0.3)]
                           disabled:opacity-30 disabled:cursor-not-allowed
                           transition-all duration-200 whitespace-nowrap"
              >
                {movingFromCp
                  ? "Moving..."
                  : `🚚 Move to Warehouse (${
                      selectedOrderIds.filter((id) => {
                        const o = orders.find((ord) => ord.id === id);
                        return o?.location === "CP";
                      }).length
                    } selected)`}
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg
                  className="animate-spin h-8 w-8 text-cyan-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
            ) : cpOrders.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-sm">
                  No orders in the CP (pickup) warehouse.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-500">
                    {cpOrders.length} CP order(s)
                  </span>
                  <button
                    onClick={() => {
                      if (selectedOrderIds.length === cpOrders.length) {
                        setSelectedOrderIds([]);
                      } else {
                        setSelectedOrderIds(cpOrders.map((o) => o.id));
                      }
                    }}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               bg-white/5 text-gray-300 border border-white/10
                               hover:bg-white/10 transition-colors"
                  >
                    {selectedOrderIds.length === cpOrders.length &&
                    cpOrders.length > 0
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>
                <SharedOrderTable
                  orders={cpOrders}
                  selectedOrderIds={selectedOrderIds}
                  onToggleSelectOrder={toggleSelectOrder}
                  onToggleSelectAll={() => {
                    if (selectedOrderIds.length === cpOrders.length) {
                      setSelectedOrderIds([]);
                    } else {
                      setSelectedOrderIds(cpOrders.map((o) => o.id));
                    }
                  }}
                  isAllSelected={
                    selectedOrderIds.length === cpOrders.length &&
                    cpOrders.length > 0
                  }
                  availableDrivers={availableDrivers}
                  onUpdateOrder={updateOrder}
                  currentUser={currentUser}
                  onCopyLink={handleCopyLink}
                  onReturnDelivered={handleReturnOrderToWarehouse}
                />
              </>
            )}
          </>
        )}

        {/* ════════════════════════════════ */}
        {/* REPORTS TAB                      */}
        {/* ════════════════════════════════ */}
        {currentTab === "reports" && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg
                  className="animate-spin h-8 w-8 text-cyan-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
            ) : reports.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-sm">
                  No data available for reports.
                </p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  <SummaryCard
                    label="Total Orders"
                    value={orders.length.toString()}
                    color="cyan"
                  />
                  <SummaryCard
                    label="Delivered"
                    value={orders
                      .filter((o) => o.location === "DELIVERED")
                      .length.toString()}
                    color="green"
                  />
                  <SummaryCard
                    label="Returned"
                    value={orders
                      .filter((o) => o.location === "RETURN")
                      .length.toString()}
                    color="red"
                  />
                  <SummaryCard
                    label="Avg Delivery Time"
                    value={(() => {
                      const delivered = orders.filter((o) => o.deliveredAt);
                      if (delivered.length === 0) return "—";
                      const avgMs =
                        delivered.reduce((acc, o) => {
                          const c = new Date(o.createdAt).getTime();
                          const d = new Date(o.deliveredAt!).getTime();
                          return acc + (d - c);
                        }, 0) / delivered.length;
                      const hours = Math.floor(avgMs / 3600000);
                      const mins = Math.round((avgMs % 3600000) / 60000);
                      return `${hours}h ${mins}m`;
                    })()}
                    color="purple"
                  />
                </div>

                {/* Per-day breakdown */}
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/10">
                    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      Daily Breakdown
                    </h3>
                  </div>
                  <div className="w-full overflow-x-auto">
                    <table className="w-full min-w-max whitespace-nowrap text-sm">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-500 text-xs uppercase tracking-wider">
                          <th className="text-left px-5 py-3 font-medium">
                            Date
                          </th>
                          <th className="text-right px-5 py-3 font-medium">
                            Total
                          </th>
                          <th className="text-right px-5 py-3 font-medium">
                            Delivered
                          </th>
                          <th className="text-right px-5 py-3 font-medium">
                            Returned
                          </th>
                          <th className="text-right px-5 py-3 font-medium">
                            Success %
                          </th>
                          <th className="text-right px-5 py-3 font-medium">
                            Avg Time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((r) => (
                          <tr
                            key={r.date}
                            className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                          >
                            <td className="px-5 py-3 text-gray-300 font-medium">
                              {r.date}
                            </td>
                            <td className="px-5 py-3 text-right text-white">
                              {r.total}
                            </td>
                            <td className="px-5 py-3 text-right text-green-400">
                              {r.delivered}
                            </td>
                            <td className="px-5 py-3 text-right text-red-400">
                              {r.returned}
                            </td>
                            <td className="px-5 py-3 text-right text-cyan-400">
                              {r.successRate}%
                            </td>
                            <td className="px-5 py-3 text-right text-purple-400">
                              {r.avgTime < 1
                                ? `${(r.avgTime * 60).toFixed(0)}m`
                                : `${r.avgTime.toFixed(1)}h`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* --- INLINE ORDER ENTRY STATION --- */}
        {currentTab === "order-entry" && (
          <div className="w-full max-w-full animate-fadeIn">
            {/* Waybill Upload */}
            <div className="mb-3 flex items-center gap-2">
              <input
                ref={waybillInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleWaybillUpload}
                className="hidden"
              />
              <button
                onClick={() => waybillInputRef.current?.click()}
                disabled={waybillUploading}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg
                           bg-purple-500/20 text-purple-300 border border-purple-500/30
                           hover:bg-purple-500/30 hover:shadow-[0_0_16px_rgba(168,85,247,0.3)]
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-200"
              >
                {waybillUploading ? "Uploading..." : "📄 Upload Waybill"}
              </button>
              <span className="text-[10px] text-gray-500 font-mono">
                Upload waybill image(s) — order number extracted automatically
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
              <form onSubmit={handleCreateOrder}>
                <div className="flex flex-nowrap gap-2 items-end">
                  {/* Order ID */}
                  <div className="flex flex-col gap-1 min-w-[90px]">
                    <label className="text-[10px] text-gray-500 font-mono uppercase">
                      Order ID
                    </label>
                    <input
                      type="text"
                      required
                      ref={orderIdInputRef}
                      value={formData.orderId}
                      onChange={(e) =>
                        setFormData({ ...formData, orderId: e.target.value })
                      }
                      placeholder="ORD-001"
                      className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                  {/* Seller */}
                  <div className="flex flex-col gap-1 min-w-[140px]">
                    <label className="text-[10px] text-gray-500 font-mono uppercase">
                      Seller
                    </label>
                    <input
                      type="text"
                      list="tab-seller-options"
                      value={formData.merchantId}
                      onChange={(e) =>
                        setFormData({ ...formData, merchantId: e.target.value })
                      }
                      placeholder="Name or ID"
                      className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                  {/* Customer */}
                  <div className="flex flex-col gap-1 min-w-[120px]">
                    <label className="text-[10px] text-gray-500 font-mono uppercase">
                      Customer
                    </label>
                    <input
                      type="text"
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
                  {/* Zone */}
                  <div className="flex flex-col gap-1 min-w-[110px]">
                    <label className="text-[10px] text-gray-500 font-mono uppercase">
                      Zone
                    </label>
                    <input
                      type="text"
                      required
                      list="tab-zone-options"
                      value={zoneInput}
                      onChange={(e) => setZoneInput(e.target.value)}
                      placeholder="Zone name"
                      className="px-2 py-1.5 text-xs rounded bg-slate-950 border border-gray-700 text-white placeholder-gray-600 focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                  {/* Amount USD */}
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
                  {/* Amount LBP */}
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
                  {/* Ex Shipping */}
                  <div className="flex flex-col gap-1 min-w-[80px]">
                    <label className="text-[10px] text-gray-500 font-mono uppercase">
                      Ex Ship
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.extraShipping}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          extraShipping: e.target.value,
                        })
                      }
                      placeholder="0.00"
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
                  {/* Exch */}
                  <div className="flex flex-col gap-1 min-w-[50px] items-center">
                    <label className="text-[10px] text-gray-500 font-mono uppercase">
                      Exch
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
                  {/* Save Button */}
                  <div className="flex flex-col gap-1 min-w-[80px]">
                    <div className="h-[10px]" />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full px-4 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {submitting ? "..." : "Save"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
            {/* Hidden datalists */}
            <datalist id="tab-seller-options">
              {sellersList.map((s: any) => (
                <option key={s.id} value={`${s.numericId} - ${s.name}`} />
              ))}
            </datalist>
            <datalist id="tab-zone-options">
              {zones.map((z: any) => (
                <option key={z.id} value={z.name} />
              ))}
            </datalist>

            {/* Recently Added Orders */}
            {orders
              .filter((o) => !o.isArchived)
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              )
              .slice(0, 5).length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Recently Added
                </h3>
                <div className="w-full overflow-x-auto bg-[#121824] border border-white/5 rounded-xl">
                  <table className="w-full min-w-max whitespace-nowrap text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-gray-500 text-[10px] uppercase tracking-wider">
                        <th className="px-3 py-2 text-left font-medium">
                          Order ID
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Seller
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Customer
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Phone
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Address
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Zone
                        </th>
                        <th className="px-3 py-2 text-left font-medium">USD</th>
                        <th className="px-3 py-2 text-left font-medium">LBP</th>
                        <th className="px-3 py-2 text-center font-medium">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders
                        .filter((o) => !o.isArchived)
                        .sort(
                          (a, b) =>
                            new Date(b.createdAt).getTime() -
                            new Date(a.createdAt).getTime(),
                        )
                        .slice(0, 5)
                        .map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                          >
                            <td className="px-3 py-2 text-cyan-300 font-mono">
                              {order.orderId}
                            </td>
                            <td className="px-3 py-2 text-gray-300">
                              {order.merchant?.merchantName || "—"}
                            </td>
                            <td className="px-3 py-2 text-white">
                              {order.customerName}
                            </td>
                            <td className="px-3 py-2 text-gray-300 font-mono">
                              {order.customerPhone}
                            </td>
                            <td className="px-3 py-2 text-gray-400 max-w-[200px] truncate">
                              {order.customerAddress}
                            </td>
                            <td className="px-3 py-2 text-gray-300">
                              {order.zone?.name || "—"}
                            </td>
                            <td className="px-3 py-2 text-green-400 font-mono">
                              {order.amountUsd}
                            </td>
                            <td className="px-3 py-2 text-gray-400 font-mono">
                              {order.amountLbp}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <PermissionGuard requires="ORDERS_EDIT">
                                <button
                                  onClick={() => openEditModal(order)}
                                  className="px-2 py-1 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all"
                                >
                                  Edit
                                </button>
                              </PermissionGuard>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Import Options */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Excel / CSV Upload */}
              <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
                <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
                  <span className="bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded text-[10px]">
                    BULK
                  </span>
                  Excel / CSV Upload
                </h3>
                <p className="text-[10px] text-gray-500 mb-3">
                  Upload an Excel (.xlsx, .xls) or CSV file with headers:
                  orderId, seller, customer, phone, address, zone, usd, lbp
                </p>
                <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-gray-700 border-dashed rounded-lg cursor-pointer hover:bg-slate-900/50 hover:border-cyan-500/50 transition-all">
                  <span className="text-xs text-cyan-400 font-bold">
                    {csvUploading
                      ? "Processing..."
                      : "Click to Upload Excel / CSV"}
                  </span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="hidden"
                    onChange={handleCsvUpload}
                    disabled={csvUploading}
                  />
                </label>
              </div>

              {/* Google Sheets Import */}
              <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
                <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
                  <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[10px]">
                    SHEETS
                  </span>
                  Google Sheets Import
                </h3>
                <p className="text-[10px] text-gray-500 mb-3">
                  Import orders from any seller's shared Google Sheet.
                </p>
                <button
                  type="button"
                  onClick={() => setGlobalSheetModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg
                             bg-emerald-500/20 text-emerald-400 border border-emerald-500/30
                             hover:bg-emerald-500/30 hover:shadow-[0_0_16px_rgba(52,211,153,0.25)]
                             transition-all duration-200"
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
                      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
                    />
                  </svg>
                  Import from Google Sheets
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════ */}
        {/* RETURNS TAB                          */}
        {/* ════════════════════════════════════ */}
        {currentTab === "returns" && (
          <>
            {/* Filter row */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              {/* Date filter */}
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="px-4 py-2.5 text-sm rounded-xl
                           backdrop-blur-xl bg-white/5 border border-white/10
                           text-gray-300 [color-scheme:dark]
                           focus:outline-none focus:border-cyan-500/50
                           focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                           transition-all duration-200"
              />

              {/* Seller filter */}
              <select
                value={returnSeller}
                onChange={(e) => setReturnSeller(e.target.value)}
                className="px-4 py-2.5 text-sm rounded-xl
                           backdrop-blur-xl bg-slate-950 text-white border border-gray-700
                           outline-none focus:border-cyan-500
                           focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                           transition-all duration-200"
              >
                <option value="ALL" className="bg-slate-950 text-white">
                  All Sellers
                </option>
                {returnSellerOptions.map((name) => (
                  <option
                    key={name}
                    value={name}
                    className="bg-slate-950 text-white"
                  >
                    {name}
                  </option>
                ))}
              </select>

              {/* Status filter */}
              <select
                value={returnStatus}
                onChange={(e) => setReturnStatus(e.target.value)}
                className="px-4 py-2.5 text-sm rounded-xl
                           backdrop-blur-xl bg-slate-950 text-white border border-gray-700
                           outline-none focus:border-cyan-500
                           focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                           transition-all duration-200"
              >
                <option value="ALL" className="bg-slate-950 text-white">
                  All Statuses
                </option>
                <option value="Re" className="bg-slate-950 text-white">
                  Warehouse (Re)
                </option>
                <option value="EX" className="bg-slate-950 text-white">
                  Exchange (EX)
                </option>
                <option value="RTS" className="bg-slate-950 text-white">
                  Returned to Seller (RTS)
                </option>
              </select>

              {/* Bulk "Returned to seller" button */}
              {selectedOrderIds.length > 0 && (
                <button
                  onClick={handleBulkRTS}
                  disabled={
                    rtsUpdating ||
                    !orders
                      .filter((o) => selectedOrderIds.includes(o.id))
                      .every((o) => ["Re", "EX"].includes(o.financialStatus))
                  }
                  className={`px-4 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 shadow-lg ${
                    orders
                      .filter((o) => selectedOrderIds.includes(o.id))
                      .every((o) => ["Re", "EX"].includes(o.financialStatus))
                      ? "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-500/20"
                      : "bg-gray-700 text-gray-500 cursor-not-allowed"
                  } ${rtsUpdating ? "opacity-50" : ""}`}
                >
                  {rtsUpdating
                    ? "Updating…"
                    : `↩ Returned to Seller (${selectedOrderIds.length})`}
                </button>
              )}
            </div>

            {/* Rows per page dropdown - top right */}
            <div className="flex justify-end mb-3">
              <div className="flex items-center space-x-2">
                <label className="text-xs text-slate-400">Rows per page:</label>
                <select
                  value={
                    [50, 100, 200, 300].includes(returnsItemsPerPage)
                      ? returnsItemsPerPage
                      : "all"
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setReturnsItemsPerPage(
                      val === "all" ? returnsOrders.length : Number(val),
                    );
                    setReturnsPage(1);
                  }}
                  className="bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500 transition-all"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={300}>300</option>
                  <option value="all">All</option>
                </select>
                <span className="text-xs text-gray-500 ml-2">
                  Showing {paginatedReturns.length} of {returnsOrders.length}{" "}
                  return order(s)
                </span>
              </div>
            </div>

            {/* Returns table - flat single list */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg
                  className="animate-spin h-8 w-8 text-cyan-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
            ) : returnsOrders.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-sm">No return orders found.</p>
              </div>
            ) : (
              <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                {/* Action bar */}
                <div className="px-5 py-3 border-b border-white/10 bg-white/[0.03] flex justify-between items-center">
                  <h3 className="text-sm font-bold text-cyan-300 uppercase tracking-wider">
                    All Returns
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      ({returnsOrders.length} order
                      {returnsOrders.length !== 1 ? "s" : ""})
                    </span>
                  </h3>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        if (selectedOrderIds.length === 0) {
                          alert(
                            "Please select at least one return order to include in the RTS manifest.",
                          );
                          return;
                        }
                        window.open(
                          `/print/orders/manifest?ids=${selectedOrderIds.join(",")}`,
                          "_blank",
                        );
                      }}
                      className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all shadow-sm"
                    >
                      Print RTS Manifest
                    </button>
                    <button
                      onClick={() => handleBulkRTS()}
                      disabled={
                        rtsUpdating ||
                        selectedOrderIds.length === 0 ||
                        !returnsOrders
                          .filter((o) => selectedOrderIds.includes(o.id))
                          .every((o) =>
                            ["Re", "EX"].includes(o.financialStatus),
                          )
                      }
                      className={`px-3 py-1.5 text-xs font-bold rounded transition-all shadow-sm ${
                        selectedOrderIds.length > 0 &&
                        returnsOrders
                          .filter((o) => selectedOrderIds.includes(o.id))
                          .every((o) =>
                            ["Re", "EX"].includes(o.financialStatus),
                          )
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30"
                          : "bg-gray-700 text-gray-500 cursor-not-allowed border border-gray-600"
                      } ${rtsUpdating ? "opacity-50" : ""}`}
                    >
                      {rtsUpdating ? "Updating…" : "Returned to Seller"}
                    </button>
                  </div>
                </div>

                {/* Orders table */}
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-max whitespace-nowrap text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-gray-500 text-[11px] uppercase tracking-wider">
                        <th className="px-3 py-2 text-center font-medium w-10">
                          <input
                            type="checkbox"
                            checked={
                              selectedOrderIds.length ===
                                returnsOrders.length && returnsOrders.length > 0
                            }
                            onChange={() => {
                              if (
                                selectedOrderIds.length === returnsOrders.length
                              ) {
                                setSelectedOrderIds((prev) =>
                                  prev.filter(
                                    (id) =>
                                      !returnsOrders.find((o) => o.id === id),
                                  ),
                                );
                              } else {
                                setSelectedOrderIds((prev) => {
                                  const newIds = new Set([...prev]);
                                  returnsOrders.forEach((o) =>
                                    newIds.add(o.id),
                                  );
                                  return Array.from(newIds);
                                });
                              }
                            }}
                            className="w-4 h-4 rounded border-gray-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0 cursor-pointer"
                          />
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Order ID
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Seller
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Customer
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Phone
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Address
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Zone
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Driver
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Status
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Amt $
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Amt LL
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalPages = Math.ceil(
                          returnsOrders.length / returnsItemsPerPage,
                        );
                        const paginatedItems = returnsOrders.slice(
                          (returnsPage - 1) * returnsItemsPerPage,
                          returnsPage * returnsItemsPerPage,
                        );
                        return paginatedItems.map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                          >
                            <td className="px-3 py-1.5 text-center whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={selectedOrderIds.includes(order.id)}
                                onChange={() => toggleSelectOrder(order.id)}
                                className="w-4 h-4 rounded border-gray-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-xs font-mono text-gray-300 whitespace-nowrap">
                              #{order.orderId}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                              {order.merchant?.merchantName ||
                                order.merchant?.ownerFirstName ||
                                "—"}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                              {shortDate(order.createdAt)}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-white whitespace-nowrap">
                              {order.customerName}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                              {order.customerPhone}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-400 max-w-[120px] truncate">
                              {order.customerAddress}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.zone?.name || order.zoneId}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.driver
                                ? `${order.driver.firstName} ${order.driver.lastName}`
                                : "—"}
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full border ${
                                  order.financialStatus === "Re"
                                    ? "text-red-400 bg-red-500/10 border-red-500/30"
                                    : order.financialStatus === "EX"
                                      ? "text-orange-400 bg-orange-500/10 border-orange-500/30"
                                      : "text-purple-400 bg-purple-500/10 border-purple-500/30"
                                }`}
                                title={
                                  order.financialStatus === "Re"
                                    ? "Returned (at warehouse)"
                                    : order.financialStatus === "EX"
                                      ? "Exchange (at warehouse)"
                                      : "Returned to Seller"
                                }
                              >
                                {order.financialStatus === "Re"
                                  ? "Re"
                                  : order.financialStatus === "EX"
                                    ? "EX"
                                    : "RTS"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
                              ${order.amountUsd.toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
                              {order.amountLbp.toLocaleString()}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Global pagination */}
                {(() => {
                  const totalPages = Math.ceil(
                    returnsOrders.length / returnsItemsPerPage,
                  );
                  if (totalPages <= 1) return null;
                  return (
                    <div className="flex items-center justify-between px-5 py-2 border-t border-white/5">
                      <p className="text-xs text-gray-500">
                        Showing {(returnsPage - 1) * returnsItemsPerPage + 1}–
                        {Math.min(
                          returnsPage * returnsItemsPerPage,
                          returnsOrders.length,
                        )}{" "}
                        of {returnsOrders.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            setReturnsPage(Math.max(1, returnsPage - 1))
                          }
                          disabled={returnsPage === 1}
                          className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Prev
                        </button>
                        {(() => {
                          const pages: number[] = [];
                          if (returnsPage > 1) pages.push(returnsPage - 1);
                          pages.push(returnsPage);
                          if (returnsPage < totalPages)
                            pages.push(returnsPage + 1);
                          const sorted = [
                            ...new Set([1, totalPages, ...pages]),
                          ].sort((a, b) => a - b);
                          return sorted.map((page) => (
                            <button
                              key={page}
                              onClick={() => setReturnsPage(page)}
                              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                                returnsPage === page
                                  ? "bg-cyan-600 border-cyan-500 text-white"
                                  : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                              }`}
                            >
                              {page}
                            </button>
                          ));
                        })()}
                        <button
                          onClick={() =>
                            setReturnsPage(
                              Math.min(totalPages, returnsPage + 1),
                            )
                          }
                          disabled={returnsPage === totalPages}
                          className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════ */}
        {/* RWD (Return With Driver) TAB             */}
        {/* ════════════════════════════════════════ */}
        {currentTab === "rwd" && (
          <>
            {/* Bulk action bar */}
            {selectedOrderIds.length > 0 && (
              <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-sm text-amber-300">
                  {selectedOrderIds.length} order(s) selected
                </span>
                <button
                  onClick={handleBulkRWDToWarehouse}
                  disabled={rwdUpdating}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    rwdUpdating
                      ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
                  } ${rwdUpdating ? "opacity-50" : ""}`}
                >
                  {rwdUpdating ? "Moving…" : "Move to returns warehouse"}
                </button>
                <button
                  onClick={() => setSelectedOrderIds([])}
                  className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Clear
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
                </div>
              </div>
            ) : rwdOrders.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                No orders with driver to return.
              </div>
            ) : (
              <div>
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-max whitespace-nowrap text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-gray-500 text-[11px] uppercase tracking-wider">
                        <th className="px-3 py-2 text-center font-medium w-10">
                          <input
                            type="checkbox"
                            checked={
                              rwdOrders.length > 0 &&
                              selectedOrderIds.length === rwdOrders.length
                            }
                            onChange={() => {
                              if (
                                selectedOrderIds.length === rwdOrders.length
                              ) {
                                setSelectedOrderIds((prev) => {
                                  const rwdIds = new Set(
                                    rwdOrders.map((o) => o.id),
                                  );
                                  return prev.filter((id) => !rwdIds.has(id));
                                });
                              } else {
                                setSelectedOrderIds((prev) => {
                                  const existing = new Set(prev);
                                  rwdOrders.forEach((o) => existing.add(o.id));
                                  return Array.from(existing);
                                });
                              }
                            }}
                            className="rounded border-gray-600 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
                          />
                        </th>
                        <th className="px-3 py-2 text-left font-medium">ID</th>
                        <th className="px-3 py-2 text-left font-medium">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Seller
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Customer
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Zone
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Driver
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Amount
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const indexed = rwdOrders.map((o, i) => ({
                          order: o,
                          index: i,
                        }));
                        const startIndex =
                          rwdPage * rwdItemsPerPage - rwdItemsPerPage;
                        const endIndex = rwdPage * rwdItemsPerPage;
                        const paginatedItems = indexed
                          .slice(startIndex, endIndex)
                          .map((item) => item.order);

                        return paginatedItems.map((order) => (
                          <tr
                            key={order.id}
                            className={`border-b border-white/5 transition-colors ${
                              selectedOrderIds.includes(order.id)
                                ? "bg-cyan-500/10"
                                : "hover:bg-white/[0.02]"
                            }`}
                          >
                            <td className="px-3 py-1.5 text-center whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={selectedOrderIds.includes(order.id)}
                                onChange={() => toggleSelectOrder(order.id)}
                                className="rounded border-gray-600 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                              {order.orderId}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {shortDate(order.createdAt)}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.merchant?.ownerFirstName ||
                                order.merchant?.merchantName ||
                                "—"}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.customerName || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.zone?.name || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.driver?.firstName || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap">
                              {order.amountUsd ? `$${order.amountUsd}` : ""}
                              {order.amountUsd && order.amountLbp ? " / " : ""}
                              {order.amountLbp
                                ? `${Number(order.amountLbp).toLocaleString()} LBP`
                                : ""}
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                RWD
                              </span>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {(() => {
                  const totalPages = Math.ceil(
                    rwdOrders.length / rwdItemsPerPage,
                  );
                  if (totalPages <= 1) return null;
                  return (
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>Per page:</span>
                        <select
                          value={rwdItemsPerPage}
                          onChange={(e) => {
                            setRwdItemsPerPage(Number(e.target.value));
                            setRwdPage(1);
                          }}
                          className="rounded border border-white/10 bg-white/5 text-gray-300 px-2 py-1 text-xs"
                        >
                          {[25, 50, 100, 200].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setRwdPage((p) => Math.max(1, p - 1))}
                          disabled={rwdPage === 1}
                          className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Prev
                        </button>
                        <span className="text-xs text-gray-400">
                          Page {rwdPage} of {totalPages}
                        </span>
                        <button
                          onClick={() =>
                            setRwdPage((p) => Math.min(totalPages, p + 1))
                          }
                          disabled={rwdPage === totalPages}
                          className="px-3 py-1 text-xs rounded border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════ */}
        {/* NOTES MODAL (glassmorphism)             */}
        {/* ════════════════════════════════════════ */}
        {notesModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl 
                         border border-white/20 shadow-[0_0_40px_rgba(6,182,212,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">Order Notes</h2>
              <p className="text-xs text-gray-400 mb-5">
                #{notesModal.orderId} &mdash; {notesModal.customerName}
              </p>

              {/* Checkboxes */}
              <div className="space-y-3 mb-5">
                {NOTES_OPTIONS.map((note) => (
                  <label
                    key={note}
                    className="flex items-center gap-3 cursor-pointer group"
                  >
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center
                                  transition-all duration-200
                                  ${
                                    selectedNotes.includes(note)
                                      ? "bg-cyan-500 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                                      : "border-gray-600 group-hover:border-gray-500"
                                  }`}
                    >
                      {selectedNotes.includes(note) && (
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
                      checked={selectedNotes.includes(note)}
                      onChange={() => toggleNote(note)}
                      className="sr-only"
                    />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                      {note}
                    </span>
                  </label>
                ))}
              </div>

              {/* Custom input */}
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Custom Note
              </label>
              <input
                type="text"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="Type a custom note..."
                className="w-full px-4 py-2.5 text-sm rounded-xl 
                           bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-cyan-500/50 
                           focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                           transition-all duration-200 mb-6"
              />

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setNotesModal(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitNotes}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                             hover:bg-cyan-500/30 hover:shadow-[0_0_16px_rgba(6,182,212,0.3)]
                             transition-all duration-200"
                >
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* SELLER MODAL (glassmorphism)            */}
        {/* ════════════════════════════════════════ */}
        {sellerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl 
                         border border-white/20 shadow-[0_0_40px_rgba(245,158,11,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                Change Seller
              </h2>
              <p className="text-xs text-gray-400 mb-5">
                #{sellerModal.orderId} &mdash; {sellerModal.customerName}
              </p>

              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Merchant ID
              </label>
              <input
                type="text"
                value={newMerchantId}
                onChange={(e) => setNewMerchantId(e.target.value)}
                placeholder="Enter merchant user ID..."
                className="w-full px-4 py-2.5 text-sm rounded-xl 
                           bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-amber-500/50 
                           focus:shadow-[0_0_12px_rgba(245,158,11,0.15)]
                           transition-all duration-200 mb-6"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setSellerModal(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitSeller}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-amber-500/20 text-amber-300 border border-amber-500/30
                             hover:bg-amber-500/30 hover:shadow-[0_0_16px_rgba(245,158,11,0.3)]
                             transition-all duration-200"
                >
                  Update Seller
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* EDIT ORDER MODAL (glassmorphism)         */}
        {/* ════════════════════════════════════════ */}
        {editModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(59,130,246,0.2)]
                         p-6 sm:p-8 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">Edit Order</h2>
              <p className="text-xs text-gray-400 mb-5">
                #{editModal.orderId} &mdash; {editModal.customerName}
              </p>

              <div className="space-y-4">
                {/* Customer Name */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={editFormData.customerName}
                    onChange={(e) =>
                      setEditFormData((p) => ({
                        ...p,
                        customerName: e.target.value,
                      }))
                    }
                    className="w-full px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-all duration-200"
                  />
                </div>

                {/* Customer Phone */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Customer Phone
                  </label>
                  <input
                    type="text"
                    value={editFormData.customerPhone}
                    onChange={(e) =>
                      setEditFormData((p) => ({
                        ...p,
                        customerPhone: e.target.value,
                      }))
                    }
                    className="w-full px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-all duration-200"
                  />
                </div>

                {/* Customer Address */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Customer Address
                  </label>
                  <input
                    type="text"
                    value={editFormData.customerAddress}
                    onChange={(e) =>
                      setEditFormData((p) => ({
                        ...p,
                        customerAddress: e.target.value,
                      }))
                    }
                    className="w-full px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-all duration-200"
                  />
                </div>

                {/* Zone */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Zone
                  </label>
                  <select
                    value={editFormData.zoneId}
                    onChange={(e) =>
                      setEditFormData((p) => ({ ...p, zoneId: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 text-sm rounded-xl bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 transition-all duration-200"
                  >
                    <option
                      value=""
                      disabled
                      className="bg-slate-950 text-white"
                    >
                      Select a zone...
                    </option>
                    {zones.map((z) => (
                      <option
                        key={z.id}
                        value={z.id}
                        className="bg-slate-950 text-white"
                      >
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Financial fields — ORDERS_FINANCIAL only (ADMIN bypasses) */}
                {userHasPermission("ORDERS_FINANCIAL") && (
                  <>
                    {/* Amount $ */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Amount $
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFormData.amountUsd}
                        onChange={(e) =>
                          setEditFormData((p) => ({
                            ...p,
                            amountUsd: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-all duration-200"
                      />
                    </div>

                    {/* Amount LL */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Amount LL
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={editFormData.amountLbp}
                        onChange={(e) =>
                          setEditFormData((p) => ({
                            ...p,
                            amountLbp: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-all duration-200"
                      />
                    </div>

                    {/* Extra Shipping */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Extra Shipping
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFormData.extraShipping}
                        onChange={(e) =>
                          setEditFormData((p) => ({
                            ...p,
                            extraShipping: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-all duration-200"
                      />
                    </div>
                  </>
                )}

                {/* Has Exchange */}
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                      editFormData.hasExchange
                        ? "bg-cyan-500 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                        : "border-gray-600 group-hover:border-gray-500"
                    }`}
                  >
                    {editFormData.hasExchange && (
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
                    checked={editFormData.hasExchange}
                    onChange={(e) =>
                      setEditFormData((p) => ({
                        ...p,
                        hasExchange: e.target.checked,
                      }))
                    }
                    className="sr-only"
                  />
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                    Has Exchange
                  </span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setEditModal(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl bg-white/5 text-gray-400 border border-white/10 hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitEdit}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 hover:shadow-[0_0_16px_rgba(59,130,246,0.3)] transition-all duration-200"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* ASSIGN DRIVER MODAL (glassmorphism)      */}
        {/* ════════════════════════════════════════ */}
        {driverModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(14,165,233,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                {driverModal.driverId ? "Change Driver" : "Assign Driver"}
              </h2>
              <p className="text-xs text-gray-400 mb-5">
                #{driverModal.orderId} &mdash; {driverModal.customerName}
              </p>

              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Select Driver
              </label>
              <select
                value={newDriverId}
                onChange={(e) => setNewDriverId(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl
                           bg-slate-950 text-white border border-gray-700
                           outline-none focus:border-cyan-500
                           focus:shadow-[0_0_12px_rgba(14,165,233,0.15)]
                           transition-all duration-200 mb-6 appearance-none cursor-pointer"
              >
                <option value="" className="bg-slate-950 text-white">
                  -- Select a driver --
                </option>
                {availableDrivers.map((driver: any) => (
                  <option
                    key={driver.id}
                    value={driver.id}
                    className="bg-slate-950 text-white"
                  >
                    {driver.firstName} {driver.lastName} (
                    {driver.driverId ||
                      driver.user?.username ||
                      driver.username}
                    )
                  </option>
                ))}
              </select>

              <div className="flex gap-3">
                <button
                  onClick={() => setDriverModal(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDriver}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-sky-500/20 text-sky-300 border border-sky-500/30
                             hover:bg-sky-500/30 hover:shadow-[0_0_16px_rgba(14,165,233,0.3)]
                             transition-all duration-200"
                >
                  {driverModal.driverId ? "Update Driver" : "Assign"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* REVERT MODAL (glassmorphism)             */}
        {/* ════════════════════════════════════════ */}
        {revertModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-sm backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(255,165,0,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                Revert Status
              </h2>
              <p className="text-xs text-gray-400 mb-5">
                #{revertModal.orderId} &mdash; {revertModal.customerName}
              </p>

              <p className="text-sm text-gray-300 mb-4">
                Select the status to revert to:
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => handleRevert(revertModal.id, "WAREHOUSE")}
                  className="w-full px-4 py-3 text-sm font-semibold rounded-xl
                             bg-yellow-500/10 text-yellow-400 border border-yellow-500/30
                             hover:bg-yellow-500/20 hover:shadow-[0_0_12px_rgba(234,179,8,0.3)]
                             transition-all duration-200"
                >
                  Back to Warehouse
                </button>
                <button
                  onClick={() => handleRevert(revertModal.id, "WITH_DRIVER")}
                  className="w-full px-4 py-3 text-sm font-semibold rounded-xl
                             bg-cyan-500/10 text-cyan-400 border border-cyan-500/30
                             hover:bg-cyan-500/20 hover:shadow-[0_0_12px_rgba(6,182,212,0.3)]
                             transition-all duration-200"
                >
                  Back to Driver
                </button>
              </div>

              <button
                onClick={() => setRevertModal(null)}
                className="w-full mt-4 px-4 py-2.5 text-sm font-semibold rounded-xl
                           bg-white/5 text-gray-400 border border-white/10
                           hover:text-white hover:bg-white/10 transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* CUSTOM PAYMENT MODAL (glassmorphism)      */}
        {/* ════════════════════════════════════════ */}
        {customPayModalOpen && customPayOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(245,158,11,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                Custom Delivery Collection
              </h2>
              <p className="text-xs text-gray-400 mb-5">
                #{customPayOrder.orderId} &mdash; {customPayOrder.customerName}
              </p>

              <div className="space-y-4 mb-6">
                {/* Collected Amount (USD) */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Collected Amount (USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={customUsd}
                    onChange={(e) => setCustomUsd(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 text-sm rounded-xl
                               bg-white/5 border border-white/10 text-white placeholder-gray-500
                               focus:outline-none focus:border-amber-500/50
                               focus:shadow-[0_0_12px_rgba(245,158,11,0.15)]
                               transition-all duration-200"
                  />
                </div>

                {/* Collected Amount (L.L) */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Collected Amount (L.L)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={customLbp}
                    onChange={(e) => setCustomLbp(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-2.5 text-sm rounded-xl
                               bg-white/5 border border-white/10 text-white placeholder-gray-500
                               focus:outline-none focus:border-amber-500/50
                               focus:shadow-[0_0_12px_rgba(245,158,11,0.15)]
                               transition-all duration-200"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setCustomPayModalOpen(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await updateOrder(customPayOrder.id, {
                      location: "DELIVERED",
                      financialStatus: "WD",
                      collectedUsd: parseFloat(customUsd) || 0,
                      collectedLbp: parseFloat(customLbp) || 0,
                    });
                    setCustomPayModalOpen(false);
                    setCustomPayOrder(null);
                    setCustomUsd("");
                    setCustomLbp("");
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-amber-500/20 text-amber-300 border border-amber-500/30
                             hover:bg-amber-500/30 hover:shadow-[0_0_16px_rgba(245,158,11,0.3)]
                             transition-all duration-200"
                >
                  Submit Custom Payment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* EXCEL COLUMN SELECTOR MODAL (glassmorphism) */}
        {/* ════════════════════════════════════════ */}
        {excelModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

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
                  {EXPORT_COLUMNS.length} columns selected
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExcelCols(
                        Object.fromEntries(
                          EXPORT_COLUMNS.map((c) => [c.key, true]),
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
                          EXPORT_COLUMNS.map((c) => [c.key, false]),
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
                {EXPORT_COLUMNS.map((col) => {
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
                  onClick={async () => {
                    const ExcelJS = (await import("exceljs")).default;
                    const workbook = new ExcelJS.Workbook();
                    const worksheet = workbook.addWorksheet("Orders");

                    // Build columns dynamically based on selected excelCols
                    const cols: any[] = [];
                    const selectedDefs = EXPORT_COLUMNS.filter(
                      (c) => excelCols[c.key],
                    );
                    selectedDefs.forEach((c) => {
                      cols.push({
                        header: c.header,
                        key: c.key,
                        width: c.width,
                      });
                    });
                    worksheet.columns = cols;

                    // Add Rows & Format
                    const exportData = orders.filter((o) =>
                      selectedOrderIds.includes(o.id),
                    );
                    exportData.forEach((order) => {
                      const row: Record<string, string | number> = {};
                      selectedDefs.forEach((c) => {
                        row[c.key] = c.value(order);
                      });
                      worksheet.addRow(row);
                    });

                    // Apply borders and centering to all cells
                    worksheet.eachRow((row, rowNumber) => {
                      row.eachCell((cell) => {
                        cell.alignment = {
                          vertical: "middle",
                          horizontal: "center",
                        };
                        cell.border = {
                          top: { style: "thin" },
                          left: { style: "thin" },
                          bottom: { style: "thin" },
                          right: { style: "thin" },
                        };
                        if (rowNumber === 1) cell.font = { bold: true };
                      });
                    });

                    const buffer = await workbook.xlsx.writeBuffer();
                    const blob = new Blob([buffer], {
                      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = "Orders_Export.xlsx";
                    link.click();

                    setExcelModalOpen(false);
                  }}
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

        {/* ════════════════════════════════════════ */}
        {/* SELLER CORRECTION MODAL (glassmorphism)    */}
        {/* ════════════════════════════════════════ */}
        {correctionModalOpen && correctionOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(245,158,11,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                Seller Correction
              </h2>
              <p className="text-xs text-gray-400 mb-5">
                #{correctionOrder.orderId} &mdash;{" "}
                {correctionOrder.customerName}
              </p>

              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Select Correct Seller
              </label>
              <select
                value={selectedNewMerchantId}
                onChange={(e) => setSelectedNewMerchantId(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl
                           bg-slate-950 text-white border border-gray-700
                           outline-none focus:border-cyan-500
                           focus:shadow-[0_0_12px_rgba(245,158,11,0.15)]
                           transition-all duration-200 mb-6 appearance-none cursor-pointer"
              >
                <option value="" className="bg-slate-950 text-white">
                  -- Select a seller --
                </option>
                {merchants.map((m: any) => (
                  <option
                    key={m.id}
                    value={m.id}
                    className="bg-slate-950 text-white"
                  >
                    {m.merchantName || `${m.ownerFirstName} ${m.ownerLastName}`}
                  </option>
                ))}
              </select>

              <div className="flex gap-3">
                <button
                  onClick={() => setCorrectionModalOpen(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!selectedNewMerchantId) {
                      alert("Please select a seller.");
                      return;
                    }
                    try {
                      const res = await fetch("/api/orders/correction", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          orderId: correctionOrder.id,
                          newMerchantId: selectedNewMerchantId,
                          adminUserId: currentUser?.id,
                        }),
                      });
                      if (res.ok) {
                        alert("Correction executed successfully.");
                        setCorrectionModalOpen(false);
                        setCorrectionOrder(null);
                        setSelectedNewMerchantId("");
                        fetchOrders();
                      } else {
                        const err = await res.json();
                        alert(err.error || "Correction failed.");
                      }
                    } catch (err) {
                      console.error("Correction error", err);
                      alert("Correction failed.");
                    }
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-amber-500/20 text-amber-300 border border-amber-500/30
                             hover:bg-amber-500/30 hover:shadow-[0_0_16px_rgba(245,158,11,0.3)]
                             transition-all duration-200"
                >
                  Execute Correction
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* CREATE ORDER MODAL (glassmorphism)        */}
        {/* ════════════════════════════════════════ */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal — wider for two-column layout */}
            <div
              className="relative w-full max-w-3xl backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(6,182,212,0.2)]
                         p-6 sm:p-8 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">New Order</h2>
              <p className="text-xs text-gray-400 mb-5">
                Fill in the details below to create a new order.
              </p>

              <form onSubmit={handleCreateOrder}>
                <div className="grid grid-cols-2 gap-4">
                  {/* ────── LEFT COLUMN ────── */}
                  <div className="space-y-4">
                    {/* Order Id */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Order Id
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.orderId}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            orderId: e.target.value,
                          }))
                        }
                        placeholder="e.g. ORD-001"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Seller (searchable datalist) */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Seller
                      </label>
                      <input
                        type="text"
                        list="seller-options"
                        value={formData.merchantId}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            merchantId: e.target.value,
                          }))
                        }
                        placeholder="Type seller name or paste ID..."
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Customer */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Customer
                      </label>
                      <input
                        type="text"
                        value={formData.customerName}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            customerName: e.target.value,
                          }))
                        }
                        placeholder="John Doe"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Tel Number */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Tel Number
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.customerPhone}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            customerPhone: e.target.value,
                          }))
                        }
                        placeholder="+1 (555) 123-4567"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Address */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Address
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.customerAddress}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            customerAddress: e.target.value,
                          }))
                        }
                        placeholder="123 Main St, City"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Exch (Checkbox) */}
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center
                                    transition-all duration-200
                                    ${
                                      formData.hasExchange
                                        ? "bg-cyan-500 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                                        : "border-gray-600 group-hover:border-gray-500"
                                    }`}
                      >
                        {formData.hasExchange && (
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
                        checked={formData.hasExchange}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            hasExchange: e.target.checked,
                          }))
                        }
                        className="sr-only"
                      />
                      <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                        Exch
                      </span>
                    </label>
                  </div>

                  {/* ────── RIGHT COLUMN ────── */}
                  <div className="space-y-4">
                    {/* Amount$ */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Amount$
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={formData.price}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            price: e.target.value,
                          }))
                        }
                        placeholder="0.00"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Amt LL */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Amt LL
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={formData.amountLbp}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            amountLbp: e.target.value,
                          }))
                        }
                        placeholder="0"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Ex Shipping */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Ex Shipping
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.extraShipping}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            extraShipping: e.target.value,
                          }))
                        }
                        placeholder="0.00"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Location (Disabled dropdown defaulting to Warehouse) */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Location
                      </label>
                      <select
                        disabled
                        value="WAREHOUSE"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-slate-950 text-white border border-gray-700
                                   outline-none focus:border-cyan-500
                                   cursor-not-allowed opacity-60 transition-all duration-200"
                      >
                        <option
                          value="WAREHOUSE"
                          className="bg-slate-950 text-white"
                        >
                          Warehouse
                        </option>
                      </select>
                    </div>

                    {/* Zone (text input — reverse-looked up by name) */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Zone
                      </label>
                      <input
                        type="text"
                        required
                        value={zoneInput}
                        onChange={(e) => setZoneInput(e.target.value)}
                        placeholder="Type zone name..."
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Pckgs (Number input) */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Pckgs
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formData.packages}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            packages: e.target.value,
                          }))
                        }
                        placeholder="1"
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200"
                      />
                    </div>

                    {/* Notes (Textarea) */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Notes
                      </label>
                      <textarea
                        value={formData.notes}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            notes: e.target.value,
                          }))
                        }
                        placeholder="Optional notes..."
                        rows={2}
                        className="w-full px-4 py-2.5 text-sm rounded-xl
                                   bg-white/5 border border-white/10 text-white placeholder-gray-500
                                   focus:outline-none focus:border-cyan-500/50
                                   focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]
                                   transition-all duration-200 resize-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Actions — full width below grid */}
                <div className="flex gap-3 pt-4 mt-4 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                               bg-white/5 text-gray-400 border border-white/10
                               hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                               bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                               hover:bg-cyan-500/30 hover:shadow-[0_0_16px_rgba(6,182,212,0.3)]
                               disabled:opacity-50 disabled:cursor-not-allowed
                               transition-all duration-200"
                  >
                    {submitting ? "Creating..." : "Create Order"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* QUICK ASSIGN MODAL (type IDs + driver)   */}
        {/* ════════════════════════════════════════ */}
        {quickAssignModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => {
                setQuickAssignModalOpen(false);
                setQuickAssignOrderIdsText("");
                setQuickAssignDriverId("");
              }}
            />

            {/* Modal */}
            <div
              className="relative w-full max-w-lg backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(16,185,129,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                ⚡ Quick Assign Orders
              </h2>
              <p className="text-xs text-gray-400 mb-6">
                Enter order IDs (one per line) and select a driver to assign
                them to.
              </p>

              {/* Order IDs textarea */}
              <div className="mb-5">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Order IDs (one per line)
                </label>
                <textarea
                  value={quickAssignOrderIdsText}
                  onChange={(e) => setQuickAssignOrderIdsText(e.target.value)}
                  placeholder={"10049805\n10049806\n10049810"}
                  rows={6}
                  className="w-full px-4 py-2.5 text-sm rounded-xl
                             bg-white/5 border border-white/10 text-white placeholder-gray-500
                             focus:outline-none focus:border-emerald-500/50
                             focus:shadow-[0_0_12px_rgba(16,185,129,0.15)]
                             transition-all duration-200 resize-y font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Supports order IDs, UUIDs, or tracking numbers — one per line.
                </p>
              </div>

              {/* Driver selector */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Assign to Driver
                </label>
                <select
                  value={quickAssignDriverId}
                  onChange={(e) => setQuickAssignDriverId(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm rounded-xl
                             bg-white/5 border border-white/10 text-white
                             focus:outline-none focus:border-emerald-500/50
                             focus:shadow-[0_0_12px_rgba(16,185,129,0.15)]
                             transition-all duration-200"
                >
                  <option value="" className="bg-slate-900 text-gray-400">
                    -- Select a driver --
                  </option>
                  {availableDrivers.map((driver: any) => (
                    <option
                      key={driver.id}
                      value={driver.id}
                      className="bg-slate-900 text-white"
                    >
                      {driver.firstName} {driver.lastName} ({driver.driverId})
                    </option>
                  ))}
                </select>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setQuickAssignModalOpen(false);
                    setQuickAssignOrderIdsText("");
                    setQuickAssignDriverId("");
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleQuickAssign}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-emerald-500/20 text-emerald-300 border border-emerald-500/30
                             hover:bg-emerald-500/30 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)]
                             transition-all duration-200"
                >
                  Submit Assignment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* BULK ASSIGN MODAL (glassmorphism)         */}
        {/* ════════════════════════════════════════ */}
        {assignModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(14,165,233,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                Assign Orders to Driver
              </h2>
              <p className="text-xs text-gray-400 mb-6">
                You are assigning{" "}
                <span className="text-cyan-400 font-semibold">
                  {selectedOrderIds.length}
                </span>{" "}
                order(s) to a driver.
              </p>

              <div className="mb-6">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Select Driver
                </label>
                <input
                  type="text"
                  list="bulk-driver-list"
                  value={driverSearchTerm}
                  onChange={(e) => setDriverSearchTerm(e.target.value)}
                  placeholder="Search by name or ID..."
                  className="w-full px-4 py-2.5 text-sm rounded-xl
                             bg-white/5 border border-white/10 text-white placeholder-gray-500
                             focus:outline-none focus:border-sky-500/50
                             focus:shadow-[0_0_12px_rgba(14,165,233,0.15)]
                             transition-all duration-200"
                />
                <datalist id="bulk-driver-list">
                  {availableDrivers.map((driver: any) => (
                    <option
                      key={driver.id}
                      value={`${driver.firstName} ${driver.lastName} (${driver.driverId})`}
                    />
                  ))}
                </datalist>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setAssignModalOpen(false);
                    setDriverSearchTerm("");
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkAssign}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-sky-500/20 text-sky-300 border border-sky-500/30
                             hover:bg-sky-500/30 hover:shadow-[0_0_16px_rgba(14,165,233,0.3)]
                             transition-all duration-200"
                >
                  Confirm Assignment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* CHANGE SELLER MODAL (bulk)               */}
        {/* ════════════════════════════════════════ */}
        {isSellerModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative w-full max-w-md backdrop-blur-2xl bg-white/10 rounded-3xl
                         border border-white/20 shadow-[0_0_40px_rgba(245,158,11,0.2)]
                         p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">
                Change Seller
              </h2>
              <p className="text-xs text-gray-400 mb-6">
                Updating seller for{" "}
                <span className="text-amber-400 font-semibold">
                  {selectedOrderIds.length}
                </span>{" "}
                order(s).
              </p>

              <div className="flex flex-col gap-2 mb-6">
                <label className="text-sm text-gray-400 font-mono">
                  Assign New Seller
                </label>
                <input
                  list="seller-options"
                  value={newSellerInput}
                  onChange={(e) => setNewSellerInput(e.target.value)}
                  placeholder="Search name or paste ID..."
                  className="bg-slate-900 border border-gray-700 text-white rounded px-4 py-2 outline-none focus:border-cyan-500 w-full"
                />
                <datalist id="seller-options">
                  {sellersList.map((s: any) => (
                    <option key={s.id} value={`${s.numericId} - ${s.name}`} />
                  ))}
                </datalist>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsSellerModalOpen(false);
                    setNewSellerInput("");
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl
                             bg-white/5 text-gray-400 border border-white/10
                             hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!newSellerInput) return;

                    let finalSellerId = newSellerInput;

                    const matchedSeller = sellersList.find(
                      (s: any) =>
                        s.numericId?.toString() === newSellerInput ||
                        s.name?.toLowerCase() ===
                          newSellerInput.toLowerCase() ||
                        `${s.numericId} - ${s.name}` === newSellerInput,
                    );

                    if (matchedSeller) {
                      finalSellerId = matchedSeller.id;
                    } else {
                      alert(
                        `Seller "${newSellerInput}" not found in database. Please select from the dropdown or type their exact name (e.g., Tloba).`,
                      );
                      return;
                    }

                    try {
                      const targets = sellerModal
                        ? [sellerModal.id]
                        : selectedOrderIds;

                      if (targets.length === 0) {
                        alert("No target orders selected for updates.");
                        return;
                      }

                      const results = await Promise.all(
                        targets.map((id) =>
                          patchOrder(id, { merchantId: finalSellerId }),
                        ),
                      );

                      if (results.includes(false)) {
                        alert(
                          "Database rejected the update. Please check server logs.",
                        );
                        return;
                      }

                      setIsSellerModalOpen(false);
                      setSellerModal(null);
                      setNewSellerInput("");
                      setSelectedOrderIds([]);
                      alert("Seller successfully updated.");
                    } catch (error) {
                      console.error("Failed to update seller", error);
                      alert("Error updating seller.");
                    }
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow transition"
                >
                  Confirm Change
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* GLOBAL GOOGLE SHEETS IMPORT MODAL        */}
        {/* ════════════════════════════════════════ */}
        {globalSheetModalOpen && (
          <GlobalSheetImportModal
            onSuccess={() => {
              router.refresh();
            }}
            onClose={() => setGlobalSheetModalOpen(false)}
          />
        )}

        {/* ════════════════════════════════════════ */}
        {/* ORDER HISTORY MODAL                      */}
        {/* ════════════════════════════════════════ */}
        {historyModalOrder && (
          <OrderHistoryModal
            orderId={historyModalOrder.id}
            initialHistory={historyModalOrder.history}
            payoutReference={historyModalOrder.payoutReference}
            onClose={() => setHistoryModalOrder(null)}
          />
        )}

        {/* ════════════════════════════════════════ */}
        {/* SCAN-TO-ASSIGN SLIDE-OVER                */}
        {/* ════════════════════════════════════════ */}
        {scannedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => {
                setScannedOrder(null);
                setScannedAssignDriverId("");
              }}
            />
            <div className="relative z-10 w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-1">
                Assign Order to Driver
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Scanned via barcode scanner
              </p>

              {/* Order summary */}
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 mb-4 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Order ID</span>
                  <span className="text-cyan-400 font-mono font-semibold">
                    {scannedOrder.orderId}
                  </span>
                </div>
                {scannedOrder.driver && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Current Driver</span>
                    <span className="text-yellow-400">
                      {scannedOrder.driver.firstName}{" "}
                      {scannedOrder.driver.lastName}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status</span>
                  <span className="text-gray-300">
                    {scannedOrder.location} / {scannedOrder.financialStatus}
                  </span>
                </div>
              </div>

              {/* Warning for WD/WO orders */}
              {["WD", "WO"].includes(scannedOrder.financialStatus) && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
                  This order is already delivered or paid out and cannot be
                  reassigned.
                </div>
              )}

              {/* Driver dropdown */}
              {!["WD", "WO"].includes(scannedOrder.financialStatus) && (
                <>
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                    Select Driver
                  </label>
                  <select
                    value={scannedAssignDriverId}
                    onChange={(e) => setScannedAssignDriverId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500/50 transition-colors mb-4"
                  >
                    <option value="">— Choose a driver —</option>
                    {availableDrivers.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.firstName} {d.lastName} ({d.driverId})
                      </option>
                    ))}
                  </select>
                </>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setScannedOrder(null);
                    setScannedAssignDriverId("");
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                             bg-white/5 text-gray-400 border border-white/10
                             hover:bg-white/10 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                {!["WD", "WO"].includes(scannedOrder.financialStatus) && (
                  <button
                    onClick={handleScanAssign}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                               bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                               hover:bg-cyan-500/30 hover:shadow-[0_0_12px_rgba(6,182,212,0.3)]
                               transition-all duration-200"
                  >
                    Assign Driver
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* SCAN ERROR TOAST                       */}
        {/* ════════════════════════════════════════ */}
        {scanError && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-red-500/90 backdrop-blur border border-red-400/30 rounded-xl text-white text-sm font-medium shadow-lg max-w-sm text-center">
            {scanError}
            <button
              onClick={() => setScanError(null)}
              className="ml-3 text-red-200 hover:text-white underline text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════ */}
        {/* BARCODE SCANNER MODAL                  */}
        {/* ════════════════════════════════════════ */}
        <BarcodeScannerModal
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScanSuccess={handleScanOrder}
          heading="Scan Order Barcode / QR"
        />
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      }
    >
      <OrdersPageInner />
    </Suspense>
  );
}

// ─── Summary Card Sub-component ───────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "cyan" | "green" | "red" | "purple";
}) {
  const glowMap: Record<string, string> = {
    cyan: "shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] border-cyan-500/30",
    green:
      "shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] border-green-500/30",
    red: "shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:shadow-[0_0_30px_rgba(239,68,68,0.5)] border-red-500/30",
    purple:
      "shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)] border-purple-500/30",
  };

  const accentMap: Record<string, string> = {
    cyan: "from-cyan-400 to-cyan-600",
    green: "from-green-400 to-green-600",
    red: "from-red-400 to-red-600",
    purple: "from-purple-400 to-purple-600",
  };

  return (
    <div
      className={`backdrop-blur-xl bg-white/5 rounded-2xl border p-5 
                  transition-all duration-300 group cursor-default
                  ${glowMap[color]}`}
    >
      <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-2">
        {label}
      </p>
      <p className="text-2xl sm:text-3xl font-extrabold text-white mb-1">
        {value}
      </p>
      <div
        className={`mt-3 h-0.5 rounded-full bg-gradient-to-r ${accentMap[color]} opacity-60 group-hover:opacity-100 transition-opacity duration-300`}
      />
    </div>
  );
}
