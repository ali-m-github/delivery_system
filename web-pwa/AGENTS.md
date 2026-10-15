<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules — delivery_system / web-pwa

A production delivery/logistics PWA. Next.js App Router + React + TypeScript,
Tailwind, Prisma + PostgreSQL. The owner has no coding experience: prefer small,
targeted, reversible changes; never refactor or reformat files that a change
does not actually require.

## Where things live

- `app/<route>/page.tsx` — pages. Server components read the session cookie and fetch data; big interactive pages delegate to a `*Client.tsx` component (`"use client"`).
- `app/api/<route>/route.ts` — all data access and all real authorization. Pages never query Prisma for mutations.
- `app/actions/` — a few server actions for financial mutations.
- `components/` — shared UI reused across pages (e.g. `SharedOrderTable`, `PermissionGuard`, `BarcodeScannerModal`, `components/orders/UniversalStaffScannerModal`). Check here before creating any new UI.
- `lib/` — business rules. `helpers/` — auth/uuid helpers.
- `data/` and `scripts/` — real order data and one-off data repairs. Never touch them unless explicitly asked.

## Rules that must not be broken

1. **Money**: all commission/payout math goes through `lib/commission.ts` and `lib/profit.ts`. Never compute money inline in a page or route. Payout mutability is checked with `isPayoutMutable` / `PAID_OUT_ELIGIBLE_STATUSES`.
2. **Permissions**: client-side gating uses `hasPermission` from `lib/permissions.ts` and `<PermissionGuard requires="...">`. Server-side, every API route and server action re-checks with `requireServerPermission` / `requireActionPermission` from `lib/server-permissions.ts`. `middleware.ts` is a coarse page-level gate only — never treat it as the authorization.
3. **Order status is strings, not enums.** `Order.location` and `Order.financialStatus` are plain strings in `prisma/schema.prisma` even though enums exist; the valid values are enforced at runtime in the API (e.g. `DRIVER_ALLOWED_LOCATIONS` in `app/api/orders/route.ts`). "With driver" queries must match the union `WITH_DRIVER | ASSIGNED | ASSIGNED_TR`.
4. **Zones**: zone matching goes through `lib/zoneMatcher.ts` (fallback zone `"99"`); zone ordering through `lib/zoneSort.ts`.
5. **References**: human-readable batch/reference numbers come from `lib/sequences.ts` inside the same Prisma transaction — never generate them ad hoc.
6. **Concurrency**: mutations that can race (payouts, status changes) use `withConcurrencyRetries` from `lib/concurrency.ts` and Prisma transactions.
7. **PII**: customer names/phones/addresses shown in logs or notifications go through `lib/pii.ts`.
8. **Auth**: session cookie + JWT helpers are in `helpers/auth.ts` / `lib/jwt.ts`; passwords via `hashPassword`/`comparePassword` (bcryptjs).
9. **Money is dual-currency**: orders carry `amountUsd`/`amountLbp` and `collectedUsd`/`collectedLbp`. Keep both in sync in any change that touches amounts.
10. **Delivering an order can create an exchange order** (`createExchangeOrderFromDelivered` in `app/api/orders/route.ts`) — preserve that behaviour.

## How to work on this project

- Before coding a feature, write a plan in `plans/<feature>.md` in the existing format: Overview → Mermaid architecture → "Current State Analysis" table (`file | line range | current behaviour`) → step-by-step plan.
- Several files exceed 1,000 lines (`app/orders/page.tsx` ~7.8k, `app/driver/DriverClient.tsx` ~3.5k). Edit them surgically, one section at a time; never rewrite them wholesale.
- Reuse an existing endpoint or component from the inventory in `ai-context/AI-CONTEXT.md` instead of creating a parallel one.
- Run `node scripts/build-ai-context.js` after adding a feature so the map stays current. It only reads files and writes to `ai-context/`; it cannot affect the site.
