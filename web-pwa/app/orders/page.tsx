"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import SharedOrderTable, {
  formatDDMMYYYY,
} from "@/components/SharedOrderTable";
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
};

const LOCATION_COLORS: Record<string, string> = {
  WAREHOUSE: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  WITH_DRIVER: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  DELIVERED: "text-green-400 bg-green-500/10 border-green-500/30",
  RETURN: "text-red-400 bg-red-500/10 border-red-500/30",
  Re: "text-red-400 bg-red-500/10 border-red-500/30",
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
export default function OrdersPage() {
  const router = useRouter();

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

  // ── Tabs & Filters ──
  const [activeTab, setActiveTab] = useState<Tab>("all");
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

  // ── Warehouse active zone sub-tab ──
  const [activeWarehouseZone, setActiveWarehouseZone] = useState<string>("");

  // ── Bulk Dispatch State ──
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [driverSearchTerm, setDriverSearchTerm] = useState("");

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
        setIsCreateModalOpen(false);
        await fetchOrders();
      } else {
        const err = await res.json();
        console.error("POST error", err);
        alert("Failed to create order.");
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
    let list = orders.filter(
      (o) => o.financialStatus === "Re" || o.financialStatus === "RTS",
    );

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
      if (o.financialStatus === "Re" || o.financialStatus === "RTS") {
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

  // ── Clear Returns Handler ──
  const handleClearReturns = async (sellerName: string, orderIds: string[]) => {
    if (
      !window.confirm(
        `Clear ${orderIds.length} returned orders for ${sellerName}?\nThis marks the items as physically handed back to the merchant and removes them from this queue.`,
      )
    )
      return;
    try {
      await Promise.all(
        orderIds.map((id) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              location: "MERCHANT_RETURNED",
              financialStatus: "RTS_CLEARED",
            }),
          }),
        ),
      );
      fetchOrders();
    } catch (error) {
      alert("Failed to clear returned orders.");
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

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8">
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
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === tab.key
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
        {activeTab === "all" && (
          <>
            {/* Smart Universal Action Bar */}
            <div className="flex flex-col gap-3 mb-4">
              {/* Row 1: Print/Export + Bulk Actions + Single Actions + New Order */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Print/Export Dropdown */}
                  <div className="relative" ref={exportMenuRef}>
                    <button
                      onClick={() => setExportMenuOpen((prev) => !prev)}
                      disabled={selectedOrderIds.length === 0}
                      className="px-4 py-2 text-xs font-semibold rounded-lg
                                 bg-white/5 text-gray-400 border border-white/10
                                 hover:bg-white/10 hover:text-gray-300
                                 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all duration-200"
                    >
                      Print/Export Selected ({selectedOrderIds.length}) ▾
                    </button>

                    {exportMenuOpen && (
                      <div
                        className="absolute top-full left-0 mt-1 w-56 z-50
                                      backdrop-blur-xl bg-gray-900/95 border border-white/20
                                      rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.5)]
                                      overflow-hidden"
                      >
                        <button
                          onClick={() => {
                            setExportMenuOpen(false);
                            window.open(
                              "/orders/print?ids=" + selectedOrderIds.join(","),
                              "_blank",
                            );
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-gray-300
                                     hover:bg-cyan-500/10 hover:text-cyan-300
                                     transition-all duration-150 border-b border-white/5"
                        >
                          🖨️ Open Selected
                        </button>
                        <button
                          onClick={() => {
                            setExportMenuOpen(false);
                            setExcelModalOpen(true);
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-gray-300
                                     hover:bg-cyan-500/10 hover:text-cyan-300
                                     transition-all duration-150 border-b border-white/5"
                        >
                          📊 Download Excel
                        </button>
                        <button
                          onClick={() => {
                            setExportMenuOpen(false);
                            window.open(
                              "/orders/print?ids=" +
                                selectedOrderIds.join(",") +
                                "&pdf=true",
                              "_blank",
                            );
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-gray-300
                                     hover:bg-cyan-500/10 hover:text-cyan-300
                                     transition-all duration-150 border-b border-white/5"
                        >
                          📄 Download PDF
                        </button>
                        <button
                          onClick={() => {
                            setExportMenuOpen(false);
                            alert(
                              "Email functionality pending SMTP configuration.",
                            );
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-gray-300
                                     hover:bg-cyan-500/10 hover:text-cyan-300
                                     transition-all duration-150"
                        >
                          ✉️ Email
                        </button>
                      </div>
                    )}
                  </div>

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
              <SharedOrderTable
                orders={allFiltered}
                selectedOrderIds={selectedOrderIds}
                onToggleSelectOrder={toggleSelectOrder}
                onToggleSelectAll={toggleSelectAll}
                isAllSelected={
                  selectedOrderIds.length === allFiltered.length &&
                  allFiltered.length > 0
                }
                availableDrivers={availableDrivers}
                onUpdateOrder={updateOrder}
                currentUser={currentUser}
                onCopyLink={handleCopyLink}
              />
            )}
          </>
        )}

        {/* ════════════════════════════════ */}
        {/* WAREHOUSE TAB                    */}
        {/* ════════════════════════════════ */}
        {activeTab === "warehouse" && (
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
                </div>

                {/* Orders for selected zone — compact table */}
                {activeWarehouseZone ? (
                  (() => {
                    const items = warehouseOrders.filter(
                      (o) => o.zoneId === activeWarehouseZone,
                    );
                    return items.length === 0 ? (
                      <div className="text-center py-20">
                        <p className="text-gray-500 text-sm">
                          No orders in this zone.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-white/10">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                              <th className="px-2 py-2 text-left font-medium w-8">
                                <input
                                  type="checkbox"
                                  checked={
                                    selectedOrderIds.length === items.length &&
                                    items.length > 0
                                  }
                                  onChange={toggleSelectAll}
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
                            {items.map((order) => (
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
                                    onChange={() => toggleSelectOrder(order.id)}
                                    className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-xs font-mono text-gray-300">
                                  #{order.orderId}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-white">
                                  {order.customerName}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-gray-400 max-w-[120px] truncate">
                                  {order.customerAddress}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-gray-300">
                                  {order.driver
                                    ? `${order.driver.firstName} ${order.driver.lastName}`
                                    : "—"}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-gray-300">
                                  {order.financialStatus}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-gray-300 text-right">
                                  ${order.amountUsd.toFixed(2)}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-gray-300 text-right">
                                  {order.amountLbp.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
        {activeTab === "reports" && (
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

        {/* --- HIGH-VOLUME ORDER ENTRY STATION --- */}
        {activeTab === "order-entry" && (
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
            {/* Column 1: Bulk CSV Upload */}
            <div className="bg-[#121824] border border-white/5 rounded-xl p-6 shadow-2xl lg:col-span-1 h-fit">
              <h2 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2 flex items-center gap-2">
                <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded text-xs">
                  NEW
                </span>
                Bulk CSV Upload
              </h2>
              <p className="text-xs text-gray-400 mb-4">
                Upload a standard CSV file to generate multiple orders
                instantly. The system will automatically map seller names and
                zones to their database IDs.
              </p>
              <div className="bg-slate-950 border border-gray-800 rounded p-4 mb-4 font-mono text-[10px] text-gray-400 overflow-x-auto whitespace-nowrap">
                <span className="text-cyan-500 font-bold">
                  Required CSV Format (Exact Columns):
                </span>
                <br />
                orderId, seller, customer, phone, address, zone, usd, lbp
                <br />
                <span className="text-gray-600">
                  1001, Tloba, Ali Kanj, 71352165, Beirut, 1, 50, 0
                </span>
              </div>
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-700 border-dashed rounded-lg cursor-pointer hover:bg-slate-900/50 hover:border-cyan-500/50 transition-all">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <span className="text-sm text-cyan-400 font-bold">
                    {csvUploading ? "Processing CSV..." : "Click to Upload CSV"}
                  </span>
                </div>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvUpload}
                  disabled={csvUploading}
                />
              </label>
            </div>

            {/* Column 2 & 3: Rapid Manual Entry Form */}
            <div className="bg-[#121824] border border-white/5 rounded-xl p-6 shadow-2xl lg:col-span-2">
              <div className="flex justify-between items-end mb-6 border-b border-white/10 pb-3">
                <h2 className="text-xl font-bold text-white">
                  Rapid Entry Terminal
                </h2>
                <span className="text-xs text-gray-500 font-mono">
                  Silent submit active. Form auto-clears.
                </span>
              </div>

              <form onSubmit={handleCreateOrder} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Order ID & Seller */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Order ID
                    </label>
                    <input
                      required
                      value={formData.orderId}
                      onChange={(e) =>
                        setFormData({ ...formData, orderId: e.target.value })
                      }
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Assign Seller
                    </label>
                    <input
                      required
                      list="tab-seller-options"
                      value={formData.merchantId}
                      onChange={(e) =>
                        setFormData({ ...formData, merchantId: e.target.value })
                      }
                      placeholder="Search name or ID..."
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                    <datalist id="tab-seller-options">
                      {sellersList.map((s: any) => (
                        <option
                          key={s.id}
                          value={`${s.numericId} - ${s.name}`}
                        />
                      ))}
                    </datalist>
                  </div>

                  {/* Customer Info */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Customer Name
                    </label>
                    <input
                      required
                      value={formData.customerName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          customerName: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Customer Phone
                    </label>
                    <input
                      required
                      value={formData.customerPhone}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          customerPhone: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>

                  {/* Location */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Delivery Address
                    </label>
                    <input
                      required
                      value={formData.customerAddress}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          customerAddress: e.target.value,
                        })
                      }
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Dispatch Zone
                    </label>
                    <input
                      required
                      list="tab-zone-options"
                      value={zoneInput}
                      onChange={(e) => setZoneInput(e.target.value)}
                      placeholder="Search zone name..."
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                    <datalist id="tab-zone-options">
                      {zones.map((z: any) => (
                        <option key={z.id} value={z.name} />
                      ))}
                    </datalist>
                  </div>

                  {/* Financials */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Price (USD)
                    </label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) =>
                        setFormData({ ...formData, price: e.target.value })
                      }
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-400 font-mono uppercase">
                      Price (LBP)
                    </label>
                    <input
                      required
                      type="number"
                      value={formData.amountLbp}
                      onChange={(e) =>
                        setFormData({ ...formData, amountLbp: e.target.value })
                      }
                      className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-white/10">
                  <button
                    disabled={submitting}
                    type="submit"
                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-2.5 rounded font-bold shadow-lg transition-colors disabled:opacity-50"
                  >
                    {submitting
                      ? "Writing to Database..."
                      : "Log Order & Reset"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════ */}
        {/* RETURNS TAB                          */}
        {/* ════════════════════════════════════ */}
        {activeTab === "returns" && (
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
                  Re
                </option>
                <option value="RTS" className="bg-slate-950 text-white">
                  RTS
                </option>
              </select>
            </div>

            {/* Returns table grouped by seller */}
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
            ) : Object.keys(returnsBySeller).length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-sm">No return orders found.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(returnsBySeller).map(([seller, items]) => (
                  <div
                    key={seller}
                    className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden"
                  >
                    {/* Seller group header */}
                    <div className="px-5 py-3 border-b border-white/10 bg-white/[0.03] flex justify-between items-center">
                      <h3 className="text-sm font-bold text-cyan-300 uppercase tracking-wider">
                        {seller}
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          ({items.length} order{items.length !== 1 ? "s" : ""})
                        </span>
                      </h3>
                      <div className="flex gap-3">
                        <button
                          onClick={() =>
                            window.open(
                              `/orders/print?ids=${items.map((o) => o.id).join(",")}&pdf=true`,
                              "_blank",
                            )
                          }
                          className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all shadow-sm"
                        >
                          Print RTS Manifest
                        </button>
                        <button
                          onClick={() =>
                            handleClearReturns(
                              seller,
                              items.map((o) => o.id),
                            )
                          }
                          className="px-3 py-1.5 text-xs font-bold rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all shadow-sm"
                        >
                          Clear Returns
                        </button>
                      </div>
                    </div>

                    {/* Orders table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5 text-gray-500 text-[11px] uppercase tracking-wider">
                            <th className="px-3 py-2 text-left font-medium">
                              Order ID
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
                          {items.map((order) => (
                            <tr
                              key={order.id}
                              className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                            >
                              <td className="px-3 py-1.5 text-xs font-mono text-gray-300 whitespace-nowrap">
                                #{order.orderId}
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
                                      : "text-orange-400 bg-orange-500/10 border-orange-500/30"
                                  }`}
                                >
                                  {order.financialStatus}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
                                ${order.amountUsd.toFixed(2)}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-gray-300 whitespace-nowrap text-right">
                                {order.amountLbp.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
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
                    min="0"
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
                    min="0"
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
                    min="0"
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
                    min="0"
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
                    min="0"
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
                        required
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
                        min="0"
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
                        min="0"
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
                        min="0"
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
      </div>
    </div>
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
