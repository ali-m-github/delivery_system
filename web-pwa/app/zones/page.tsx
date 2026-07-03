import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { verifySessionToken } from "@/helpers/auth";
import ZonesClient from "./ZonesClient";

// ─── Server Component ─────────────────────────────────────────────────────────
export default async function ZonesPage() {
  // Admin role check via session cookie
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  const payload = await verifySessionToken(sessionToken);
  if (!payload || payload.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const zones = await prisma.zone.findMany({
    orderBy: { name: "asc" },
  });

  return <ZonesClient zones={zones} />;
}
