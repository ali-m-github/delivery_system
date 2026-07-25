#!/usr/bin/env ts-node
/**
 * Startup validation script.
 * Run before starting the dev server to catch misconfigurations early.
 * Usage: npx ts-node scripts/validate-config.ts
 */

import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");
let errors = 0;
let warnings = 0;

function error(msg: string) {
  console.error(`  ❌ ${msg}`);
  errors++;
}

function warn(msg: string) {
  console.warn(`  ⚠️  ${msg}`);
  warnings++;
}

function ok(msg: string) {
  console.log(`  ✅ ${msg}`);
}

console.log("🔍 Validating project configuration...\n");

// 1. Check middleware.ts exists and exports correct function
console.log("1. Middleware configuration:");
const middlewarePath = resolve(root, "middleware.ts");
if (!existsSync(middlewarePath)) {
  error("middleware.ts is missing at project root");
} else {
  const content = readFileSync(middlewarePath, "utf-8");
  if (!content.includes("export async function middleware")) {
    error(
      "middleware.ts does not export 'middleware' function. Next.js requires: export async function middleware(request: NextRequest)",
    );
  } else {
    ok("middleware.ts exports correct function");
  }
  // Warn if old proxy.ts still exists
  const proxyPath = resolve(root, "proxy.ts");
  if (existsSync(proxyPath)) {
    warn("proxy.ts still exists alongside middleware.ts (should be deleted)");
  }
}

// 2. Check required environment variables
console.log("\n2. Environment variables:");
const envPath = resolve(root, ".env");
if (!existsSync(envPath)) {
  error(".env file is missing");
} else {
  const envContent = readFileSync(envPath, "utf-8");
  if (!envContent.includes("DATABASE_URL")) {
    error("DATABASE_URL not found in .env");
  } else {
    ok("DATABASE_URL present");
  }
  if (!envContent.includes("JWT_SECRET")) {
    error("JWT_SECRET not found in .env");
  } else {
    ok("JWT_SECRET present");
  }
}

// 3. Check next.config.ts exists
console.log("\n3. Next.js configuration:");
const nextConfigPath = resolve(root, "next.config.ts");
if (!existsSync(nextConfigPath)) {
  error("next.config.ts is missing");
} else {
  ok("next.config.ts present");
}

// 4. Check Prisma schema
console.log("\n4. Prisma schema:");
const schemaPath = resolve(root, "prisma/schema.prisma");
if (!existsSync(schemaPath)) {
  error("prisma/schema.prisma is missing");
} else {
  ok("prisma/schema.prisma present");
}

// Summary
console.log("\n" + "─".repeat(50));
if (errors === 0 && warnings === 0) {
  console.log("✅ All checks passed!");
} else {
  console.log(`❌ ${errors} error(s), ${warnings} warning(s)`);
}
process.exit(errors > 0 ? 1 : 0);
