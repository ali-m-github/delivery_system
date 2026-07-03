import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import DriverClient from "./DriverClient";

export default async function DriverPage() {
  // ── Read & verify session cookie ──────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  if (!token) {
    redirect("/login");
  }

  let userId: string;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    userId = payload.id as string;
  } catch {
    redirect("/login");
  }

  // ── Fetch driver profile with active deliveries & zone rates ──────────
  const driver = await prisma.driverProfile.findUnique({
    where: { userId },
    include: {
      deliveries: {
        where: {
          location: { in: ["ASSIGNED", "WITH_DRIVER", "DELIVERED"] },
          financialStatus: { notIn: ["PS", "WO", "Arc"] },
        },
      },
      zoneRates: true,
    },
  });

  if (!driver) {
    return (
      <div className="max-w-md mx-auto w-full min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 text-lg font-semibold">
            No driver profile found.
          </p>
          <p className="text-gray-500 text-sm mt-2">
            Your account is not linked to a driver profile.
          </p>
        </div>
      </div>
    );
  }

  // ── Serialize for client component ────────────────────────────────────
  const plainDriver = JSON.parse(JSON.stringify(driver));

  return <DriverClient driver={plainDriver} />;
}
