"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SYSTEM_PERMISSIONS } from "@/lib/permissions";
import ProfitTab from "@/components/admin/ProfitTab";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Zone {
  id: string;
  name: string;
  driverAssignments?: {
    id: string;
    driver: {
      id: string;
      firstName: string;
      lastName: string;
      user: { username: string };
    };
  }[];
}

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  permissions: string[];
  permissionGroupId: string | null;
  permissionGroup?: { id: string; name: string } | null;
  customPermissions: string[];
}

const PERMISSION_MAP: Record<string, string[]> = {
  "Orders Module": [
    "ORDERS_VIEW",
    "ORDERS_CREATE",
    "ORDERS_EDIT",
    "ORDERS_DISPATCH",
    "ORDERS_FINANCIAL",
  ],
  "Drivers Module": ["DRIVERS_VIEW", "DRIVERS_CREATE", "DRIVERS_PAYOUT"],
  "Admin Functions": ["ZONES_MANAGE", "MERCHANTS_MANAGE", "USERS_MANAGE"],
};

// ─── Categorized Permission Taxonomy ───────────────────────────────────────────
// Hierarchical catalog separating Page Access (route-level) from Actions
// (button/action-level) to enable granular Page-Level and Button-Level control.
const PERMISSION_TAXONOMY = {
  Pages: [
    { id: "PAGE_DASHBOARD", label: "View Dashboard" },
    { id: "PAGE_SETTLEMENTS", label: "View Settlements (Pending)" },
    { id: "PAGE_CLEARED_PAYOUTS", label: "View Cleared Payouts" },
    { id: "PAGE_ADMIN", label: "View Admin Panel" },
    { id: "PAGE_ORDERS", label: "View Orders" },
    { id: "PAGE_ADMIN_TREASURY", label: "View Treasury (Cashbox)" },
  ],
  Actions: [
    { id: "ACTION_PAYOUT_INITIATE", label: "Initiate Payout" },
    { id: "ACTION_PAYOUT_APPROVE", label: "Approve Payout" },
    { id: "ACTION_ORDER_EDIT", label: "Edit Orders" },
    { id: "ACTION_DRIVER_CREATE", label: "Create Drivers" },
    {
      id: "ACTION_DRIVER_RATE_EDIT",
      label: "Edit Driver Rates",
    },
    {
      id: "ACTION_TREASURY_TRANSACT",
      label: "Treasury Transactions (Add/Withdraw/Transfer)",
    },
  ],
} as const;

// Display metadata (section header + helper text) for each taxonomy section.
const PERMISSION_SECTION_META: Record<
  string,
  { label: string; description: string }
> = {
  Pages: {
    label: "Page Access",
    description: "Grant access to specific pages/routes.",
  },
  Actions: {
    label: "Button Actions",
    description: "Grant access to specific buttons/actions.",
  },
};

type Tab = "employees" | "zones" | "drivers" | "permission-groups" | "profit";

const VALID_TABS: Tab[] = [
  "employees",
  "zones",
  "drivers",
  "permission-groups",
  "profit",
];

// ─── Default Export (Suspense Boundary) ───────────────────────────────────────
export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <AdminContent />
    </Suspense>
  );
}

// ─── Inner Component (uses useSearchParams) ────────────────────────────────────
function AdminContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = searchParams.get("tab");
  const activeTab: Tab = VALID_TABS.includes(rawTab as Tab)
    ? (rawTab as Tab)
    : "employees";

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.ok && r.json())
      .then((u) => setCurrentUser(u))
      .catch(() => {});
  }, []);

  const canViewDrivers =
    currentUser?.role === "ADMIN" ||
    currentUser?.permissions?.some((p) => p.startsWith("DRIVERS_"));

  const tabs: { key: Tab; label: string }[] = [
    { key: "employees", label: "Employees" },
    { key: "zones", label: "Zones" },
    { key: "drivers", label: "Drivers" },
    { key: "permission-groups", label: "Permission Groups" },
    { key: "profit", label: "Profit" },
  ];

  const handleTabChange = (tab: Tab) => {
    router.push(`${pathname}?tab=${tab}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] pointer-events-none z-0" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Header ── */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            Admin Panel
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage employees, zones, and system settings.
          </p>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-6 border-b border-white/10">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-all duration-200 ${
                activeTab === tab.key
                  ? "text-cyan-400 border-b-2 border-cyan-400 bg-white/5"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        {activeTab === "employees" ? (
          <EmployeesTab />
        ) : activeTab === "zones" ? (
          <ZonesTab />
        ) : activeTab === "drivers" ? (
          <DriversTab />
        ) : activeTab === "permission-groups" ? (
          <PermissionGroupsTab />
        ) : activeTab === "profit" ? (
          <ProfitTab />
        ) : null}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Zones Tab
// ══════════════════════════════════════════════════════════════════════════════
function ZonesTab() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [drivers, setDrivers] = useState<
    {
      id: string;
      firstName: string;
      lastName: string;
      user: { username: string };
    }[]
  >([]);
  const [zoneName, setZoneName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assigningZone, setAssigningZone] = useState<string | null>(null);
  const [selectedDrivers, setSelectedDrivers] = useState<
    Record<string, string[]>
  >({});

  const fetchZones = async () => {
    try {
      const res = await fetch("/api/admin/zones");
      if (res.ok) {
        const data = await res.json();
        setZones(data);
      }
    } catch {
      // silently fail
    }
  };

  const fetchDrivers = async () => {
    try {
      const res = await fetch("/api/admin/drivers");
      if (res.ok) {
        const data = await res.json();
        setDrivers(data);
      }
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchZones();
    fetchDrivers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneName.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: zoneName.trim() }),
      });

      if (res.ok) {
        setZoneName("");
        await fetchZones();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create zone");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const openAssignModal = (zone: Zone) => {
    const assignedDriverIds =
      zone.driverAssignments?.map((da) => da.driver.id) || [];
    setSelectedDrivers((prev) => ({
      ...prev,
      [zone.id]: assignedDriverIds,
    }));
    setAssigningZone(zone.id);
  };

  const toggleDriverForZone = (zoneId: string, driverId: string) => {
    setSelectedDrivers((prev) => {
      const current = prev[zoneId] || [];
      return {
        ...prev,
        [zoneId]: current.includes(driverId)
          ? current.filter((id) => id !== driverId)
          : [...current, driverId],
      };
    });
  };

  const saveZoneDrivers = async (zoneId: string) => {
    const driverIds = selectedDrivers[zoneId] || [];
    // For each driver, we need to update their zone assignments.
    // But the API /api/admin/drivers/[id]/zones sets ALL zones for a driver.
    // So we take a different approach: update each driver's zone list individually.
    // We'll read current assignments from the zone data and compute deltas.

    // Build a map of driver -> zones they should have after this change
    const driverZoneMap: Record<string, Set<string>> = {};

    // Start with current state: for each zone, figure out which drivers are assigned
    zones.forEach((z) => {
      const assignedIds = z.driverAssignments?.map((da) => da.driver.id) || [];
      assignedIds.forEach((did) => {
        if (!driverZoneMap[did]) driverZoneMap[did] = new Set();
        driverZoneMap[did].add(z.id);
      });
    });

    // Apply the change for this zone
    driverIds.forEach((did) => {
      if (!driverZoneMap[did]) driverZoneMap[did] = new Set();
      driverZoneMap[did].add(zoneId);
    });

    // Now for each affected driver, call the API to set their zones
    const affectedDrivers = new Set<string>();
    // Drivers being added to this zone
    driverIds.forEach((did) => affectedDrivers.add(did));
    // Drivers being removed from this zone
    const prevAssigned =
      zones
        .find((z) => z.id === zoneId)
        ?.driverAssignments?.map((da) => da.driver.id) || [];
    prevAssigned.forEach((did) => affectedDrivers.add(did));

    const promises = Array.from(affectedDrivers).map(async (did) => {
      const finalZones = Array.from(driverZoneMap[did] || []);
      // Remove zoneId if this driver is NOT in the new selection
      if (!driverIds.includes(did)) {
        const filtered = finalZones.filter((zid) => zid !== zoneId);
        await fetch(`/api/admin/drivers/${did}/zones`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneIds: filtered }),
        });
      } else {
        await fetch(`/api/admin/drivers/${did}/zones`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneIds: finalZones }),
        });
      }
    });

    await Promise.all(promises);
    setAssigningZone(null);
    await fetchZones();
  };

  return (
    <div className="space-y-6">
      {/* ── Create Zone Form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Create Zone
        </h2>
        <form onSubmit={handleSubmit} className="flex items-end gap-4">
          <div className="flex-1">
            <label
              htmlFor="zoneName"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Zone Name
            </label>
            <input
              id="zoneName"
              type="text"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="e.g. Downtown"
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !zoneName.trim()}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                       hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                       shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                       transition-all duration-200"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* ── Zones List ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Existing Zones ({zones.length})
        </h2>
        {zones.length === 0 ? (
          <p className="text-sm text-gray-500">No zones created yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="rounded-xl bg-white/5 border border-white/10 overflow-hidden
                           hover:border-cyan-500/30 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)]
                           transition-all duration-200"
              >
                {/* Zone Header */}
                <div className="px-4 py-3 border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-200">
                      {zone.name}
                    </h3>
                    <span className="text-[11px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">
                      {zone.driverAssignments?.length || 0} driver
                      {zone.driverAssignments?.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                {/* Assigned Drivers */}
                <div className="px-4 py-3">
                  {zone.driverAssignments &&
                  zone.driverAssignments.length > 0 ? (
                    <div className="space-y-1.5">
                      {zone.driverAssignments.map((da) => (
                        <div
                          key={da.id}
                          className="flex items-center gap-2 text-xs text-gray-400"
                        >
                          <div className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] text-cyan-400 font-medium">
                              {da.driver.firstName?.[0]}
                              {da.driver.lastName?.[0]}
                            </span>
                          </div>
                          <span className="truncate">
                            {da.driver.firstName} {da.driver.lastName}
                            <span className="text-gray-600 ml-1">
                              ({da.driver.user.username})
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600 italic">
                      No drivers assigned
                    </p>
                  )}
                </div>

                {/* Assign Button */}
                <div className="px-4 py-2.5 border-t border-white/5 bg-white/[0.02]">
                  <button
                    onClick={() => openAssignModal(zone)}
                    className="w-full px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-400
                               border border-cyan-500/20 bg-cyan-500/5
                               hover:bg-cyan-500/10 hover:border-cyan-500/40
                               transition-all duration-200"
                  >
                    Manage Drivers
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Assign Drivers Modal ── */}
      {assigningZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setAssigningZone(null)}
          />
          <div className="relative z-10 w-full max-w-md bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6">
            <h3 className="text-base font-semibold text-gray-200 mb-1">
              Assign Drivers
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Zone:{" "}
              <span className="text-cyan-400">
                {zones.find((z) => z.id === assigningZone)?.name}
              </span>
            </p>

            {drivers.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No drivers available.
              </p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {drivers.map((driver) => {
                  const isSelected = (
                    selectedDrivers[assigningZone] || []
                  ).includes(driver.id);
                  return (
                    <label
                      key={driver.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150
                                 ${isSelected ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-white/5 border border-transparent hover:bg-white/10"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          toggleDriverForZone(assigningZone, driver.id)
                        }
                        className="sr-only"
                      />
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all
                                   ${isSelected ? "bg-cyan-500 border-cyan-500" : "border-gray-600 bg-white/5"}`}
                      >
                        {isSelected && (
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
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 truncate">
                          {driver.firstName} {driver.lastName}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          @{driver.user.username}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-white/10">
              <button
                onClick={() => setAssigningZone(null)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-400
                           border border-white/10 bg-white/5 hover:bg-white/10
                           transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => saveZoneDrivers(assigningZone)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-cyan-500 to-cyan-600
                           hover:from-cyan-400 hover:to-cyan-500
                           shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                           transition-all duration-200"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Drivers Tab
// ══════════════════════════════════════════════════════════════════════════════
interface Merchant {
  id: string;
  merchantName: string;
}

interface SellerException {
  merchantId: string;
  rate: number;
  merchantName: string;
}

interface Driver {
  id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  vehicles: string[];
  user: { username: string };
  zoneRates: {
    id: string;
    rate: number;
    zone: { id: string; name: string };
  }[];
  driverSellerRates?: {
    id: number;
    merchantId: string;
    rateUsd: number;
    merchant: {
      id: string;
      merchantName: string;
      merchantId: string;
    };
  }[];
  assignedZones?: {
    id: string;
    zoneId: string;
    zone: { id: string; name: string };
  }[];
}

const VEHICLE_OPTIONS = ["MOTORCYCLE", "CAR", "VAN"] as const;

function DriversTab() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [bulkRate, setBulkRate] = useState("");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [assignedRates, setAssignedRates] = useState<Record<string, number>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingDriverProfileId, setEditingDriverProfileId] = useState<
    string | null
  >(null);

  // ── Seller Rate Exceptions state ──
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [sellerExceptions, setSellerExceptions] = useState<SellerException[]>(
    [],
  );
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [exceptionRate, setExceptionRate] = useState("");

  // ── Fetch zones, drivers, merchants on mount ──
  const fetchData = async () => {
    try {
      const [zRes, dRes, mRes] = await Promise.all([
        fetch("/api/admin/zones"),
        fetch("/api/admin/drivers"),
        fetch("/api/admin/merchants"),
      ]);
      if (zRes.ok) {
        const zData = await zRes.json();
        setZones(zData);
      }
      if (dRes.ok) {
        const dData = await dRes.json();
        setDrivers(dData);
      }
      if (mRes.ok) {
        const mData = await mRes.json();
        setMerchants(mData || []);
      }
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── Assign zones to driver ──
  const handleAssignZones = async (driverId: string, zoneIds: string[]) => {
    try {
      const res = await fetch(`/api/admin/drivers/${driverId}/zones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneIds }),
      });
      if (res.ok) {
        // Refresh drivers list
        const dRes = await fetch("/api/admin/drivers");
        if (dRes.ok) {
          const dData = await dRes.json();
          setDrivers(dData);
        }
      } else {
        const data = await res.json();
        alert(data.error || "Failed to assign zones");
      }
    } catch {
      alert("Network error");
    }
  };

  // ── Vehicle toggle ──
  const toggleVehicle = (v: string) => {
    setSelectedVehicles((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  // ── Reset driver form ──
  const resetDriverForm = () => {
    setDriverId("");
    setUsername("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setPhotoFile(null);
    setSelectedVehicles([]);
    setBulkRate("");
    setSelectedZones([]);
    setAssignedRates({});
    setSellerExceptions([]);
    setSelectedMerchant("");
    setExceptionRate("");
    setEditingDriverProfileId(null);
  };

  // ── Submit (FormData) ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !driverId.trim() ||
      !username.trim() ||
      !firstName.trim() ||
      !lastName.trim()
    )
      return;
    if (!editingDriverProfileId && !password) return;

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("driverId", driverId);
      formData.append("username", username);
      if (password) formData.append("password", password);
      formData.append("firstName", firstName);
      formData.append("lastName", lastName);
      if (photoFile) formData.append("photo", photoFile);
      formData.append("vehicles", JSON.stringify(selectedVehicles));
      const ratesArray = Object.entries(assignedRates).map(
        ([zoneId, rate]) => ({ zoneId, rate: Number(rate) }),
      );
      formData.append("zoneRates", JSON.stringify(ratesArray));
      if (sellerExceptions.length > 0) {
        formData.append(
          "sellerExceptions",
          JSON.stringify(
            sellerExceptions.map((ex) => ({
              merchantId: ex.merchantId,
              rate: ex.rate,
            })),
          ),
        );
      }

      const url = editingDriverProfileId
        ? `/api/admin/drivers/${editingDriverProfileId}`
        : "/api/admin/drivers";
      const method = editingDriverProfileId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        // No Content-Type — browser sets multipart boundary automatically
        body: formData,
      });

      if (res.ok) {
        resetDriverForm();
        // Refresh drivers list
        const dRes = await fetch("/api/admin/drivers");
        if (dRes.ok) {
          const dData = await dRes.json();
          setDrivers(dData);
        }
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save driver");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Create Driver Form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {editingDriverProfileId ? "Edit Driver" : "Create Driver"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Driver ID */}
          <div>
            <label
              htmlFor="driverId"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Driver ID
            </label>
            <input
              id="driverId"
              type="text"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              placeholder="D-001"
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>

          {/* Username (Login) & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="driverUsername"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Username (Login)
              </label>
              <input
                id="driverUsername"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="janedoe"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="driverPassword"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Password
              </label>
              <input
                id="driverPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
              {editingDriverProfileId && (
                <p className="mt-1 text-[10px] text-gray-500 italic">
                  *(Leave blank to keep current password)*
                </p>
              )}
            </div>
          </div>

          {/* First Name & Last Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="driverFirstName"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                First Name
              </label>
              <input
                id="driverFirstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="driverLastName"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Last Name
              </label>
              <input
                id="driverLastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
          </div>

          {/* Profile Photo (File) */}
          <div>
            <label
              htmlFor="driverPhoto"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Profile Photo
            </label>
            <input
              id="driverPhoto"
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4
                         file:rounded-lg file:border-0 file:text-sm file:font-semibold
                         file:bg-cyan-500/20 file:text-cyan-300
                         hover:file:bg-cyan-500/30 file:cursor-pointer file:transition-all file:duration-200
                         focus:outline-none"
            />
          </div>

          {/* Vehicles */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Vehicles
            </span>
            <div className="flex flex-wrap gap-4">
              {VEHICLE_OPTIONS.map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={selectedVehicles.includes(v)}
                    onChange={() => toggleVehicle(v)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500
                               focus:ring-cyan-500/40 focus:ring-offset-0
                               cursor-pointer accent-cyan-500"
                  />
                  <span className="group-hover:text-white transition-colors duration-200">
                    {v.charAt(0) + v.slice(1).toLowerCase()}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Bulk Rate Assigner */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Commission Rates by Zone
            </span>
            {zones.length === 0 ? (
              <p className="text-sm text-gray-500">
                No zones available. Create a zone first.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Bulk Rate Input + Apply Button */}
                <div className="flex items-end gap-4">
                  <div className="flex-1 max-w-xs">
                    <label
                      htmlFor="bulkRate"
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Bulk Rate Amount ($)
                    </label>
                    <input
                      id="bulkRate"
                      type="number"
                      step="0.01"
                      min="0"
                      value={bulkRate}
                      onChange={(e) => setBulkRate(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                                 transition-all duration-200 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const amount = parseFloat(bulkRate);
                      if (
                        isNaN(amount) ||
                        amount <= 0 ||
                        selectedZones.length === 0
                      )
                        return;
                      setAssignedRates((prev) => {
                        const next = { ...prev };
                        selectedZones.forEach((zId) => {
                          next[zId] = amount;
                        });
                        return next;
                      });
                      setSelectedZones([]);
                      setBulkRate("");
                    }}
                    disabled={selectedZones.length === 0 || !bulkRate.trim()}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600
                               hover:from-purple-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                               transition-all duration-200"
                  >
                    Apply Rate
                  </button>
                </div>

                {/* Zone Checkboxes Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {zones.map((zone) => {
                    const checked = selectedZones.includes(zone.id);
                    return (
                      <label
                        key={zone.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                          checked
                            ? "bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                            : "bg-white/5 border-white/10 hover:border-white/20"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedZones((prev) =>
                              prev.includes(zone.id)
                                ? prev.filter((id) => id !== zone.id)
                                : [...prev, zone.id],
                            );
                          }}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500
                                     focus:ring-cyan-500/40 focus:ring-offset-0
                                     cursor-pointer accent-cyan-500"
                        />
                        <span className="text-sm text-gray-300 min-w-0 flex-1 truncate">
                          {zone.name}
                        </span>
                        {assignedRates[zone.id] !== undefined && (
                          <span className="text-[10px] font-medium text-cyan-400 whitespace-nowrap">
                            ${assignedRates[zone.id].toFixed(2)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Assigned Rates Summary */}
                {Object.keys(assignedRates).length > 0 && (
                  <div className="pt-2">
                    <span className="block text-xs font-medium text-gray-400 mb-2">
                      Assigned Rates ({Object.keys(assignedRates).length})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(assignedRates).map(([zoneId, rate]) => {
                        const zone = zones.find((z) => z.id === zoneId);
                        return (
                          <div
                            key={zoneId}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20"
                          >
                            <span className="text-xs text-cyan-300 font-medium">
                              {zone?.name ?? zoneId}: ${rate.toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setAssignedRates((prev) => {
                                  const next = { ...prev };
                                  delete next[zoneId];
                                  return next;
                                });
                                setSelectedZones((prev) =>
                                  prev.filter((id) => id !== zoneId),
                                );
                              }}
                              className="text-red-400 hover:text-red-300 transition-colors text-sm leading-none"
                              title="Remove rate"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Seller Rate Exceptions */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Seller Rate Exceptions
            </span>
            {merchants.length === 0 ? (
              <p className="text-sm text-gray-500">
                No merchants available. Create a seller first.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Add Exception Mini-Form */}
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px] max-w-xs">
                    <label
                      htmlFor="exceptionMerchant"
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Seller
                    </label>
                    <select
                      id="exceptionMerchant"
                      value={selectedMerchant}
                      onChange={(e) => setSelectedMerchant(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                                 transition-all duration-200 text-sm"
                    >
                      <option
                        value=""
                        disabled
                        style={{ background: "#1a1a2e", color: "#e2e8f0" }}
                      >
                        Select seller...
                      </option>
                      {merchants.map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          style={{ background: "#1a1a2e", color: "#e2e8f0" }}
                        >
                          {m.merchantName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[120px] max-w-[160px]">
                    <label
                      htmlFor="exceptionRateInput"
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Rate ($)
                    </label>
                    <input
                      id="exceptionRateInput"
                      type="number"
                      step="0.01"
                      min="0"
                      value={exceptionRate}
                      onChange={(e) => setExceptionRate(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                                 transition-all duration-200 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const rate = parseFloat(exceptionRate);
                      if (!selectedMerchant || isNaN(rate) || rate <= 0) return;
                      const alreadyAdded = sellerExceptions.some(
                        (ex) => ex.merchantId === selectedMerchant,
                      );
                      if (alreadyAdded) {
                        setError("This seller already has an exception rate.");
                        return;
                      }
                      const merchant = merchants.find(
                        (m) => m.id === selectedMerchant,
                      );
                      setSellerExceptions((prev) => [
                        ...prev,
                        {
                          merchantId: selectedMerchant,
                          rate,
                          merchantName:
                            merchant?.merchantName ?? selectedMerchant,
                        },
                      ]);
                      setSelectedMerchant("");
                      setExceptionRate("");
                      setError("");
                    }}
                    disabled={!selectedMerchant || !exceptionRate.trim()}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600
                               hover:from-purple-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]
                               transition-all duration-200"
                  >
                    Add Exception
                  </button>
                </div>

                {/* Exceptions List */}
                {sellerExceptions.length > 0 && (
                  <div className="pt-2">
                    <span className="block text-xs font-medium text-gray-400 mb-2">
                      Current Exceptions ({sellerExceptions.length})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {sellerExceptions.map((ex) => (
                        <div
                          key={ex.merchantId}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20"
                        >
                          <span className="text-xs text-purple-300 font-medium">
                            {ex.merchantName}: ${ex.rate.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSellerExceptions((prev) =>
                                prev.filter(
                                  (e) => e.merchantId !== ex.merchantId,
                                ),
                              );
                            }}
                            className="text-red-400 hover:text-red-300 transition-colors text-sm leading-none"
                            title="Remove exception"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit + Cancel */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={
                loading ||
                !driverId.trim() ||
                !username.trim() ||
                !firstName.trim() ||
                !lastName.trim() ||
                (!editingDriverProfileId && !password)
              }
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                         hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                         transition-all duration-200"
            >
              {loading
                ? editingDriverProfileId
                  ? "Updating..."
                  : "Creating..."
                : editingDriverProfileId
                  ? "Update Driver"
                  : "Create Driver"}
            </button>

            {editingDriverProfileId && (
              <button
                type="button"
                onClick={resetDriverForm}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-300 bg-white/5 border border-white/10
                           hover:bg-white/10 hover:text-white transition-all duration-200"
              >
                Cancel
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
      </div>

      {/* ── Drivers Registry Table ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Drivers Registry ({drivers.length})
        </h2>

        {drivers.length === 0 ? (
          <p className="text-sm text-gray-500">No drivers registered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Username</th>
                  <th className="py-3 px-4 font-medium">Vehicles</th>
                  <th className="py-3 px-4 font-medium">Zone Rates</th>
                  <th className="py-3 px-4 font-medium">Seller Rates</th>
                  <th className="py-3 px-4 font-medium">Zones</th>
                  <th className="py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {drivers.map((driver) => (
                  <tr
                    key={driver.id}
                    className="hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    <td className="py-3 px-4 text-gray-200">
                      {driver.firstName} {driver.lastName}
                    </td>
                    <td className="py-3 px-4 text-gray-400">
                      {driver.user.username}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {driver.vehicles.length === 0 ? (
                          <span className="text-xs text-gray-600">None</span>
                        ) : (
                          driver.vehicles.map((v) => (
                            <span
                              key={v}
                              className="inline-block px-2 py-0.5 rounded text-[10px] font-medium
                                         bg-white/5 text-gray-400 border border-white/10"
                            >
                              {v.charAt(0) + v.slice(1).toLowerCase()}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {driver.zoneRates.length === 0 ? (
                        <span className="text-xs text-gray-600">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {driver.zoneRates.map((zr) => (
                            <span
                              key={zr.id}
                              className="inline-block px-2 py-0.5 rounded text-[10px] font-medium
                                         bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                            >
                              {zr.zone.name}: ${zr.rate.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {!driver.driverSellerRates ||
                      driver.driverSellerRates.length === 0 ? (
                        <span className="text-xs text-gray-600">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {driver.driverSellerRates.map((sr) => (
                            <span
                              key={sr.merchantId}
                              className="inline-block px-2 py-0.5 rounded text-[10px] font-medium
                                         bg-purple-500/10 text-purple-300 border border-purple-500/20"
                            >
                              {sr.merchant.merchantName}: $
                              {sr.rateUsd.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* Zones column */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {driver.assignedZones?.length === 0 ||
                          !driver.assignedZones ? (
                            <span className="text-xs text-gray-600">None</span>
                          ) : (
                            driver.assignedZones.map((az) => (
                              <span
                                key={az.id}
                                className="inline-block px-2 py-0.5 rounded text-[10px] font-medium
                                           bg-green-500/10 text-green-300 border border-green-500/20"
                              >
                                {az.zone.name}
                              </span>
                            ))
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const currentZoneIds =
                              driver.assignedZones?.map((az) => az.zoneId) ??
                              [];
                            const modal = document.createElement("div");
                            modal.style.cssText =
                              "position:fixed;inset:0;z-50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);";
                            modal.innerHTML = `
                              <div class="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                                <h3 class="text-lg font-semibold text-gray-200 mb-4">Assign Zones</h3>
                                <p class="text-sm text-gray-400 mb-4">Select zones (warehouses) for ${driver.firstName} ${driver.lastName}</p>
                                <div id="zone-list" class="space-y-2 mb-4"></div>
                                <div class="flex gap-3 justify-end">
                                  <button id="zone-cancel" class="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white border border-white/10">Cancel</button>
                                  <button id="zone-save" class="px-4 py-2 rounded-lg text-sm bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30">Save</button>
                                </div>
                              </div>
                            `;
                            document.body.appendChild(modal);
                            const zoneList = modal.querySelector(
                              "#zone-list",
                            ) as HTMLDivElement;
                            if (!zoneList) return;
                            zones.forEach((z) => {
                              const isChecked = currentZoneIds.includes(z.id);
                              const label = document.createElement("label");
                              label.className =
                                "flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10";
                              label.innerHTML = `
                                <input type="checkbox" value="${z.id}" ${isChecked ? "checked" : ""} class="w-4 h-4 rounded border-gray-600 text-cyan-500 focus:ring-cyan-500 bg-gray-800">
                                <span class="text-sm text-gray-300">${z.name}</span>
                              `;
                              zoneList.appendChild(label);
                            });
                            (
                              modal.querySelector(
                                "#zone-cancel",
                              ) as HTMLButtonElement
                            ).onclick = () => document.body.removeChild(modal);
                            (
                              modal.querySelector(
                                "#zone-save",
                              ) as HTMLButtonElement
                            ).onclick = async () => {
                              const checkboxes = zoneList.querySelectorAll(
                                "input[type=checkbox]:checked",
                              );
                              const selectedIds = Array.from(checkboxes).map(
                                (cb: Element) => (cb as HTMLInputElement).value,
                              );
                              document.body.removeChild(modal);
                              await handleAssignZones(driver.id, selectedIds);
                            };
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium
                                     bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-gray-200"
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                    {/* Actions column */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDriverProfileId(driver.id);
                            setDriverId(driver.driverId ?? "");
                            setUsername(driver.user.username);
                            setFirstName(driver.firstName);
                            setLastName(driver.lastName);
                            setPassword("");
                            setSelectedVehicles(driver.vehicles);
                            // Map zoneRates back into assignedRates
                            const ratesMap: Record<string, number> = {};
                            driver.zoneRates.forEach((zr) => {
                              ratesMap[zr.zone.id] = zr.rate;
                            });
                            setAssignedRates(ratesMap);
                            // Populate seller exceptions from existing data
                            const existingExceptions: SellerException[] =
                              driver.driverSellerRates?.map((sr) => ({
                                merchantId: sr.merchantId,
                                rate: sr.rateUsd,
                                merchantName: sr.merchant.merchantName,
                              })) ?? [];
                            setSellerExceptions(existingExceptions);
                            setSelectedMerchant("");
                            setExceptionRate("");
                            // Scroll to form
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                     bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300
                                     border border-amber-500/30 hover:from-amber-500/30 hover:to-amber-600/30
                                     hover:shadow-[0_0_10px_rgba(245,158,11,0.3)]
                                     transition-all duration-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Delete driver "${driver.firstName} ${driver.lastName}"? This action cannot be undone.`,
                              )
                            )
                              return;
                            try {
                              const res = await fetch(
                                `/api/admin/drivers/${driver.id}`,
                                { method: "DELETE" },
                              );
                              if (res.ok) {
                                // Refresh drivers list
                                const dRes = await fetch("/api/admin/drivers");
                                if (dRes.ok) {
                                  const dData = await dRes.json();
                                  setDrivers(dData);
                                }
                              } else {
                                const data = await res.json();
                                alert(data.error || "Failed to delete driver");
                              }
                            } catch {
                              alert("Network error");
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                     bg-gradient-to-r from-red-500/20 to-red-600/20 text-red-300
                                     border border-red-500/30 hover:from-red-500/30 hover:to-red-600/30
                                     hover:shadow-[0_0_10px_rgba(239,68,68,0.3)]
                                     transition-all duration-200"
                        >
                          Delete
                        </button>
                        <Link
                          href={"/drivers/" + driver.driverId.toLowerCase()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                     bg-gradient-to-r from-cyan-500/20 to-cyan-600/20 text-cyan-300
                                     border border-cyan-500/30 hover:from-cyan-500/30 hover:to-cyan-600/30
                                     hover:shadow-[0_0_10px_rgba(6,182,212,0.3)]
                                     transition-all duration-200"
                        >
                          View Profile
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Permission Groups Tab
// ══════════════════════════════════════════════════════════════════════════════
interface PermissionGroup {
  id: string;
  name: string;
  permissions: string[];
  _count?: { users: number };
}

function PermissionGroupsTab() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchGroups = async () => {
    try {
      const res = await fetch("/api/admin/permission-groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
      }
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const togglePerm = (perm: string) => {
    setSelectedPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/permission-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName.trim(),
          permissions: selectedPerms,
        }),
      });

      if (res.ok) {
        setGroupName("");
        setSelectedPerms([]);
        await fetchGroups();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create permission group");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Create Permission Group Form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Create Permission Group
        </h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label
              htmlFor="groupName"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Group Name
            </label>
            <input
              id="groupName"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Finance Team"
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>

          {/* Permission Checkboxes — categorized taxonomy */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Permissions
            </span>
            <div className="space-y-5">
              {Object.entries(PERMISSION_TAXONOMY).map(([category, items]) => {
                const meta = PERMISSION_SECTION_META[category];
                return (
                  <div key={category}>
                    {/* Section Header */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-gray-200 uppercase tracking-wider">
                        {meta.label}
                      </span>
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                    <p className="text-[10px] text-cyan-400/80 mb-2">
                      {meta.description}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {items.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPerms.includes(item.id)}
                            onChange={() => togglePerm(item.id)}
                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500
                                       focus:ring-cyan-500/40 focus:ring-offset-0
                                       cursor-pointer accent-cyan-500"
                          />
                          <span className="group-hover:text-white transition-colors duration-200">
                            {item.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !groupName.trim()}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                       hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                       shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                       transition-all duration-200"
          >
            {loading ? "Creating..." : "Create Group"}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
      </div>

      {/* ── Groups List ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Permission Groups ({groups.length})
        </h2>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500">
            No permission groups created yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Permissions</th>
                  <th className="py-3 px-4 font-medium">Users</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {groups.map((group) => (
                  <tr
                    key={group.id}
                    className="hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    <td className="py-3 px-4 text-gray-200 font-medium">
                      {group.name}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {group.permissions.length === 0 ? (
                          <span className="text-xs text-gray-600">None</span>
                        ) : (
                          group.permissions.map((perm) => (
                            <span
                              key={perm}
                              className="inline-block px-2 py-0.5 rounded text-[10px] font-medium
                                         bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                            >
                              {perm.replace(/_/g, " ")}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-400">
                      {group._count?.users ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Employees Tab
// ══════════════════════════════════════════════════════════════════════════════
function EmployeesTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<
    { id: string; name: string; permissions: string[] }[]
  >([]);
  const [permissionGroupId, setPermissionGroupId] = useState("");
  const [customPermissions, setCustomPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(
    null,
  );

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      // silently fail
    }
  };

  const fetchPermissionGroups = async () => {
    try {
      const res = await fetch("/api/admin/permission-groups");
      if (res.ok) {
        const data = await res.json();
        setPermissionGroups(data);
      }
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchPermissionGroups();
  }, []);

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const toggleGroup = (groupPerms: string[]) => {
    const allSelected = groupPerms.every((p) =>
      selectedPermissions.includes(p),
    );
    setSelectedPermissions((prev) =>
      allSelected
        ? prev.filter((p) => !groupPerms.includes(p))
        : [...prev, ...groupPerms.filter((p) => !prev.includes(p))],
    );
  };

  const toggleCustomPermission = (perm: string) => {
    setCustomPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const resetEmployeeForm = () => {
    setUsername("");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPassword("");
    setLogoFile(null);
    setRole("EMPLOYEE");
    setSelectedPermissions([]);
    setPermissionGroupId("");
    setCustomPermissions([]);
    setEditingEmployeeId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !email) return;
    if (!editingEmployeeId && !password) return;

    setLoading(true);
    setError("");

    try {
      const url = editingEmployeeId
        ? `/api/admin/employees/${editingEmployeeId}`
        : "/api/admin/users";
      const method = editingEmployeeId ? "PUT" : "POST";

      // Use FormData (multipart) so a logo file can be uploaded; the browser
      // sets the multipart boundary automatically (no manual Content-Type).
      const formData = new FormData();
      formData.append("username", username.trim());
      formData.append("role", role);
      formData.append("permissions", JSON.stringify(selectedPermissions));
      formData.append("permissionGroupId", permissionGroupId || "");
      formData.append("customPermissions", JSON.stringify(customPermissions));
      if (!editingEmployeeId) {
        // Create mode: email and password are required
        formData.append("email", email);
        formData.append("password", password);
      } else {
        // Edit mode: email stays unchanged; password optional
        if (password && password.trim()) {
          formData.append("password", password.trim());
        }
      }
      // Append the logo file if it exists (only meaningful for Merchant role)
      if (logoFile) {
        formData.append("logo", logoFile);
      }

      const res = await fetch(url, {
        method,
        // No Content-Type — browser sets multipart boundary automatically
        body: formData,
      });

      if (res.ok) {
        resetEmployeeForm();
        await fetchUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save user");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Create Employee Form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {editingEmployeeId ? "Edit Employee" : "Create Employee"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label
              htmlFor="empUsername"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Username (Login)
            </label>
            <input
              id="empUsername"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jdoe"
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>

          {/* First & Last Name (Display) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="firstName"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
          </div>

          {/* Email & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="empEmail"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Email
              </label>
              <input
                id="empEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="empPassword"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Password
              </label>
              <input
                id="empPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
              {editingEmployeeId && (
                <p className="mt-1 text-[10px] text-gray-500 italic">
                  *(Leave blank to keep current password)*
                </p>
              )}
            </div>
          </div>

          {/* Role */}
          <div>
            <label
              htmlFor="role"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm appearance-none cursor-pointer"
            >
              <option value="EMPLOYEE" className="bg-gray-900">
                EMPLOYEE
              </option>
              <option value="ADMIN" className="bg-gray-900">
                ADMIN
              </option>
              <option value="MERCHANT" className="bg-gray-900">
                MERCHANT
              </option>
            </select>
          </div>

          {/* Merchant Logo (only for Merchant role) */}
          {role === "MERCHANT" && (
            <div>
              <label
                htmlFor="merchantLogo"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Merchant Logo
              </label>
              <input
                id="merchantLogo"
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4
                           file:rounded-lg file:border-0 file:text-sm file:font-semibold
                           file:bg-cyan-500/20 file:text-cyan-300
                           hover:file:bg-cyan-500/30 file:cursor-pointer file:transition-all file:duration-200
                           focus:outline-none"
              />
              {logoFile && (
                <p className="mt-1 text-[10px] text-cyan-400/80">
                  {logoFile.name} selected
                </p>
              )}
            </div>
          )}

          {/* Permission Group */}
          <div>
            <label
              htmlFor="permissionGroupId"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Permission Group
            </label>
            <select
              id="permissionGroupId"
              value={permissionGroupId}
              onChange={(e) => setPermissionGroupId(e.target.value)}
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm appearance-none cursor-pointer"
            >
              <option value="" className="bg-gray-900">
                No group (custom permissions only)
              </option>
              {permissionGroups.map((group) => (
                <option key={group.id} value={group.id} className="bg-gray-900">
                  {group.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-gray-500 italic">
              The selected group's permissions are granted to this user.
            </p>
          </div>

          {/* Permissions */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-3">
              Permissions
            </span>
            <div className="space-y-4">
              {Object.entries(PERMISSION_MAP).map(([category, perms]) => {
                const allSelected = perms.every((p) =>
                  selectedPermissions.includes(p),
                );
                return (
                  <div key={category}>
                    {/* Category Header + Select All */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-bold text-gray-200">
                        {category}
                      </span>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleGroup(perms)}
                          className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-cyan-500
                                     focus:ring-cyan-500/40 focus:ring-offset-0
                                     cursor-pointer accent-cyan-500"
                        />
                        Select All
                      </label>
                    </div>
                    {/* Sub-permissions indented */}
                    <div className="ml-6 flex flex-wrap gap-3">
                      {perms.map((perm) => (
                        <label
                          key={perm}
                          className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(perm)}
                            onChange={() => togglePermission(perm)}
                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500
                                       focus:ring-cyan-500/40 focus:ring-offset-0
                                       cursor-pointer accent-cyan-500"
                          />
                          <span className="group-hover:text-white transition-colors duration-200">
                            {perm.replace(/_/g, " ")}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom Permissions (layered on top of the Permission Group) */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-1.5">
              Custom Permissions
            </span>
            <p className="text-[10px] text-cyan-400/80 mb-3">
              These permissions are added on top of the selected Permission
              Group.
            </p>
            <div className="flex flex-wrap gap-3">
              {SYSTEM_PERMISSIONS.map((perm) => (
                <label
                  key={perm}
                  className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={customPermissions.includes(perm)}
                    onChange={() => toggleCustomPermission(perm)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-500
                               focus:ring-purple-500/40 focus:ring-offset-0
                               cursor-pointer accent-purple-500"
                  />
                  <span className="group-hover:text-white transition-colors duration-200">
                    {perm.replace(/_/g, " ")}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Submit + Cancel */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={
                loading ||
                !username.trim() ||
                !email ||
                (!editingEmployeeId && !password)
              }
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                         hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                         transition-all duration-200"
            >
              {loading
                ? editingEmployeeId
                  ? "Updating..."
                  : "Creating..."
                : editingEmployeeId
                  ? "Update Employee"
                  : "Create Employee"}
            </button>

            {editingEmployeeId && (
              <button
                type="button"
                onClick={resetEmployeeForm}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-300 bg-white/5 border border-white/10
                           hover:bg-white/10 hover:text-white transition-all duration-200"
              >
                Cancel
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
      </div>

      {/* ── Employees Table ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Employees ({users.length})
        </h2>

        {users.length === 0 ? (
          <p className="text-sm text-gray-500">No employees created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Username</th>
                  <th className="py-3 px-4 font-medium">Email</th>
                  <th className="py-3 px-4 font-medium">Role</th>
                  <th className="py-3 px-4 font-medium">Permissions</th>
                  <th className="py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200">{user.username}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-400 font-mono text-xs">
                        {user.username}
                      </span>
                      <span
                        className={`ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                          user.role === "ADMIN"
                            ? "bg-green-400 text-green-900 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                            : "bg-cyan-400 text-cyan-900 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-400">{user.email}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          user.role === "ADMIN"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                            : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {user.permissions.length === 0 ? (
                          <span className="text-xs text-gray-600">None</span>
                        ) : (
                          user.permissions.map((perm) => (
                            <span
                              key={perm}
                              className="inline-block px-2 py-0.5 rounded text-[10px] font-medium
                                         bg-white/5 text-gray-400 border border-white/10"
                            >
                              {perm.replace(/_/g, " ")}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEmployeeId(user.id);
                            setUsername(user.username);
                            setFirstName(user.username.split(" ")[0] || "");
                            setLastName(
                              user.username.split(" ").slice(1).join(" ") || "",
                            );
                            setEmail(user.email);
                            setRole(user.role);
                            setSelectedPermissions(user.permissions);
                            setPermissionGroupId(user.permissionGroupId || "");
                            setCustomPermissions(user.customPermissions || []);
                            setPassword("");
                            setLogoFile(null);
                            // Scroll to form
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                     bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300
                                     border border-amber-500/30 hover:from-amber-500/30 hover:to-amber-600/30
                                     hover:shadow-[0_0_10px_rgba(245,158,11,0.3)]
                                     transition-all duration-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Delete employee "${user.username}"? This action cannot be undone.`,
                              )
                            )
                              return;
                            try {
                              const res = await fetch(
                                `/api/admin/employees/${user.id}`,
                                { method: "DELETE" },
                              );
                              if (res.ok) {
                                await fetchUsers();
                              } else {
                                const data = await res.json();
                                alert(
                                  data.error || "Failed to delete employee",
                                );
                              }
                            } catch {
                              alert("Network error");
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                     bg-gradient-to-r from-red-500/20 to-red-600/20 text-red-300
                                     border border-red-500/30 hover:from-red-500/30 hover:to-red-600/30
                                     hover:shadow-[0_0_10px_rgba(239,68,68,0.3)]
                                     transition-all duration-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
