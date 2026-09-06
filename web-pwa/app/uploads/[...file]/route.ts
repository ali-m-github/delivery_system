import { serveUploadedFile } from "@/lib/uploads";

// ─────────────────────────────────────────────────────────────────────────────
// GET /uploads/[...file]
//
// Serves uploaded assets (merchant logos, driver photos, waybill proofs)
// stored under `public/uploads/`.
//
// Why this route exists: Next.js 16's production server (`next start`) only
// serves `public/` files that existed when the server process started.
// Anything uploaded at runtime (e.g. a new merchant logo) returns 404 until
// the server is restarted — which is why freshly uploaded logos rendered as
// broken images on jett.delivery while previously uploaded ones kept working.
//
// Route handlers are not cached by default, so every request is a live
// filesystem read and newly uploaded files are served immediately.
//
// NOTE: the auth middleware (middleware.ts) intentionally does NOT match
// `/uploads/:path*` — these asset URLs are referenced directly from <img>
// tags and must load without a session cookie.
// ─────────────────────────────────────────────────────────────────────────────

// Defensive: force request-time execution even if a future config change
// (e.g. enabling cacheComponents) would otherwise try to prerender this GET.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string[] }> },
) {
  const { file } = await params;
  const res = await serveUploadedFile(file.join("/"));
  if (!res) return new Response("Not Found", { status: 404 });
  return res;
}
