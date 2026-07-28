/**
 * Assign specific order IDs to driver D999.
 *
 * Rules:
 *   - Only assigns orders with location === "WAREHOUSE"
 *   - If order not found → skipped
 *   - If already has a driver assigned (any driver) → skipped
 *   - If location is DELIVERED, RETURNED, WITH_DRIVER, PAID_TO_MERCHANT → skipped
 *   - If financialStatus is WD or WO (cleared payout) → skipped
 *
 * Run: npx tsx scripts/assign-orders-d999.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_IDS = [
  "10007104",
  "10007110",
  "10007112",
  "10007113",
  "10007116",
  "10007118",
  "10007119",
  "10007120",
  "10007121",
  "10007451",
  "10007453",
  "10007455",
  "10007456",
  "10007458",
  "10007462",
  "10007463",
  "10007464",
  "10007466",
  "10007468",
  "10007469",
  "10007470",
  "10007471",
  "10007472",
  "10007713",
  "10007717",
  "10007720",
  "10007725",
  "5219-2571",
  "5219-2577",
  "5219-2578",
  "5219-2584",
  "5219-2600",
  "5219-2603",
  "5219-2604",
  "5219-2611",
  "5219-2613",
  "5219-2619",
  "5219-2624",
  "5219-2625",
  "5219-2626",
  "5219-2628",
  "5219-2629",
  "5219-2630",
  "5219-2631",
  "5219-2632",
  "5219-2633",
  "5219-2635",
  "5219-2637",
  "5219-2641",
  "5219-2646",
  "5219-2647",
  "5219-2648",
  "5219-2649",
  "5219-2650",
  "5219-2651",
  "5219-2652",
  "5219-2653",
  "5219-2654",
  "5219-2655",
  "5219-2656",
  "5219-2657",
  "5219-2658",
  "5219-2659",
  "5219-2660",
  "5219-2661",
  "5219-2662",
  "5219-2663",
  "5219-2664",
  "10007718",
  "10007102",
  "10007106",
  "10007108",
  "10007109",
  "10007114",
  "10007454",
  "10007667",
  "10007715",
  "10007719",
  "10007723",
  "9948629",
  "9948733",
  "5219-2612",
  "5219-2614",
  "5219-2615",
  "5219-2616",
  "5219-2617",
  "5219-2618",
  "5219-2620",
  "5219-2621",
  "5219-2622",
  "5219-2623",
  "5219-2627",
  "5219-2634",
  "5219-2636",
  "5219-2638",
  "5219-2639",
  "5219-2640",
  "5219-2642",
  "5219-2643",
  "5219-2644",
  "5219-2645",
  "10007659",
  "10007661",
  "10007707",
  "5219-2564",
  "5219-2601",
  "5219-2602",
  "5219-2605",
  "5219-2606",
  "5219-2607",
  "5219-2608",
  "5219-2609",
  "5219-2610",
  "10007671",
  "10000000",
  "10007654",
  "10007660",
  "10007663",
  "10007664",
  "10007666",
  "10007669",
  "10007672",
  "10007674",
  "10007701",
  "10007702",
  "10007703",
  "10007705",
  "5219-21079",
  "5219-2572",
  "5219-2573",
  "5219-2574",
  "5219-2575",
  "5219-2576",
  "5219-2579",
  "5219-2580",
  "5219-2581",
  "5219-2582",
  "5219-2583",
  "5219-2585",
  "5219-2586",
  "5219-2587",
  "5219-2588",
  "5219-2589",
  "5219-2590",
  "5219-2591",
  "5219-2592",
  "5219-2593",
  "5219-2594",
  "5219-2595",
  "5219-2596",
  "5219-2597",
  "5219-2598",
  "5219-2599",
  "9935254",
  "9948719",
  "9948744",
  "10007652",
  "5219-2550",
  "5219-2560",
  "5219-2561",
  "5219-2562",
  "5219-2563",
  "5219-2565",
  "5219-2566",
  "5219-2567",
  "5219-2568",
  "5219-2569",
  "5219-2570",
  "9948751",
  "9948753",
  "9948757",
  "9948762",
  "9948766",
  "9948767",
  "9948772",
  "10007651",
  "10007657",
  "5219-2551",
  "5219-2555",
  "5219-2558",
  "5219-2559",
  "9948752",
  "9948756",
  "9948763",
  "9948765",
  "9948775",
  "5219-2525",
  "5219-2530",
  "5219-2536",
  "5219-2537",
  "5219-2538",
  "5219-2539",
  "5219-2540",
  "5219-2541",
  "5219-2542",
  "5219-2543",
  "5219-2544",
  "5219-2545",
  "5219-2546",
  "5219-2547",
  "5219-2548",
  "5219-2549",
  "5219-2552",
  "5219-2553",
  "5219-2554",
  "5219-2556",
  "5219-2557",
  "9948687",
  "9948689",
  "9948690",
  "5219-2534",
  "9948638",
  "9948676",
  "9948677",
  "9948681",
  "9948682",
  "9948683",
  "9948685",
  "9948691",
  "9948694",
  "9948695",
  "9948698",
  "9948807",
  "9948823",
  "9999916",
  "9948737",
  "5219-2531",
  "5219-2532",
  "9948739",
  "9948741",
  "9948743",
  "9948745",
  "9948748",
  "10007621",
  "5219-2520",
  "5219-2521",
  "5219-2523",
  "5219-2524",
  "5219-2526",
  "5219-2527",
  "5219-2528",
  "5219-2529",
  "9948726",
  "9948728",
  "9948732",
  "9948734",
  "5219-2501",
  "5219-2502",
  "5219-2503",
  "5219-2504",
  "5219-2507",
  "5219-2508",
  "5219-2509",
  "5219-2510",
  "5219-2511",
  "5219-2512",
  "5219-2513",
  "5219-2514",
  "5219-2515",
  "5219-2516",
  "9948727",
  "9948731",
  "9948847",
  "9948848",
  "9948850",
  "5219-2517",
  "5219-2518",
  "10007620",
  "5219-2485",
  "5219-2486",
  "5219-2487",
  "5219-2490",
  "5219-2492",
  "5219-2494",
  "5219-2495",
  "5219-2500",
  "9948705",
  "9948710",
  "9948713",
  "9948714",
  "9948715",
  "9948716",
  "9948718",
  "9948721",
  "9948724",
  "9948725",
  "9948818",
  "9948819",
  "9948820",
  "9948826",
  "9948827",
  "9948828",
  "9948830",
  "9948831",
  "9948832",
  "9948833",
  "9948834",
  "9948835",
  "9948837",
  "9948838",
  "9948840",
  "9948842",
  "9948843",
  "9948844",
  "9948845",
  "9948846",
  "5219-2493",
  "5219-2496",
  "5219-2497",
  "5219-2498",
  "5219-2499",
  "5219-2488",
  "5219-2489",
  "5219-2491",
];

async function main() {
  console.log(`Total order IDs provided: ${ORDER_IDS.length}`);

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
  const notWarehouse: { orderId: string; location: string }[] = [];
  const alreadyDelivered: string[] = [];
  const alreadyReturned: string[] = [];
  const alreadyAssigned: { orderId: string; driverName: string }[] = [];
  const alreadyCleared: string[] = [];
  const toAssign: string[] = [];

  for (const orderId of ORDER_IDS) {
    const order = orderMap.get(orderId);
    if (!order) {
      notFound.push(orderId);
      continue;
    }

    // Check if not in WAREHOUSE status
    if (order.location !== "WAREHOUSE") {
      if (order.location === "DELIVERED") {
        alreadyDelivered.push(orderId);
      } else if (order.location === "RETURNED") {
        alreadyReturned.push(orderId);
      } else {
        notWarehouse.push({ orderId, location: order.location });
      }
      continue;
    }

    // Check if financialStatus is WD or WO (cleared payout)
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
  console.log(`  Total order IDs provided:  ${ORDER_IDS.length}`);
  console.log(`  Found in database:         ${existingOrders.length}`);
  console.log(`  Not found in database:     ${notFound.length}`);
  console.log(
    `  Not in WAREHOUSE status:   ${notWarehouse.length + alreadyDelivered.length + alreadyReturned.length}`,
  );
  console.log(`    └ Delivered:             ${alreadyDelivered.length}`);
  console.log(`    └ Returned:              ${alreadyReturned.length}`);
  console.log(`    └ Other status:          ${notWarehouse.length}`);
  console.log(`  Already cleared (WD/WO):   ${alreadyCleared.length}`);
  console.log(`  Already assigned:          ${alreadyAssigned.length}`);
  console.log(`  Eligible to assign:        ${toAssign.length}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (notFound.length > 0) {
    console.log("--- NOT FOUND (not in database) ---");
    for (const id of notFound) console.log(`  ${id}`);
    console.log();
  }

  if (alreadyDelivered.length > 0) {
    console.log("--- DELIVERED (skipped) ---");
    for (const id of alreadyDelivered) console.log(`  ${id}`);
    console.log();
  }

  if (alreadyReturned.length > 0) {
    console.log("--- RETURNED (skipped) ---");
    for (const id of alreadyReturned) console.log(`  ${id}`);
    console.log();
  }

  if (notWarehouse.length > 0) {
    console.log("--- NOT IN WAREHOUSE STATUS (skipped) ---");
    for (const o of notWarehouse)
      console.log(`  ${o.orderId} (status: ${o.location})`);
    console.log();
  }

  if (alreadyCleared.length > 0) {
    console.log("--- ALREADY CLEARED (WD/WO - skipped) ---");
    for (const id of alreadyCleared) console.log(`  ${id}`);
    console.log();
  }

  if (alreadyAssigned.length > 0) {
    console.log("--- ALREADY ASSIGNED TO A DRIVER (skipped) ---");
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
  const errorDetails: { orderId: string; error: string }[] = [];

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
      errorDetails.push({ orderId, error: err.message });
    }
  }

  // ── 6. Final summary ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  FINAL SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Successfully assigned:    ${assignedCount}`);
  console.log(`  Errors during assign:     ${errorCount}`);
  console.log("───────────────────────────────────────────────────────");
  console.log("  SKIPPED ORDERS (not assigned):");
  console.log(`    Not found:              ${notFound.length}`);
  for (const id of notFound) console.log(`      - ${id}`);
  console.log(`    Delivered:              ${alreadyDelivered.length}`);
  for (const id of alreadyDelivered) console.log(`      - ${id}`);
  console.log(`    Returned:               ${alreadyReturned.length}`);
  for (const id of alreadyReturned) console.log(`      - ${id}`);
  console.log(`    Other non-warehouse:    ${notWarehouse.length}`);
  for (const o of notWarehouse)
    console.log(`      - ${o.orderId} (${o.location})`);
  console.log(`    Cleared (WD/WO):        ${alreadyCleared.length}`);
  for (const id of alreadyCleared) console.log(`      - ${id}`);
  console.log(`    Already assigned:       ${alreadyAssigned.length}`);
  for (const a of alreadyAssigned)
    console.log(`      - ${a.orderId} (${a.driverName})`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (errorDetails.length > 0) {
    console.log("--- ERRORS ---");
    for (const e of errorDetails) console.log(`  ${e.orderId}: ${e.error}`);
    console.log();
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
