// ─── Shared Tesseract worker pool ────────────────────────────────────────────
//
// Why this exists: `Tesseract.recognize()` is a convenience wrapper that, on
// EVERY call, spawns a fresh worker thread, boots the WASM core, re-loads the
// language model and then throws all of it away
// (node_modules/tesseract.js/src/Tesseract.js — createWorker → recognize →
// terminate). The waybill route called it once per rotation (up to 4× per
// image), so a batch of hundreds of photos paid that startup cost thousands of
// times over: the engine boot dominated the runtime, not the character
// recognition itself.
//
// A long-lived pool amortises that cost — the language model is loaded once per
// worker and every later job is just the OCR. `createScheduler` queues jobs
// across the workers, so concurrent uploads share the engines instead of each
// spawning their own.
//
// Each worker holds a WASM instance plus the traineddata, so the pool is small
// by default and idles itself out after a few idle minutes to keep dev servers
// from leaking memory.
//
// Tunables (env):
//   OCR_WORKER_POOL_SIZE  workers kept warm, 1–4 (default 2)
//   OCR_WORKER_IDLE_MS    idle ms before the pool is torn down (default 300000)

import type Tesseract from "tesseract.js";

type OcrScheduler = Tesseract.Scheduler;

interface OcrPool {
  scheduler: OcrScheduler;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Read an integer env override, clamped into a safe range. A malformed value
 * falls back to the default rather than producing a 0-worker pool.
 */
function envInt(name: string, min: number, max: number, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const POOL_SIZE = envInt("OCR_WORKER_POOL_SIZE", 1, 4, 2);
const IDLE_SHUTDOWN_MS = envInt("OCR_WORKER_IDLE_MS", 10_000, 3_600_000, 300_000);

// Held on globalThis so Next.js dev-mode HMR (which re-evaluates route modules
// on every edit) does not orphan the previous pool's worker threads.
type GlobalWithOcrPool = typeof globalThis & {
  __deliveryOcrPool?: Promise<OcrPool> | null;
};
const globalStore = globalThis as GlobalWithOcrPool;

/**
 * Tear the pool down once nothing has asked it for work in a while, so the
 * WASM workers do not sit resident forever between upload batches.
 */
function armIdleShutdown(pool: OcrPool): void {
  if (pool.idleTimer) clearTimeout(pool.idleTimer);
  pool.idleTimer = setTimeout(() => {
    pool.idleTimer = null;
    globalStore.__deliveryOcrPool = null;
    void pool.scheduler.terminate().catch(() => {
      /* terminating an already-dead worker is not actionable */
    });
    console.log("[ocr] idle — Tesseract worker pool released");
  }, IDLE_SHUTDOWN_MS);
  // Never keep the process alive just for an idle OCR pool.
  pool.idleTimer.unref?.();
}

async function createPool(): Promise<OcrPool> {
  // Lazy import keeps the WASM engine out of this module's initial graph.
  const tesseract = (await import("tesseract.js")).default;

  const scheduler = tesseract.createScheduler();
  for (let i = 0; i < POOL_SIZE; i++) {
    // `oem` is intentionally omitted: the library default is LSTM_ONLY, which
    // is exactly what Tesseract.recognize() used before, so accuracy is
    // unchanged. Language data resolves through tesseract.js' own cache
    // (`eng.traineddata` in the project root), falling back to its CDN on a
    // fresh install.
    const worker = await tesseract.createWorker("eng", undefined, {
      logger: () => {},
    });
    scheduler.addWorker(worker);
  }

  console.log(`[ocr] warmed ${POOL_SIZE} Tesseract worker(s)`);
  return { scheduler, idleTimer: null };
}

/**
 * Get the shared OCR scheduler, creating the pool on first use.
 *
 * The pool is memoised on `globalThis`; a failed creation resets the memo so a
 * later request can retry instead of being permanently poisoned.
 */
export async function getOcrScheduler(): Promise<OcrScheduler> {
  if (!globalStore.__deliveryOcrPool) {
    globalStore.__deliveryOcrPool = createPool().catch((err) => {
      globalStore.__deliveryOcrPool = null;
      throw err;
    });
  }

  const pool = await globalStore.__deliveryOcrPool;
  armIdleShutdown(pool);
  return pool.scheduler;
}

/** Diagnostics for the pool state (worker count + queued jobs). */
export async function getOcrPoolStats(): Promise<{ workers: number; queued: number }> {
  const pending = globalStore.__deliveryOcrPool;
  if (!pending) return { workers: 0, queued: 0 };
  const pool = await pending;
  return { workers: pool.scheduler.getNumWorkers(), queued: pool.scheduler.getQueueLen() };
}
