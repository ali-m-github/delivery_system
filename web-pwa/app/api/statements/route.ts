import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { computeOrderProfit, resolveDriverSellerException } from "@/lib/profit";
import { grossUsd, grossLbp } from "@/lib/commission";
import { withConcurrencyRetries } from "@/lib/concurrency";
import {
  requireAuthenticatedSession,
  requireServerPermission,
} from "@/lib/server-permissions";
import { hasPermission } from "@/lib/permissions";

/**
 * Raised when one or more requested order IDs do not belong to the target
 * merchant or are not in the eligible WO lifecycle state. Carries the
 * rejected IDs so the client receives a precise, actionable error.
 */
class InvalidStatementOrdersError extends Error {
  readonly rejectedIds: string[];

  constructor(rejectedIds: string[]) {
    super(
      `The following order ID(s) are not eligible for a merchant statement (must belong to the merchant, be DELIVERED, and have financial status WO): ${rejectedIds.join(", ")}`,
    );
    this.name = "InvalidStatementOrdersError";
    this.rejectedIds = rejectedIds;
  }
}

/** Raised when the requested merchant record does not exist. */
class MerchantNotFoundError extends Error {
  constructor() {
    super("Merchant not found");
    this.name = "MerchantNotFoundError";
  }
}
export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req);
  if (auth instanceof Response) return auth;
  const { searchParams } = new URL(req.url);
  let merchantId = searchParams.get("merchantId");
  const paymentStatus = searchParams.get("paymentStatus");

  // Merchant users can only view statements for their own merchant record;
  // the requested merchantId is always overridden server-side.
  if (auth.user.role === "MERCHANT") {
    const merchant = await prisma.merchant.findFirst({
      where: { userId: auth.user.id },
      select: { id: true },
    });
    if (!merchant) {
      return NextResponse.json(
        { error: "Merchant record not found for this account" },
        { status: 403 },
      );
    }
    merchantId = merchant.id;
  } else if (!hasPermission(auth.user, "MANAGE_FINANCE")) {
    // Every non-merchant role requires the existing finance permission to
    // read merchant statements. ADMIN passes through the standard
    // hasPermission bypass; DRIVER / USER / EMPLOYEE (and any other role
    // without MANAGE_FINANCE via group or custom permissions) are denied.
    // The merchantId query param is only a filter for already-authorized
    // callers — it never grants or narrows authorization by itself.
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }

  try {
    const statements = await prisma.merchantPayout.findMany({
      where: {
        ...(merchantId ? { merchantId } : {}),
        // Optional: filter by payment state. "AVAILABLE" = UNPAID or REJECTED
        // (not approved and not pending approval → can be paid / deducted).
        ...(paymentStatus
          ? paymentStatus === "AVAILABLE"
            ? {
                paymentStatus: {
                  notIn: ["PAID", "PENDING_APPROVAL"],
                },
              }
            : { paymentStatus }
          : {}),
      },
      include: {
        merchant: {
          include: { zoneRates: true },
        },
        orders: {
          include: { driver: true, zone: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(statements, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch statements." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireServerPermission(req, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    // NOTE: only IDs are accepted from the client. The client may also send
    // totalUsd/totalLbp/shippingUsd/shippingLbp/netUsd/netLbp/profitUsd for
    // display convenience, but they are deliberately NOT destructured here —
    // every financial figure is re-derived from the database inside the
    // transaction below. Client-computed money is never the source of truth.
    const { merchantId, orderIds } = body;

    // 1. Validate Input
    if (
      !merchantId ||
      !orderIds ||
      !Array.isArray(orderIds) ||
      orderIds.length === 0
    ) {
      return NextResponse.json(
        { error: "merchantId and orderIds (non-empty array) are required" },
        { status: 400 },
      );
    }
    if (orderIds.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { error: "orderIds must be an array of strings" },
        { status: 400 },
      );
    }

    // 2. The GLOBALLY-unique sequential index (so statement numbers never
    //    collide across sellers, e.g., CashTest #1 vs Tloba #1) is computed
    //    INSIDE the transaction below — max across ALL statements + 1 — so a
    //    concurrent creation cannot land between the read and the INSERT.
    //    The new MerchantPayout.sequentialIndex unique constraint turns any
    //    remaining race into a P2002, which withConcurrencyRetries re-runs.

    // 3. Execute the Atomic Transaction
    // An atomic transaction ensures that if the orders fail to update, the statement is NOT created (preventing ghost ledgers).
    //
    // SECURITY: every financial figure (total / shipping / net / profit) is
    // derived INSIDE this transaction from the authoritative DB rows — the
    // orders themselves, the merchant's configured rates, and the driver
    // exceptions. Client-supplied money values (totalUsd, totalLbp, shippingUsd,
    // shippingLbp, netUsd, netLbp, profitUsd) are intentionally ignored.
    //
    // The transaction also performs a strict completeness check: if ANY
    // requested order ID does not belong to the merchant or is not in the
    // eligible WO state, the whole batch is rejected and rolled back — a
    // statement is never created from a partial match.
    const transaction = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        // A0. Merchant must exist (also rejects cross-merchant spoofing early).
        const merchant = await tx.merchant.findUnique({
          where: { id: merchantId },
          select: {
            id: true,
            isCashSeller: true,
            defaultSellerRate: true,
            defaultProfitRate: true,
            zoneRates: true,
          },
        });
        if (!merchant) throw new MerchantNotFoundError();

        // Deduplicate requested IDs so a hostile client cannot double-count.
        const requestedIds: string[] = Array.from(new Set(orderIds));

        // A1. Fetch only the orders that are genuinely eligible for this
        // merchant's statement: must belong to this merchant, be DELIVERED,
        // and have financial status WO (With Office = cleared by the driver).
        const orders = await tx.order.findMany({
          where: {
            id: { in: requestedIds },
            merchantId,
            location: "DELIVERED",
            financialStatus: "WO",
          },
          orderBy: { id: "asc" },
        });

        // Reject the whole batch if ANY requested ID is missing or ineligible.
        if (orders.length !== requestedIds.length) {
          const validIds = new Set(orders.map((o) => o.id));
          const rejectedIds = requestedIds.filter((id) => !validIds.has(id));
          throw new InvalidStatementOrdersError(rejectedIds);
        }

        // ── Server-derived financials (client values are NEVER trusted) ─────
        // Gross collected per order via the authoritative grossUsd/grossLbp
        // rule (lib/commission.ts): a POSITIVE `collected*` is authoritative,
        // otherwise the order amount — the schema default for collected* is 0,
        // so a `??` fallback alone would under-report the ledger total.
        let totalUsd = 0;
        let totalLbp = 0;
        for (const o of orders) {
          totalUsd += grossUsd(o);
          totalLbp += grossLbp(o);
        }

        // Shipping deducted from the seller, per order, from the merchant's
        // own configured rates:
        //  - Cash sellers: flat fee = defaultSellerRate + defaultProfitRate.
        //  - Otherwise: the merchant's zone rate (USD + LBP) for the order's
        //    zone; 0 when the merchant has no rate configured for that zone
        //    (mirrors the live UI calculator).
        const zoneRateMap = new Map<string, { usd: number; lbp: number }>();
        for (const zr of merchant.zoneRates) {
          zoneRateMap.set(String(zr.zoneId), {
            usd: Number(zr.rate) || 0,
            lbp: Number(zr.rateLbp) || 0,
          });
        }
        const cashFeeUsd = merchant.isCashSeller
          ? (Number(merchant.defaultSellerRate) || 0) +
            (Number(merchant.defaultProfitRate) || 0)
          : 0;

        let shippingUsd = 0;
        let shippingLbp = 0;
        for (const o of orders) {
          if (merchant.isCashSeller) {
            shippingUsd += cashFeeUsd;
            continue;
          }
          const zr = zoneRateMap.get(String(o.zoneId));
          if (zr) {
            shippingUsd += zr.usd;
            shippingLbp += zr.lbp;
          }
        }

        const netUsd = totalUsd - shippingUsd;
        const netLbp = totalLbp - shippingLbp;

        // A2. Company profit: profitRate per order, EXCEPT orders where the
        // driver's seller rate exception equals (sellerRate + profitRate) —
        // those contribute 0 profit (the driver keeps the whole fee).
        // Profit rules live in lib/profit.ts and are unchanged.
        let profitUsd = 0;
        for (const o of orders) {
          const driverException = await resolveDriverSellerException(
            o.driverId,
            merchantId,
          );
          profitUsd += computeOrderProfit(
            {
              defaultSellerRate: merchant.defaultSellerRate ?? 0,
              defaultProfitRate: merchant.defaultProfitRate ?? 0,
            },
            driverException,
          );
        }

        // A. Create the Payout Ledger Entry
        // Next global index, read inside the transaction (max + 1 across all
        // statements). The unique constraint on sequentialIndex plus the P2002
        // retry guarantee two concurrent statements never get the same number.
        const lastPayout = await tx.merchantPayout.findFirst({
          orderBy: { sequentialIndex: "desc" },
        });
        const nextIndex = lastPayout ? lastPayout.sequentialIndex + 1 : 1;

        const payout = await tx.merchantPayout.create({
          data: {
            merchantId,
            sequentialIndex: nextIndex,
            totalUsd,
            totalLbp,
            shippingUsd,
            shippingLbp,
            netUsd,
            netLbp,
            profitUsd,
            status: "PAID",
          },
        });

        // B. Update the Selected Orders
        // Locks them to the new payout ID and changes financial status to PS (Paid to Seller).
        // The WHERE clause re-checks the lifecycle state so a concurrent
        // status change cannot be silently swept into this statement.
        await tx.order.updateMany({
          where: {
            id: { in: requestedIds },
            merchantId,
            location: "DELIVERED",
            financialStatus: "WO",
          },
          data: {
            financialStatus: "PS",
            merchantPayoutId: payout.id,
          },
        });

        return payout;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
    );

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidStatementOrdersError) {
      // The transaction was rolled back; nothing was created.
      return NextResponse.json(
        { error: error.message, rejectedOrderIds: error.rejectedIds },
        { status: 400 },
      );
    }
    if (error instanceof MerchantNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 },
      );
    }
    console.error("Payout Transaction Error:", error);
    return NextResponse.json(
      { error: "Failed to process settlement." },
      { status: 500 },
    );
  }
}
