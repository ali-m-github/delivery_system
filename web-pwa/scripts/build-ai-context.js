#!/usr/bin/env node
"use strict";

/**
 * build-ai-context.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds a compact plain-text "map" of this project so an external AI (Gemini,
 * ChatGPT, …) can understand the whole site without reading the whole site.
 *
 * This is a standalone Node script. It is NOT part of the Next.js app, it has
 * no dependencies, and it only READS files. Running it cannot change the site.
 *
 * Usage (from the project root):
 *   node scripts/build-ai-context.js
 *   node scripts/build-ai-context.js --focus app/orders/page.tsx lib/commission.ts
 *
 * Output (both are git-ignored, safe to delete at any time):
 *   ai-context/AI-CONTEXT.md   the map — always regenerated
 *   ai-context/AI-FOCUS.md     full source of the --focus files, when requested
 *
 * Why it is shaped this way: the full source of this project is far larger than
 * any consumer AI context window, so the map carries the *inventory* (what
 * exists, where it lives, what the public interfaces are) instead of the bodies.
 * The bodies are only added for the specific files you are working on.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "ai-context");

// ── What to skip ─────────────────────────────────────────────────────────────
// data/ holds ~350k lines of real order records and scripts/ holds one-off data
// repairs. Neither describes how the site is built, and data/ alone is bigger
// than any AI context window.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-dev",
  ".git",
  ".vscode",
  "data",
  "scripts",
  "public",
  "ai-context",
  "generated",
  "coverage",
  "build",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "eng.traineddata",
  ".env",
  "tsconfig.tsbuildinfo",
]);
const IGNORED_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".jsonl",
  ".csv",
  ".log",
  ".gz",
  ".bat",
  ".sh",
  ".sql",
  ".txt",
]);

// Included in full because they are the rules of the system, not its bulk.
const FULL_SOURCE = [
  "AGENTS.md",
  "README.md",
  "middleware.ts",
  "package.json",
  "prisma/schema.prisma",
];

// ── Small helpers ────────────────────────────────────────────────────────────

function isIgnoredFile(rel) {
  if (IGNORED_FILES.has(path.basename(rel))) return true;
  if (IGNORED_EXT.has(path.extname(rel))) return true;
  // prisma/ is only interesting for the schema; migrations are history.
  if (rel.startsWith("prisma/") && rel !== "prisma/schema.prisma") return true;
  // Root-level JSON files are service-account credentials, not app code.
  if (!rel.includes("/") && rel.endsWith(".json")) return true;
  return false;
}

function walk(dir, base, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(abs, base, out);
    } else {
      if (isIgnoredFile(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

function readLines(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

/** First meaningful comment near the top of a file, used as its description. */
function firstComment(lines) {
  const limit = Math.min(lines.length, 80);
  for (let i = 0; i < limit; i++) {
    const t = lines[i].trim();
    if (t.startsWith("/**")) {
      const inline = t.replace(/^\/\*\*?\s*/, "").replace(/\s*\*\/$/, "").trim();
      if (inline) return inline;
      for (let j = i + 1; j < limit; j++) {
        const c = lines[j]
          .trim()
          .replace(/^\/?\*\/?\s*/, "")
          .trim();
        if (c && !c.startsWith("@")) return c;
        if (lines[j].includes("*/")) break;
      }
    }
    if (t.startsWith("//")) {
      const c = t.replace(/^\/\/+\s*/, "").trim();
      if (!c) continue;
      if (/^["']?use (client|server)/i.test(c)) continue;
      if (c.startsWith("eslint-")) continue;
      if (/^[-─═\s]+$/.test(c)) continue;
      return c;
    }
  }
  return "";
}

/** Deterministic label derived from the path, used when there is no comment. */
function labelFor(rel) {
  if (rel.startsWith("app/api/") && rel.endsWith("/route.ts")) {
    return `API endpoint ${routePath(rel)}`;
  }
  if (rel === "app/page.tsx") return "Page / (landing)";
  if (rel.endsWith("/page.tsx")) {
    return `Page /${rel.slice("app/".length, -"/page.tsx".length)}`;
  }
  if (rel.endsWith("/layout.tsx")) return "Root layout";
  if (rel.startsWith("app/actions/")) return `Server action ${rel}`;
  if (rel.startsWith("components/")) {
    return `Shared component ${path.basename(rel, path.extname(rel))}`;
  }
  if (rel.startsWith("lib/validations/")) return `Validation schema ${rel}`;
  if (rel.startsWith("lib/notifications/")) return `Notification module ${rel}`;
  if (rel.startsWith("lib/")) return `Business rule module ${rel}`;
  if (rel.startsWith("helpers/")) return `Helper ${rel}`;
  if (rel.startsWith("plans/")) return "Feature plan document";
  if (rel.endsWith("/route.ts")) return `Route handler ${rel}`;
  return rel;
}

/** app/api/orders/route.ts → /api/orders */
function routePath(rel) {
  return "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
}

/**
 * Description for a route handler: the first comment that actually names the
 * endpoint (this project writes headers like `// ─── POST /api/... ───`).
 * Falls back to "" so callers use the deterministic label instead of an
 * unrelated comment that happens to sit above an import.
 */
function routeDescription(lines, rel) {
  const rp = routePath(rel);
  const limit = Math.min(lines.length, 120);
  for (let i = 0; i < limit; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/**")) {
      continue;
    }
    const c = t
      .replace(/^\/\*+/, "")
      .replace(/\*\/$/, "")
      .replace(/^\/\/+\s*/, "")
      .replace(/^\*\s?/, "")
      .trim();
    if (!c || /^[-─═\s]+$/.test(c)) continue;
    if (c.includes(rp) || /^[A-Z]{3,7}\b/.test(c)) return c;
  }
  return "";
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function exportedMethods(lines) {
  const found = [];
  for (const line of lines) {
    const m = line.match(
      /^export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/,
    );
    if (m && HTTP_METHODS.includes(m[1]) && !found.includes(m[1])) {
      found.push(m[1]);
    }
  }
  return found;
}

/**
 * Capture a declaration's *signature* without its body: stop at the first "{"
 * (so function bodies are dropped), at a closing ";", or after a few lines.
 * Array literals are flattened onto one line, because the values themselves are
 * the useful part (e.g. the permission catalog).
 */
function signatureAt(lines, start) {
  const first = lines[start];
  // Re-export blocks like `export { a, b };` — the names ARE the interface.
  if (/^export\s+\{/.test(first)) {
    const parts = [];
    for (let j = start; j < Math.min(lines.length, start + 40); j++) {
      parts.push(lines[j].trim());
      if (lines[j].includes("}")) break;
    }
    const flat = parts.join(" ").replace(/\s+/g, " ");
    return flat.length > 320 ? `${flat.slice(0, 320)} …}` : flat;
  }
  if (first.includes("[")) {
    const parts = [];
    for (let j = start; j < Math.min(lines.length, start + 40); j++) {
      parts.push(lines[j].trim());
      if (lines[j].includes("]")) break;
    }
    const flat = parts.join(" ").replace(/\s+/g, " ");
    return flat.length > 320 ? `${flat.slice(0, 320)} …]` : flat;
  }
  const out = [];
  for (let j = start; j < Math.min(lines.length, start + 7); j++) {
    out.push(lines[j].replace(/\s+$/, ""));
    if (lines[j].includes("{") || lines[j].trim().endsWith(";")) break;
  }
  return out.join("\n");
}

/** Public interface of a module: every export, without any implementation. */
function moduleSurface(rel) {
  const lines = readLines(rel);
  const blocks = [];
  let doc = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (t.startsWith("/**") || t.startsWith("/*")) {
      const collected = [];
      let j = i;
      while (j < lines.length) {
        const c = lines[j]
          .trim()
          .replace(/^\/\*\*?\s*/, "")
          .replace(/\s*\*\/$/, "")
          .replace(/^\*\s?/, "")
          .trim();
        if (c && !c.startsWith("@") && !/^-+$/.test(c)) collected.push(c);
        if (lines[j].includes("*/")) break;
        j++;
      }
      doc = collected[0] || "";
      i = j;
      continue;
    }

    if (!/^export\s+/.test(lines[i])) continue;
    const sig = signatureAt(lines, i);
    blocks.push({ doc, sig });
    doc = "";
    // Skip past the signature only; the body is never emitted.
    for (let j = i; j < lines.length; j++) {
      if (lines[j].includes("{") || lines[j].trim().endsWith(";")) {
        i = j;
        break;
      }
    }
  }
  return blocks;
}

/** Props interfaces of a component — enough to reuse it correctly. */
function propsBlocks(rel) {
  const lines = readLines(rel);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:export\s+)?(?:interface|type)\s+\w*Props\b/.test(lines[i])) continue;
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth <= 0) {
        end = j;
        break;
      }
    }
    out.push(lines.slice(i, end + 1).join("\n"));
    i = end;
  }
  return out;
}

function fullSource(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+$/, "");
  } catch {
    return `(missing: ${rel})`;
  }
}

// ── Sections ─────────────────────────────────────────────────────────────────

function sectionHeader(files) {
  const lines = [];
  lines.push("# Project map — delivery_system / web-pwa");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source files scanned: ${files.length}`);
  lines.push("");
  lines.push("## How to use this file");
  lines.push("");
  lines.push(
    "This is a map of the project, not its source. It lists what exists and where.",
  );
  lines.push(
    "When asked to design a change, use it to pick the exact existing files,",
  );
  lines.push(
    "endpoints and components to reuse — do not invent new ones that duplicate",
  );
  lines.push("something listed here.");
  lines.push("");
  lines.push("Rules that must not be broken are in the `AGENTS.md` section below.");
  lines.push("");
  lines.push("### Output format expected from you");
  lines.push("");
  lines.push(
    "Do NOT write code. Produce a plan document in this exact shape:",
  );
  lines.push("");
  lines.push("1. **Overview** — what will change, in plain English.");
  lines.push(
    "2. **Architecture** — a mermaid flowchart of the request/UX flow, naming real files from this map.",
  );
  lines.push(
    "3. **Current State Analysis** — a table of `file | line range | current behaviour` for every file that must change.",
  );
  lines.push("4. **Step-by-step plan** — one step per file, in safe order.");
  lines.push(
    "5. **Risks** — what could break, which existing behaviour/endpoint/component is being reused, and which roles can see the feature.",
  );
  lines.push("");
  lines.push(
    "If no existing endpoint or component fits, say so explicitly instead of inventing one.",
  );
  lines.push("");
  return lines;
}

function sectionTree(files) {
  const lines = ["## 1. File tree", ""];
  lines.push(
    "Every file that makes up the site, with its size. Sizes matter: files over",
  );
  lines.push(
    "~1,000 lines are risky to change and should be edited one section at a time.",
  );
  lines.push("");
  lines.push("```");
  for (const rel of files) {
    const fileLines = readLines(rel);
    const isRoute = rel.startsWith("app/api/") && rel.endsWith("/route.ts");
    const desc = isRoute
      ? routeDescription(fileLines, rel) || labelFor(rel)
      : firstComment(fileLines) || labelFor(rel);
    lines.push(`${rel}  (${fileLines.length} lines) — ${desc}`);
  }
  lines.push("```");
  lines.push("");
  return lines;
}

function sectionEndpoints(files) {
  const routes = files.filter(
    (f) => f.startsWith("app/api/") && f.endsWith("/route.ts"),
  );
  const actions = files.filter((f) => f.startsWith("app/actions/"));
  const lines = ["## 2. API endpoints", ""];
  lines.push(
    `${routes.length} route handlers. Reuse one of these before proposing a new endpoint.`,
  );
  lines.push("");
  for (const rel of routes) {
    const fileLines = readLines(rel);
    const methods = exportedMethods(fileLines);
    const desc = routeDescription(fileLines, rel) || labelFor(rel);
    lines.push(
      `- **${methods.length ? methods.join(", ") : "(no handler found)"} ${routePath(rel)}** — ${desc}  \n  file: \`${rel}\` (${fileLines.length} lines)`,
    );
  }
  if (actions.length) {
    lines.push("");
    lines.push("### Server actions (`app/actions/`)");
    for (const rel of actions) {
      const fileLines = readLines(rel);
      lines.push(
        `- \`${rel}\` (${fileLines.length} lines) — ${firstComment(fileLines) || labelFor(rel)}`,
      );
    }
  }
  lines.push("");
  return lines;
}

function sectionComponents(files) {
  const comps = files.filter((f) => f.startsWith("components/"));
  const lines = ["## 3. Shared components", ""];
  lines.push(
    "Check here before proposing any new UI. Props are shown so a component can be reused correctly.",
  );
  lines.push("");
  for (const rel of comps) {
    const fileLines = readLines(rel);
    lines.push(
      `### \`${rel}\` (${fileLines.length} lines)`,
    );
    const desc = firstComment(fileLines);
    if (desc) lines.push(`> ${desc}`);
    const props = propsBlocks(rel);
    if (props.length) {
      lines.push("");
      lines.push("```ts");
      lines.push(props.join("\n\n"));
      lines.push("```");
    }
    lines.push("");
  }
  return lines;
}

function sectionLib(files) {
  const mods = files.filter(
    (f) =>
      (f.startsWith("lib/") || f.startsWith("helpers/")) &&
      /\.(ts|tsx)$/.test(f),
  );
  const lines = ["## 4. Business rules and helpers", ""];
  lines.push(
    "Public interface only (no implementation). These are the functions a change must call instead of re-implementing the logic.",
  );
  lines.push("");
  for (const rel of mods) {
    const blocks = moduleSurface(rel);
    if (!blocks.length) continue;
    lines.push(`### \`${rel}\` (${readLines(rel).length} lines)`);
    const desc = firstComment(readLines(rel));
    if (desc) lines.push(`> ${desc}`);
    lines.push("");
    lines.push("```ts");
    for (const b of blocks) {
      if (b.doc) lines.push(`// ${b.doc}`);
      lines.push(b.sig);
      lines.push("");
    }
    lines.push("```");
    lines.push("");
  }
  return lines;
}

function sectionFull() {
  const lines = ["## 5. Full source of the rules of the system", ""];
  for (const rel of FULL_SOURCE) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    lines.push(`### \`${rel}\``);
    lines.push("");
    lines.push("```");
    lines.push(fullSource(rel));
    lines.push("```");
    lines.push("");
  }
  return lines;
}

function sectionPlans(files) {
  const plans = files.filter((f) => f.startsWith("plans/"));
  if (!plans.length) return [];
  const lines = [
    "## 6. Existing feature plans",
    "",
    "These are the plan documents already written for this project. Match their format.",
    "",
  ];
  for (const rel of plans) {
    lines.push(`### \`${rel}\` (${readLines(rel).length} lines)`);
    lines.push("");
    lines.push(fullSource(rel));
    lines.push("");
  }
  return lines;
}

function sectionFocus(requested) {
  const lines = [
    "# Focus files — full source for the feature being changed",
    "",
    "These were requested explicitly. Everything else in this project is described",
    "in AI-CONTEXT.md; only these bodies are included.",
    "",
  ];
  for (const rel of requested) {
    lines.push(`## \`${rel}\` (${readLines(rel).length} lines)`);
    lines.push("");
    const ext = path.extname(rel).replace(".", "");
    lines.push("```" + ext);
    lines.push(fullSource(rel));
    lines.push("```");
    lines.push("");
  }
  return lines;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const focusIdx = argv.indexOf("--focus");
  const focusFiles = focusIdx === -1 ? [] : argv.slice(focusIdx + 1);

  const files = walk(ROOT, ROOT, []).sort();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const map = [
    ...sectionHeader(files),
    ...sectionTree(files),
    ...sectionEndpoints(files),
    ...sectionComponents(files),
    ...sectionLib(files),
    ...sectionFull(),
    ...sectionPlans(files),
  ];
  const mapText = map.join("\n").replace(/\n{3,}/g, "\n\n");
  const mapPath = path.join(OUT_DIR, "AI-CONTEXT.md");
  fs.writeFileSync(mapPath, mapText, "utf8");

  let focusPath = null;
  if (focusFiles.length) {
    const missing = focusFiles.filter(
      (f) => !fs.existsSync(path.join(ROOT, f)),
    );
    if (missing.length) {
      console.error(`Not found: ${missing.join(", ")}`);
      process.exitCode = 1;
    }
    const focusText = sectionFocus(
      focusFiles.filter((f) => fs.existsSync(path.join(ROOT, f))),
    ).join("\n");
    focusPath = path.join(OUT_DIR, "AI-FOCUS.md");
    fs.writeFileSync(focusText ? focusPath : focusPath, focusText, "utf8");
  }

  const mapLines = mapText.split("\n").length;
  const mapBytes = Buffer.byteLength(mapText, "utf8");
  console.log(`AI-CONTEXT.md  ${mapLines} lines  ${(mapBytes / 1024).toFixed(0)} KB  ~${Math.round(mapBytes / 4000)}k tokens`);
  if (focusPath) {
    const focusText = fs.readFileSync(focusPath, "utf8");
    const fl = focusText.split("\n").length;
    const fb = Buffer.byteLength(focusText, "utf8");
    console.log(`AI-FOCUS.md    ${fl} lines  ${(fb / 1024).toFixed(0)} KB  ~${Math.round(fb / 4000)}k tokens`);
  }
}

main();
