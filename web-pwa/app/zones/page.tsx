import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/server-permissions";
import { compareZoneNames } from "@/lib/zoneSort";
import ZonesClient from "./ZonesClient";

// ─── Server Component ─────────────────────────────────────────────────────────
export default async function ZonesPage() {
  // Admin role check against the CURRENT database role (not the stale
  // 24-hour token claim) so a role change is reflected immediately.
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  if (user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const zones = await prisma.zone.findMany();
  // Natural sort so "Zone 2" comes before "Zone 10" (smallest → largest).
  zones.sort((a, b) => compareZoneNames(a.name, b.name));

  return <ZonesClient zones={zones} />;
}
