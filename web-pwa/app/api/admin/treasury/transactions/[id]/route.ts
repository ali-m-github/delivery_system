import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

// GET /api/admin/treasury/transactions/[id] — Full detail for a single
// TreasuryTransaction, including the user who created it, its treasury box,
// and — when the transaction references a DriverPayout — the full payout detail
// (driver, amounts, orders) so the UI can render a "View Details" view.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ── Server-side RBAC: require PAGE_ADMIN_TREASURY before exposing the
    //    sensitive cashbox/ledger detail view ──
    const auth = await requireServerPermission(request, "PAGE_ADMIN_TREASURY");
    if (auth instanceof Response) return auth;

    const resolvedParams = await params;
    const { id } = resolvedParams;

    if (!id) {
      return NextResponse.json(
        { error: "Missing transaction id" },
        { status: 400 },
      );
    }

    const transaction = await prisma.treasuryTransaction.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, username: true } },
        box: { select: { id: true, name: true, isPositive: true } },
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 },
      );
    }

    // ── Resolve payout detail when the transaction references a DriverPayout ──
    let payout: unknown = null;
    let statement: unknown = null;

    if (transaction.referenceId) {
      const foundPayout = await prisma.driverPayout.findUnique({
        where: { id: transaction.referenceId },
        include: {
          driver: {
            select: {
              id: true,
              driverId: true,
              firstName: true,
              lastName: true,
              user: { select: { email: true } },
            },
          },
          orders: {
            select: {
              id: true,
              orderId: true,
              customerName: true,
              customerPhone: true,
              customerAddress: true,
              amountUsd: true,
              amountLbp: true,
              collectedUsd: true,
              collectedLbp: true,
              location: true,
              financialStatus: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (foundPayout) {
        payout = foundPayout;
      } else {
        // The reference may be a MerchantPayout (statement) instead.
        const foundStatement = await prisma.merchantPayout.findUnique({
          where: { id: transaction.referenceId },
          include: {
            merchant: { select: { merchantName: true } },
            orders: {
              select: {
                id: true,
                orderId: true,
                customerName: true,
                amountUsd: true,
                amountLbp: true,
                collectedUsd: true,
                collectedLbp: true,
                financialStatus: true,
              },
              orderBy: { createdAt: "desc" },
            },
          },
        });
        if (foundStatement) statement = foundStatement;
      }
    }

    return NextResponse.json(
      {
        transaction,
        payout,
        statement,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("GET treasury transaction detail error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
