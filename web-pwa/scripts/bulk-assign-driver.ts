/**
 * Bulk-assign orders to driver D999.
 *
 * For each orderId in the list:
 *   - If order not found → skipped (not in system)
 *   - If already has a driver assigned → skipped
 *   - If location is "DELIVERED" → skipped
 *   - If financialStatus is "WD" or "WO" (cleared payout) → skipped
 * Otherwise, the order is assigned to D999.
 *
 * Run: npx tsx scripts/bulk-assign-driver.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_IDS = [
  "5219-2447",
  "5219-2461",
  "5219-2471",
  "5219-2479",
  "5219-2480",
  "5219-2481",
  "10049593",
  "5219-2452",
  "5219-2456",
  "5219-2468",
  "5219-2484",
  "9948709",
  "9948717",
  "9948722",
  "9948806",
  "9948808",
  "9948821",
  "9948829",
  "10007614",
  "5219-2435",
  "5219-2440",
  "5219-2441",
  "5219-2442",
  "5219-2443",
  "5219-2446",
  "5219-2475",
  "5219-2476",
  "5219-2477",
  "5219-2482",
  "5219-2483",
  "9948630",
  "9948632",
  "9948634",
  "9948635",
  "9948637",
  "9948641",
  "9948643",
  "9948644",
  "9948645",
  "9948647",
  "9948648",
  "9948650",
  "9948801",
  "9948802",
  "9948804",
  "9948805",
  "9948809",
  "9948810",
  "9948813",
  "9948815",
  "5219-2425",
  "5219-2432",
  "5219-2433",
  "5219-2450",
  "5219-2451",
  "5219-2453",
  "5219-2454",
  "5219-2455",
  "5219-2457",
  "5219-2458",
  "5219-2459",
  "5219-2460",
  "5219-2462",
  "5219-2463",
  "5219-2464",
  "5219-2465",
  "5219-2466",
  "5219-2467",
  "5219-2469",
  "5219-2470",
  "5219-2472",
  "5219-2473",
  "5219-2474",
  "9935109",
  "9935111",
  "9935121",
  "10049815",
  "10049816",
  "10049818",
  "10049825",
  "10049829",
  "10049830",
  "10049831",
  "10049835",
  "10049836",
  "10049837",
  "10049840",
  "10049844",
  "10049845",
  "10049846",
  "10049847",
  "10049848",
  "10049849",
  "10049850",
  "5219-2386",
  "5219-2387",
  "5219-2389",
  "5219-2391",
  "5219-2393",
  "5219-2394",
  "5219-2395",
  "5219-2396",
  "5219-2398",
  "5219-2399",
  "5219-2403",
  "5219-2408",
  "5219-2409",
  "5219-2412",
  "5219-2414",
  "5219-2418",
  "5219-2419",
  "5219-2420",
  "5219-2421",
  "5219-2438",
  "5219-2439",
  "5219-2444",
  "5219-2445",
  "5219-2448",
  "5219-2449",
  "9935101",
  "9935102",
  "9935103",
  "9935104",
  "9935106",
  "9935112",
  "9935115",
  "9935116",
  "9935120",
  "9935122",
  "9935125",
  "9948628",
  "10049587",
  "10049588",
  "10049596",
  "10049597",
  "10049801",
  "10049806",
  "10049812",
  "5219-2365",
  "5219-2423",
  "5219-2424",
  "5219-2426",
  "5219-2427",
  "5219-2428",
  "5219-2429",
  "5219-2430",
  "5219-2431",
  "5219-2436",
  "10007601",
  "10007604",
  "10049576",
  "10049577",
  "10049578",
  "10049579",
  "10049581",
  "10049583",
  "10049584",
  "10049585",
  "10049590",
  "10049599",
  "10049802",
  "10049809",
  "5219-2335",
  "5219-2337",
  "5219-2338",
  "5219-2341",
  "5219-2342",
  "5219-2344",
  "5219-2345",
  "5219-2355",
  "5219-2356",
  "5219-2357",
  "5219-2388",
  "5219-2390",
  "5219-2392",
  "5219-2397",
  "5219-2401",
  "5219-2402",
  "5219-2404",
  "5219-2405",
  "5219-2406",
  "5219-2407",
  "5219-2410",
  "5219-2411",
  "5219-2413",
  "5219-2415",
  "5219-2416",
  "5219-2417",
  "5219-2422",
  "9935270",
  "9935274",
  "5219-2366",
  "5219-2367",
  "5219-2368",
  "5219-2369",
  "5219-2370",
  "5219-2371",
  "5219-2372",
  "5219-2373",
  "5219-2374",
  "5219-2375",
  "5219-2376",
  "5219-2377",
  "5219-2378",
  "5219-2379",
  "5219-2380",
  "5219-2381",
  "5219-2382",
  "5219-2383",
  "5219-2384",
  "5219-2385",
  "10007602",
  "10007605",
  "10007608",
  "10007611",
  "10049582",
  "5219-2329",
  "5219-2358",
  "5219-2359",
  "5219-2361",
  "5219-2362",
  "5219-2363",
  "5219-2364",
  "9935245",
  "9935246",
  "9935248",
  "9935252",
  "9935256",
  "9935258",
  "9935262",
  "9935263",
  "9935265",
  "9935269",
  "9935272",
  "9935275",
  "5219-2306",
  "5219-2307",
  "5219-2308",
  "5219-2309",
  "5219-2311",
  "5219-2312",
  "5219-2313",
  "5219-2314",
  "5219-2316",
  "5219-2322",
  "5219-2333",
  "5219-2334",
  "5219-2336",
  "5219-2339",
  "5219-2340",
  "5219-2343",
  "5219-2346",
  "5219-2347",
  "5219-2348",
  "5219-2349",
  "5219-2350",
  "5219-2351",
  "5219-2352",
  "5219-2353",
  "5219-2354",
  "9935242",
  "9935244",
  "9935250",
  "9935251",
  "9935253",
  "9935255",
  "9999903",
  "9999904",
  "9999905",
  "9999910",
  "9999911",
  "9999913",
  "9999914",
  "9999919",
  "9999920",
  "9999922",
  "9999923",
  "5219-2302",
  "5219-2325",
  "9935228",
  "9935229",
  "9935231",
  "9935232",
  "9935287",
  "9935288",
  "9935290",
  "9935291",
  "9935293",
  "9935297",
  "9935299",
  "9935300",
  "9999901",
  "9999990",
  "9999994",
  "9999995",
  "9999996",
  "9999997",
  "9999999",
  "5219-2301",
  "5219-2304",
  "5219-2296",
  "5219-2298",
];

async function main() {
  // ── 1. Find driver D999 ──────────────────────────────────────────────────
  const driverProfile = await prisma.driverProfile.findFirst({
    where: { driverId: { equals: "D999", mode: "insensitive" } },
  });

  if (!driverProfile) {
    console.error("ERROR: Driver D999 not found in the system.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Found driver: ${driverProfile.firstName} ${driverProfile.lastName} (ID: ${driverProfile.driverId}, DB ID: ${driverProfile.id})`,
  );

  // ── 2. Look up all orders by their orderId ───────────────────────────────
  const existingOrders = await prisma.order.findMany({
    where: { orderId: { in: ORDER_IDS } },
    select: {
      id: true,
      orderId: true,
      driverId: true,
      location: true,
      financialStatus: true,
      driver: {
        select: {
          driverId: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const orderMap = new Map(existingOrders.map((o) => [o.orderId, o]));

  // ── 3. Categorize each order ─────────────────────────────────────────────
  const notFound: string[] = [];
  const alreadyDelivered: string[] = [];
  const alreadyAssigned: { orderId: string; driverName: string }[] = [];
  const alreadyCleared: string[] = [];
  const toAssign: string[] = [];

  for (const orderId of ORDER_IDS) {
    const order = orderMap.get(orderId);
    if (!order) {
      notFound.push(orderId);
      continue;
    }

    // Check if delivered
    if (order.location === "DELIVERED") {
      alreadyDelivered.push(orderId);
      continue;
    }

    // Check if financialStatus is WD or WO (cleared payout / with driver delivered)
    if (order.financialStatus === "WD" || order.financialStatus === "WO") {
      alreadyCleared.push(orderId);
      continue;
    }

    // Check if already assigned to a driver
    if (order.driverId) {
      const driverName = order.driver
        ? `${order.driver.firstName} ${order.driver.lastName} (${order.driver.driverId})`
        : "Unknown driver";
      alreadyAssigned.push({ orderId, driverName });
      continue;
    }

    toAssign.push(orderId);
  }

  // ── 4. Report classification ─────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Total order IDs provided: ${ORDER_IDS.length}`);
  console.log(`  Found in database:        ${existingOrders.length}`);
  console.log(`  Not found in database:    ${notFound.length}`);
  console.log(`  Already delivered:        ${alreadyDelivered.length}`);
  console.log(`  Already cleared (WD/WO):  ${alreadyCleared.length}`);
  console.log(`  Already assigned:         ${alreadyAssigned.length}`);
  console.log(`  Eligible to assign:       ${toAssign.length}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (notFound.length > 0) {
    console.log("--- NOT FOUND (not in database) ---");
    for (const id of notFound) console.log(`  ${id}`);
    console.log();
  }

  if (alreadyDelivered.length > 0) {
    console.log("--- ALREADY DELIVERED (skipped) ---");
    for (const id of alreadyDelivered) console.log(`  ${id}`);
    console.log();
  }

  if (alreadyCleared.length > 0) {
    console.log("--- ALREADY CLEARED (WD/WO - skipped) ---");
    for (const id of alreadyCleared) console.log(`  ${id}`);
    console.log();
  }

  if (alreadyAssigned.length > 0) {
    console.log("--- ALREADY ASSIGNED TO ANOTHER DRIVER (skipped) ---");
    for (const a of alreadyAssigned)
      console.log(`  ${a.orderId} → ${a.driverName}`);
    console.log();
  }

  // ── 5. Assign eligible orders ────────────────────────────────────────────
  if (toAssign.length === 0) {
    console.log("No orders eligible for assignment. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Find an admin user for the history entries
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  if (!adminUser) {
    console.error("ERROR: No admin user found to record history entries.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Assigning ${toAssign.length} order(s) to driver D999...\n`);

  let assignedCount = 0;
  let errorCount = 0;

  for (const orderId of toAssign) {
    try {
      await prisma.order.update({
        where: { orderId },
        data: {
          driverId: driverProfile.id,
          location: "ASSIGNED",
          financialStatus: "UD",
          history: {
            create: {
              action: "Assigned to Driver (Bulk)",
              location: "ASSIGNED",
              driverId: driverProfile.id,
              userId: adminUser.id,
            },
          },
        },
      });
      console.log(`  ✓ ${orderId} → Assigned to D999`);
      assignedCount++;
    } catch (err: any) {
      console.error(`  ✗ ${orderId} → Error: ${err.message}`);
      errorCount++;
    }
  }

  // ── 6. Final summary ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  FINAL SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Successfully assigned: ${assignedCount}`);
  console.log(`  Errors:               ${errorCount}`);
  console.log("───────────────────────────────────────────────────────");
  console.log("  SKIPPED ORDERS (not assigned):");
  console.log(`    Not found:          ${notFound.length}`);
  for (const id of notFound) console.log(`      - ${id}`);
  console.log(`    Already delivered:  ${alreadyDelivered.length}`);
  for (const id of alreadyDelivered) console.log(`      - ${id}`);
  console.log(`    Already cleared:    ${alreadyCleared.length}`);
  for (const id of alreadyCleared) console.log(`      - ${id}`);
  console.log(`    Already assigned:   ${alreadyAssigned.length}`);
  for (const a of alreadyAssigned)
    console.log(`      - ${a.orderId} (assigned to ${a.driverName})`);
  console.log("═══════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
