"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import SharedOrderTable, {
  formatDDMMYYYY,
} from "@/components/SharedOrderTable";
import GlobalSheetImportModal from "@/components/orders/GlobalSheetImportModal";
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
}

type Tab = "all" | "warehouse" | "reports" | "order-entry" | "returns";

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  WITH_DRIVER: "With Driver",
  DELIVERED: "Delivered",
  RETURN: "Returned",
  Re: "Returned",
  RTS: "Returned to Seller",
};

const LOCATION_COLORS: Record<string, string> = {
  WAREHOUSE: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  WITH_DRIVER: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  DELIVERED: "text-green-400 bg-green-500/10 border-green-500/30",
  RETURN: "text-red-400 bg-red-500/10 border-red-500/30",
  Re: "text-red-400 bg-red-500/10 border-red-500/30",
  RTS: "text-purple-400 bg-purple-500/10 border-purple-500/30",
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
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    username: string;
    role: string;
    permissions: string[];
  } | null>(null);

  // ── Expandable history ──
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );

  // ── Filters ──
  const [searchTerm, setSearchTerm] = useState("");
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
  const [excelCols, setExcelCols] = useState({
    orderId: true,
    date: true,
    seller: true,
    customer: true,
    phone: true,
    address: true,
    city: true,
    usd: true,
    lbp: true,
  });

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

    if (!window.confirm("Process this CSV file and generate bulk orders?")) {
      e.target.value = "";
      return;
    }

    setCsvUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (lines.length < 2)
          throw new Error("CSV is empty or missing headers.");

        let successCount = 0;

        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(",");
          if (row.length < 8) continue; // Skip incomplete rows

          const [orderId, seller, customer, phone, address, zone, usd, lbp] =
            row.map((v) => v.trim());

          // Automatically Resolve Seller ID using the same logic as the forms
          let finalSellerId = seller;
          const matchedSeller = sellersList.find(
            (s: any) =>
              s.numericId?.toString() === seller ||
              s.name?.toLowerCase() === seller.toLowerCase() ||
              `${s.numericId} - ${s.name}` === seller,
          );
          if (matchedSeller) finalSellerId = matchedSeller.id;

          // Automatically Resolve Zone ID
          let finalZoneId = zone;
          const matchedZone = zones.find(
            (z: any) => z.name.toLowerCase() === zone.toLowerCase(),
          );
          if (matchedZone) finalZoneId = matchedZone.id;

          // Post Order
          const res = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId,
              merchantId: finalSellerId,
              customerName: customer,
              customerPhone: phone,
              customerAddress: address,
              zoneId: finalZoneId,
              price: usd,
              amountLbp: lbp || "0",
              hasExchange: false,
              extraShipping: "0",
              packages: "1",
              notes: "Imported via CSV bulk tool",
            }),
          });

          if (res.ok) successCount++;
        }

        alert(`Success: Automatically generated ${successCount} orders.`);
        await fetchOrders();
      } catch (error: any) {
        alert("CSV Processing error: " + error.message);
      } finally {
        setCsvUploading(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
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

  // ── Fetch ──
  const fetchOrders = async () => {
    setLoading(true);
    try {
      const [ordersRes, zonesRes, driversRes, merchantsRes, sellersRes] =
        await Promise.all([
          fetch("/api/orders"),
          fetch("/api/admin/zones"),
          fetch("/api/admin/drivers"),
          fetch("/api/admin/merchants"),
          fetch("/api/sellers/list"),
        ]);
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(data);
      }
      if (zonesRes.ok) {
        const data = await zonesRes.json();
        setZones(data);
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
  const handleCopyLink = (orderId: string) => {
    const trackingUrl = window.location.origin + "/track/" + orderId;

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

  useEffect(() => {
    fetchOrders();
  }, []);

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
  const hasPermission = (perm: string) =>
    currentUser?.role === "ADMIN" ||
    currentUser?.permissions?.includes(perm) ||
    false;

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

    try {
      await Promise.all(
        selectedOrderIds.map((id) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              driverId: matchedDriver.id,
              location: "ASSIGNED",
              financialStatus: "UD",
              collectedUsd: 0,
              collectedLbp: 0,
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

    // Parse order IDs: one per line, strip whitespace and leading #
    const rawIds = quickAssignOrderIdsText
      .split("\n")
      .map((id) => id.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (rawIds.length === 0) return alert("No valid order IDs found.");

    // Match raw IDs against orders (by orderId or id)
    const matchedOrders = orders.filter((o) => {
      const orderNumStr = String(o.orderId || "").toLowerCase();
      const orderUuid = String(o.id || "").toLowerCase();
      return rawIds.some((raw) => {
        const normalized = raw.toLowerCase();
        return orderNumStr === normalized || orderUuid === normalized;
      });
    });

    if (matchedOrders.length === 0)
      return alert(
        `None of the entered order IDs matched any orders in the system. Found ${rawIds.length} ID(s) but 0 matched.`,
      );

    const unmatched = rawIds.length - matchedOrders.length;
    if (unmatched > 0) {
      alert(
        `⚠️ ${unmatched} order(s) could not be found. Proceeding with ${matchedOrders.length} matched order(s).`,
      );
    }

    try {
      await Promise.all(
        matchedOrders.map((o) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: o.id,
              driverId: matchedDriver.id,
              location: "ASSIGNED",
              financialStatus: "UD",
              collectedUsd: 0,
              collectedLbp: 0,
            }),
          }),
        ),
      );

      setQuickAssignModalOpen(false);
      setQuickAssignOrderIdsText("");
      setQuickAssignDriverId("");
      fetchOrders();
      alert(
        `Successfully assigned ${matchedOrders.length} order(s) to ${matchedDriver.firstName} ${matchedDriver.lastName}.`,
      );
    } catch (error) {
      console.error("Failed to quick-assign orders", error);
      alert("An error occurred during assignment.");
    }
  };

  // ── Archived filter ──
  const activeOrArchivedOrders = useMemo(
    () => orders.filter((o) => o.isArchived === showArchived),
    [orders, showArchived],
  );

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

        // AND logic: Order must match ALL terms (great for parameter filtering)
        const matchesAnd = terms.every(
          (term) =>
            order.orderId.toLowerCase().includes(term) ||
            order.customerName.toLowerCase().includes(term) ||
            order.customerPhone.toLowerCase().includes(term) ||
            (order.customerAddress &&
              order.customerAddress.toLowerCase().includes(term)) ||
            (order.city && order.city.toLowerCase().includes(term)) ||
            order.location.toLowerCase().includes(term) ||
            String(order.amountUsd).includes(term) ||
            String(order.amountLbp).includes(term) ||
            (order.driver &&
              order.driver.firstName.toLowerCase().includes(term)),
        );

        // OR logic: If ANY term matches the Order ID directly, include it (great for pasting multiple IDs)
        const matchesOrId = terms.some((term) =>
          order.orderId.toLowerCase().includes(term),
        );

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

  // ── Warehouse filtered & grouped ──
  const warehouseOrders = useMemo(
    () => orders.filter((o) => o.location === "WAREHOUSE"),
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
      return loc === "RETURN" && (fin === "RE" || fin === "RTS");
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

  // ── Quick location actions ──
  const updateOrder = (id: string, payload: Record<string, unknown>) =>
    patchOrder(id, payload);

  const handleWarehouse = (id: string) =>
    patchOrder(id, {
      location: "WAREHOUSE",
      financialStatus: "UD",
      driverId: null,
      isArchived: false,
      collectedUsd: 0,
      collectedLbp: 0,
    });
  const handleDeliver = (order: Order) =>
    patchOrder(order.id, {
      location: "DELIVERED",
      financialStatus: "WD",
      collectedUsd: order.amountUsd,
      collectedLbp: order.amountLbp,
    });
  const handleReturn = (id: string) =>
    patchOrder(id, { location: "RETURN", status: "Re" });

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

  // ── Clear Returns Handler (Re -> RTS) ──
  const handleClearReturns = async (sellerName: string, orderIds: string[]) => {
    if (
      !window.confirm(
        `Mark ${orderIds.length} returned orders as "Returned to Seller" for ${sellerName}?\nThis changes their status from Re (Warehouse) to RTS (Returned to Seller).`,
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

  // ── Bulk Returned to Seller Handler (Re -> RTS) ──
  const [rtsUpdating, setRtsUpdating] = useState(false);
  const handleBulkRTS = async () => {
    if (selectedOrderIds.length === 0) return;
    // Validate: all selected must have financialStatus === "Re"
    const selectedOrders = orders.filter((o) =>
      selectedOrderIds.includes(o.id),
    );
    const allRe = selectedOrders.every((o) => o.financialStatus === "Re");
    if (!allRe) {
      alert("All selected orders must have financial status 'Re' (Warehouse).");
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
    const success = await patchOrder(editModal.id, {
      customerName: editFormData.customerName,
      customerPhone: editFormData.customerPhone,
      customerAddress: editFormData.customerAddress,
      zoneId: editFormData.zoneId,
      amountUsd: parseFloat(editFormData.amountUsd) || 0,
      amountLbp: parseFloat(editFormData.amountLbp) || 0,
      hasExchange: editFormData.hasExchange,
      extraShipping: parseFloat(editFormData.extraShipping) || 0,
    });
    if (success) setEditModal(null);
  };

  // ── Assign Driver modal ──
  const openDriverModal = (order: Order) => {
    setDriverModal(order);
    setNewDriverId(order.driverId || "");
  };

  const submitDriver = async () => {
    if (!driverModal) return;
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
            { key: "reports" as Tab, label: "Reports" },
            { key: "returns" as Tab, label: "Returns" },
            ...(hasPermission("ORDERS_CREATE")
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
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                      >
                        🔗 New Tab
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
                  <button
                    onClick={() =>
                      handleBulkAction("move to Warehouse", {
                        location: "WAREHOUSE",
                        financialStatus: "UD",
                        driverId: null,
                        isArchived: false,
                        collectedUsd: 0,
                        collectedLbp: 0,
                      })
                    }
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
                  {hasPermission("ORDERS_CREATE") && (
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
                      onClick={() => setShowArchived((prev) => !prev)}
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
                  placeholder="Search orders (e.g., Hamra, 10)..."
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
                    [50, 100, 200, 300].includes(allItemsPerPage)
                      ? allItemsPerPage
                      : "all"
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setAllItemsPerPage(
                      val === "all" ? allFiltered.length : Number(val),
                    );
                    setAllPage(1);
                  }}
                  className="bg-slate-800 text-white border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-cyan-500 transition-all"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={300}>300</option>
                  <option value="all">All</option>
                </select>
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
                const allTotalPages = Math.ceil(
                  allFiltered.length / allItemsPerPage,
                );
                const paginatedAll = allFiltered.slice(
                  (allPage - 1) * allItemsPerPage,
                  allPage * allItemsPerPage,
                );
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
                    />
                    {allTotalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 px-2">
                        <p className="text-xs text-gray-500">
                          Showing {(allPage - 1) * allItemsPerPage + 1}–
                          {Math.min(
                            allPage * allItemsPerPage,
                            allFiltered.length,
                          )}{" "}
                          of {allFiltered.length}
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
                    </div>
                  </div>
                </div>

                {/* Orders for selected zone — compact table */}
                {activeWarehouseZone ? (
                  (() => {
                    const zoneItems = warehouseOrders.filter(
                      (o) => o.zoneId === activeWarehouseZone,
                    );

                    // Apply batch search filtering
                    const items = (() => {
                      if (!batchSearchQuery.trim()) return zoneItems;
                      const targetIds = batchSearchQuery
                        .split(/[\s,]+/)
                        .map((id) => id.trim().replace(/^#/, "").toLowerCase())
                        .filter(Boolean);
                      if (targetIds.length === 0) return zoneItems;
                      return zoneItems.filter((order) => {
                        const orderNumStr = String(
                          order.orderId || order.id || "",
                        )
                          .replace(/^#/, "")
                          .toLowerCase();
                        const trackingStr = String(
                          (order as any).trackingNumber || "",
                        )
                          .replace(/^#/, "")
                          .toLowerCase();
                        // Strip non-digits from phone for easier matching
                        const phoneStr = String(
                          order.customerPhone || "",
                        ).replace(/\D/g, "");
                        return (
                          targetIds.includes(orderNumStr) ||
                          targetIds.includes(trackingStr) ||
                          targetIds.some((target) =>
                            phoneStr.includes(target.replace(/\D/g, "")),
                          )
                        );
                      });
                    })();

                    const totalPages = Math.ceil(items.length / itemsPerPage);
                    const paginatedItems = items.slice(
                      (warehousePage - 1) * itemsPerPage,
                      warehousePage * itemsPerPage,
                    );

                    const handleWarehouseSelectAll = () => {
                      if (
                        selectedOrderIds.length === items.length &&
                        items.length > 0
                      ) {
                        setSelectedOrderIds([]);
                      } else {
                        setSelectedOrderIds(items.map((o) => o.id));
                      }
                    };

                    return items.length === 0 ? (
                      <div className="text-center py-20">
                        <p className="text-gray-500 text-sm">
                          {batchSearchQuery.trim()
                            ? "No orders match the batch search."
                            : "No orders in this zone."}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                                <th className="px-2 py-2 text-left font-medium w-8">
                                  <input
                                    type="checkbox"
                                    checked={
                                      selectedOrderIds.length ===
                                        items.length && items.length > 0
                                    }
                                    onChange={handleWarehouseSelectAll}
                                    className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                                  />
                                </th>
                                <th className="px-2 py-2 text-left font-medium">
                                  Order ID
                                </th>
                                <th className="px-2 py-2 text-left font-medium">
                                  Customer
                                </th>
                                <th className="px-2 py-2 text-left font-medium">
                                  Phone
                                </th>
                                <th className="px-2 py-2 text-left font-medium">
                                  Address
                                </th>
                                <th className="px-2 py-2 text-left font-medium">
                                  Driver
                                </th>
                                <th className="px-2 py-2 text-left font-medium">
                                  Fin Status
                                </th>
                                <th className="px-2 py-2 text-right font-medium">
                                  Amt $
                                </th>
                                <th className="px-2 py-2 text-right font-medium">
                                  Amt LL
                                </th>
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
                                    #{order.orderId}
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
                                items.length,
                              )}{" "}
                              of {items.length}
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
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
                <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
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
                              <button
                                onClick={() => openEditModal(order)}
                                className="px-2 py-1 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all"
                              >
                                Edit
                              </button>
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
              {/* CSV Upload */}
              <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
                <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
                  <span className="bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded text-[10px]">
                    BULK
                  </span>
                  CSV Upload
                </h3>
                <p className="text-[10px] text-gray-500 mb-3">
                  Upload a CSV with columns: orderId, seller, customer, phone,
                  address, zone, usd, lbp
                </p>
                <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-gray-700 border-dashed rounded-lg cursor-pointer hover:bg-slate-900/50 hover:border-cyan-500/50 transition-all">
                  <span className="text-xs text-cyan-400 font-bold">
                    {csvUploading ? "Processing..." : "Click to Upload CSV"}
                  </span>
                  <input
                    type="file"
                    accept=".csv"
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
                      .every((o) => o.financialStatus === "Re")
                  }
                  className={`px-4 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 shadow-lg ${
                    orders
                      .filter((o) => selectedOrderIds.includes(o.id))
                      .every((o) => o.financialStatus === "Re")
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
                      onClick={() =>
                        window.open(
                          `/orders/print?ids=${returnsOrders.map((o) => o.id).join(",")}&pdf=true`,
                          "_blank",
                        )
                      }
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
                          .every((o) => o.financialStatus === "Re")
                      }
                      className={`px-3 py-1.5 text-xs font-bold rounded transition-all shadow-sm ${
                        selectedOrderIds.length > 0 &&
                        returnsOrders
                          .filter((o) => selectedOrderIds.includes(o.id))
                          .every((o) => o.financialStatus === "Re")
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30"
                          : "bg-gray-700 text-gray-500 cursor-not-allowed border border-gray-600"
                      } ${rtsUpdating ? "opacity-50" : ""}`}
                    >
                      {rtsUpdating ? "Updating…" : "Returned to Seller"}
                    </button>
                  </div>
                </div>

                {/* Orders table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
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
                                    : "text-purple-400 bg-purple-500/10 border-purple-500/30"
                                }`}
                                title={
                                  order.financialStatus === "Re"
                                    ? "Returned (at warehouse)"
                                    : "Returned to Seller"
                                }
                              >
                                {order.financialStatus === "Re" ? "Re" : "RTS"}
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

              <div className="grid grid-cols-2 gap-3 mb-6">
                {Object.entries(excelCols).map(([key, val]) => (
                  <label
                    key={key}
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
                          [key]: !prev[key as keyof typeof prev],
                        }))
                      }
                      className="sr-only"
                    />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors capitalize">
                      {key === "orderId"
                        ? "Order ID"
                        : key === "usd"
                          ? "Amount $"
                          : key === "lbp"
                            ? "Amount LL"
                            : key}
                    </span>
                  </label>
                ))}
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
                    if (excelCols.orderId)
                      cols.push({
                        header: "Order ID",
                        key: "orderId",
                        width: 15,
                      });
                    if (excelCols.date)
                      cols.push({ header: "Date", key: "date", width: 15 });
                    if (excelCols.seller)
                      cols.push({ header: "Seller", key: "seller", width: 20 });
                    if (excelCols.customer)
                      cols.push({
                        header: "Customer",
                        key: "customer",
                        width: 25,
                      });
                    if (excelCols.phone)
                      cols.push({ header: "Phone", key: "phone", width: 18 });
                    if (excelCols.address)
                      cols.push({
                        header: "Address",
                        key: "address",
                        width: 35,
                      });
                    if (excelCols.city)
                      cols.push({ header: "City", key: "city", width: 20 });
                    if (excelCols.usd)
                      cols.push({ header: "Amount $", key: "usd", width: 15 });
                    if (excelCols.lbp)
                      cols.push({ header: "Amount LL", key: "lbp", width: 15 });
                    worksheet.columns = cols;

                    // Add Rows & Format
                    const exportData = orders.filter((o) =>
                      selectedOrderIds.includes(o.id),
                    );
                    exportData.forEach((order) => {
                      const sellerName =
                        order.merchant?.ownerFirstName ||
                        order.merchant?.merchantName ||
                        "—";
                      worksheet.addRow({
                        orderId: order.orderId,
                        date: new Date(order.createdAt).toLocaleDateString(),
                        seller: sellerName,
                        customer: order.customerName,
                        phone: order.customerPhone,
                        address: order.customerAddress,
                        city: order.city || "-",
                        usd: order.amountUsd,
                        lbp: order.amountLbp,
                      });
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
