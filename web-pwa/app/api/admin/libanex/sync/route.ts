import { NextResponse } from "next/server";
import { requireServerPermission } from "@/lib/server-permissions";
import { runSyncForLinkedSellers } from "@/lib/libanexSync";

/**
 * POST /api/admin/libanex/sync — run the incremental Libanex→PWA sync now
 * (history replay + status refresh for every linked seller).
 *
 * Two ways to call it:
 *  - Admin session with MANAGE_ORDERS (the "Sync now" button on /admin/libanex).
 *  - `Authorization: Bearer $LIBANEX_SYNC_CRON_SECRET` (the 30-minute cron on
 *    the server itself, see scripts/libanex-sync-cron.sh).
 */
export async function POST(request: Request) {
  const cronSecret = process.env.LIBANEX_SYNC_CRON_SECRET;
  const bearer = request.headers.get("authorization") ?? "";
  const isCron = Boolean(cronSecret) && bearer === `Bearer ${cronSecret}`;
  if (!isCron) {
    const auth = await requireServerPermission(request, "MANAGE_ORDERS");
    if (auth instanceof Response) return auth;
  }

  try {
    const results = await runSyncForLinkedSellers();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json(
      { error: `Sync failed: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
