import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Raised when the payout left PENDING between our read and our CAS write,
// i.e. a concurrent settle/clear/void raced us. Mapped to 409 in the
// handler catch so the caller can refresh instead of seeing a 500.
class AlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyProcessedError";
  }
}

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// PATCH /api/drivers/[id]/payouts/[payoutId] — Approve & settle a payout
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; payoutId: string }> },
) {
  const auth = await requireServerPermission(request, "DRIVERS_PAYOUT");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const { id: identifier, payoutId } = resolvedParams;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;

    const body = await request.json();
    const { status } = body;

    if (status !== "CLEARED") {
      return NextResponse.json(
        { error: "Only CLEARED status is supported via this endpoint" },
        { status: 400 },
      );
    }

    // Verify the payout exists and belongs to this driver
    const existing = await prisma.driverPayout.findUnique({
      where: { id: payoutId },
    });

    if (!existing || existing.driverId !== driverId) {
      return NextResponse.json(
        { error: "Payout not found for this driver" },
        { status: 404 },
      );
    }

    if (existing.status === "CLEARED") {
      return NextResponse.json(
        { error: "Payout is already cleared" },
        { status: 409 },
      );
    }

    // ── Source-state restriction (fix C) ────────────────────────────────────
    // This is the legacy direct-clear path. Only a PENDING (mutable) payout
    // may be cleared here: a PENDING_APPROVAL payout already has settlement
    // figures (amountPaid / remaining / debt carryover) recorded by the
    // settlements endpoint, and a SETTLED payout already has its treasury
    // posting made by the approve endpoint — flipping either to CLEARED
    // would produce a second, unposted "cleared" record diverging from the
    // ledger. Those payouts must use their own approve/void workflows.
    if (existing.status !== "PENDING") {
      return NextResponse.json(
        {
          error: `Only PENDING payouts can be cleared through this endpoint. This payout is "${existing.status}" — use the settlements approve/void workflow instead.`,
        },
        { status: 409 },
      );
    }

    // Approve the payout and clear the driver's ledger in a transaction.
    // The status update is a CAS on PENDING so a concurrent settle/clear
    // landing between the read above and the write rolls the whole unit back.
    const result = await prisma.$transaction(async (tx) => {
      // Update payout status (CAS: only legal from PENDING)
      const updatedCount = await tx.driverPayout.updateMany({
        where: { id: payoutId, status: "PENDING" },
        data: {
          status: "CLEARED",
          clearedAt: new Date(),
        },
      });
      if (updatedCount.count === 0) {
        throw new AlreadyProcessedError(
          "Payout state changed concurrently; please refresh and retry",
        );
      }

      // Clear the driver's ledger: mark linked orders as WO (With Office).
      // Cash is now in company treasury, awaiting processing for the merchant.
      await tx.order.updateMany({
        where: {
          driverPayoutId: payoutId,
          driverId,
        },
        data: {
          financialStatus: "WO",
        },
      });

      // Re-read with its orders for the response (the CAS update above
      // returns only a count, not the row).
      return tx.driverPayout.findUnique({
        where: { id: payoutId },
        include: { orders: true },
      });
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AlreadyProcessedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("PATCH /api/drivers/[id]/payouts/[payoutId] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
