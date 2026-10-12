/**
 * Bulk waybill import from a server folder.
 *
 * Does exactly what the "Upload Waybill" button does — read each photo's QR
 * code (falling back to OCR), resolve the order ID, attach the image to that
 * order — but reads the images from a directory on disk instead of a browser
 * upload. It calls the same `processWaybillFile()` from lib/waybill-ocr.ts, so
 * results are identical through either path.
 *
 * Usage:
 *   npx ts-node --compilerOptions '{"module":"commonjs"}' \
 *     scripts/import-waybills-from-folder.ts /path/to/waybill-photos [options]
 *
 * Options:
 *   --dry-run          Extract and report, but write nothing (no file, no DB update).
 *   --limit <n>        Process at most n files (useful for a first spot check).
 *   --concurrency <n>  Files processed at once, 1-4 (default 2, matches the OCR pool).
 *   --move             On success, move the source image into <folder>/processed/.
 *   --force            Re-process files already recorded in the state file.
 *   --no-recursive     Only read the top-level directory (default: recursive).
 *
 * A state file (`<folder>/.waybill-import-state.json`) records what has already
 * been processed, so an interrupted run can be resumed without re-OCRing
 * hundreds of images.
 */

import { readdir, stat, readFile, writeFile, mkdir, rename } from "fs/promises";
import path from "path";
import {
  processWaybillFile,
  WAYBILL_UPLOAD_DIR,
  type WaybillResult,
} from "../lib/waybill-ocr";
import prisma from "../lib/prisma";

// Scripts run outside Next.js, so nothing has loaded .env for us. DATABASE_URL
// and OCR_SPACE_API_KEY come from there, so load it before anything connects.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // No .env (or already provided by the shell) — rely on the real environment.
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const STATE_FILENAME = ".waybill-import-state.json";

interface CliOptions {
  folder: string;
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
  move: boolean;
  force: boolean;
  recursive: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const opts: CliOptions = {
    folder: "",
    dryRun: false,
    limit: null,
    concurrency: 2,
    move: false,
    force: false,
    recursive: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--move":
        opts.move = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--no-recursive":
        opts.recursive = false;
        break;
      case "--limit":
      case "--concurrency": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`${arg} requires a positive number`);
        }
        if (arg === "--limit") opts.limit = value;
        else opts.concurrency = Math.min(4, Math.max(1, value));
        break;
      }
      case "--help":
      case "-h":
        throw new Error("HELP");
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  if (positional.length !== 1) throw new Error("Exactly one folder path is required");
  opts.folder = path.resolve(positional[0]);
  return opts;
}

/** Collect image files under `dir`, skipping the state file and processed/. */
async function collectImages(
  dir: string,
  recursive: boolean,
): Promise<{ name: string; absPath: string }[]> {
  const out: { name: string; absPath: string }[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Never re-import our own output or the archive folder.
      if (entry.name === "processed") continue;
      if (recursive) out.push(...(await collectImages(absPath, recursive)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === STATE_FILENAME) continue;
    if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    out.push({ name: entry.name, absPath });
  }

  return out;
}

/** Stable identity for a file, so a resumed run can skip what it already did. */
function stateKey(name: string, size: number, mtimeMs: number): string {
  return `${name}|${size}|${Math.round(mtimeMs)}`;
}

interface StateFile {
  [key: string]: { fileName: string; orderId: string; at: string };
}

async function loadState(statePath: string): Promise<StateFile> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as StateFile;
  } catch {
    return {};
  }
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function main() {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "HELP") {
      console.log(
        "Usage: npx ts-node --compilerOptions '{\"module\":\"commonjs\"}' scripts/import-waybills-from-folder.ts <folder> [--dry-run] [--limit n] [--concurrency n] [--move] [--force] [--no-recursive]",
      );
      await prisma.$disconnect();
      process.exit(0);
    }
    console.error(message);
    console.error(
      "Usage: npx ts-node --compilerOptions '{\"module\":\"commonjs\"}' scripts/import-waybills-from-folder.ts <folder> [--dry-run] [--limit n] [--concurrency n] [--move] [--force] [--no-recursive]",
    );
    await prisma.$disconnect();
    process.exit(1);
    return;
  }

  // Fail fast on a bad folder rather than after loading the OCR engine.
  const dirInfo = await stat(opts.folder).catch(() => null);
  if (!dirInfo?.isDirectory()) {
    console.error(`Not a directory: ${opts.folder}`);
    await prisma.$disconnect();
    process.exit(1);
    return;
  }

  const images = await collectImages(opts.folder, opts.recursive);
  if (images.length === 0) {
    console.log(`No images (${[...IMAGE_EXTENSIONS].join(", ")}) found in ${opts.folder}`);
    await prisma.$disconnect();
    return;
  }

  const statePath = path.join(opts.folder, STATE_FILENAME);
  const state = await loadState(statePath);

  // Carry the file's stat alongside its path: with --move the source is renamed
  // away during processing, and the state key must still be computable then.
  const pending: { name: string; absPath: string; size: number; mtimeMs: number }[] = [];
  let skipped = 0;
  for (const img of images) {
    const info = await stat(img.absPath);
    if (!opts.force && state[stateKey(img.name, info.size, info.mtimeMs)]) {
      skipped++;
      continue;
    }
    pending.push({ ...img, size: info.size, mtimeMs: info.mtimeMs });
  }

  const queue = opts.limit ? pending.slice(0, opts.limit) : pending;

  console.log(
    `[import] found ${images.length} image(s), ${skipped} already processed, ${queue.length} to process` +
      `${opts.dryRun ? " (DRY RUN — nothing will be written)" : ""}`,
  );
  if (queue.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const uploadDir = path.join(process.cwd(), WAYBILL_UPLOAD_DIR);
  await mkdir(uploadDir, { recursive: true });

  const startedAt = Date.now();
  const results: WaybillResult[] = [];
  let done = 0;

  await mapWithConcurrency(queue, opts.concurrency, async (img) => {
    const buffer = await readFile(img.absPath);
    // The shared pipeline takes a File, exactly like the upload route, so the
    // magic-byte validation and size limits behave identically here.
    const file = new File([buffer], img.name, { type: "image/jpeg" });

    const result = await processWaybillFile(file, {
      uploadDir,
      dryRun: opts.dryRun,
    });
    results.push(result);

    done++;
    console.log(
      `[import] ${done}/${queue.length} ${result.success ? "OK" : "FAIL"} ${img.name}${
        result.orderId ? ` → ${result.orderId}` : ` (${result.code ?? "unknown"})`
      }`,
    );

    // Archive the source only once it is genuinely attached, so a failure
    // leaves the file in place for a retry.
    if (result.success && !result.dryRun && opts.move) {
      const archiveDir = path.join(path.dirname(img.absPath), "processed");
      await mkdir(archiveDir, { recursive: true });
      await rename(img.absPath, path.join(archiveDir, img.name));
    }

    // Persist progress after every file: an interrupted run resumes cleanly.
    // The key uses the stat captured before processing, so --move (which
    // renames the source away) does not silently disable resumption.
    if (result.success && result.orderId && !result.dryRun) {
      state[stateKey(img.name, img.size, img.mtimeMs)] = {
        fileName: img.name,
        orderId: result.orderId,
        at: new Date().toISOString(),
      };
      await writeFile(statePath, JSON.stringify(state, null, 2));
    }

    return result;
  });

  // ── Summary, grouped by reason like the web report ────────────────────────
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n===== IMPORT ${opts.dryRun ? "(DRY RUN) " : ""}SUMMARY =====`);
  console.log(
    `Processed ${results.length} file(s) in ${elapsedSec}s — ${succeeded.length} matched, ${failed.length} not matched`,
  );

  if (succeeded.length > 0) {
    console.log("\nMatched:");
    for (const r of succeeded) {
      console.log(`  ${r.fileName} → ${r.orderId}${r.dryRun ? " (would attach)" : ""}`);
    }
  }

  if (failed.length > 0) {
    const groups = new Map<string, WaybillResult[]>();
    for (const r of failed) {
      const key = r.code ?? "unknown";
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    console.log("\nNot matched:");
    for (const [code, items] of groups) {
      console.log(`  ${code} (${items.length}):`);
      for (const item of items) {
        const cands = item.candidates?.length ? ` | read: ${item.candidates.join(", ")}` : "";
        console.log(`    - ${item.fileName}: ${item.error ?? "no reason"}${cands}`);
      }
    }
  }

  await prisma.$disconnect();
  // Non-zero exit when nothing matched, so a shell script can detect a bad batch.
  process.exit(failed.length === results.length ? 1 : 0);
}

void main();
