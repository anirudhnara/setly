/**
 * Demo prep. Run with `npm run seed`.
 *
 * 1. Checks that fixture rule statuses match the rule checker and that starter structures are valid.
 * 2. Warms the search cache for the demo queries (only spends SerpApi quota when MOCK_AI=0).
 * 3. Times the demo prompt end to end against the 15 second target and prints every rule.
 * 4. Seeds grp_apartment when DATABASE_URL is set.
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DEMO_PROMPT = "Living room for a group of 3, cozy and navy, $1,500 total, door is 32 inches";
const DEMO_QUERIES = [
  "navy 3 seat sofa", "apartment sofa", "washable area rug", "low pile rug", "floor lamp", "oak coffee table",
  "throw pillow", "5 shelf bookcase", "compact microwave", "drip coffee maker", "stoneware mug", "step trash can",
];

async function main() {
  const [{ checkRules }, { mockAiEnabled }, { generatedMapSchema }, { searchProducts }, { generateMapFromPrompt }, sample, starters] = await Promise.all([
    import("@/lib/rules/check"),
    import("@/lib/env"),
    import("@/lib/ai/schemas"),
    import("@/lib/search/serpapi"),
    import("@/lib/ai/gemini"),
    import("@/lib/fixtures/sample"),
    import("@/fixtures/starter-structures.json"),
  ]);
  let failures = 0;

  console.log("1. Fixtures");
  const fixtureMaps = [
    ["apartment-map", sample.loadApartmentMap(), [], 4],
    ["camping-map", sample.loadCampingMap(), [], 6],
    ["group-state", sample.loadGroupState().map, sample.loadGroupState().members, 0],
  ] as const;
  for (const [name, map, members, count] of fixtureMaps) {
    const checked = checkRules(map, [...members], { memberCount: count });
    const stale = checked.filter((rule, index) => rule.status !== map.rules[index].status);
    failures += stale.length;
    console.log(`   ${stale.length === 0 ? "ok  " : "FAIL"} ${name}: ${map.slots.length} slots, ${map.rules.length} rules${stale.length ? `, stale: ${stale.map((rule) => rule.id).join(", ")}` : ""}`);
  }
  for (const kind of ["bedroom", "office"] as const) {
    const parsed = generatedMapSchema.safeParse(starters.default[kind]);
    if (!parsed.success) failures += 1;
    console.log(`   ${parsed.success ? "ok  " : "FAIL"} starter structure: ${kind}`);
  }

  console.log(`2. Search cache (${mockAiEnabled() ? "MOCK_AI=1, sample catalog, no quota used" : "SerpApi"})`);
  const results = await Promise.all(DEMO_QUERIES.map(async (query) => [query, (await searchProducts(query)).length] as const));
  for (const [query, count] of results) {
    if (count === 0) failures += 1;
    console.log(`   ${count > 0 ? "ok  " : "FAIL"} ${query}: ${count} results`);
  }

  console.log("3. Demo prompt");
  const started = Date.now();
  const map = await generateMapFromPrompt(DEMO_PROMPT);
  const seconds = (Date.now() - started) / 1000;
  if (seconds > 15) failures += 1;
  console.log(`   ${seconds <= 15 ? "ok  " : "FAIL"} ${map.slots.length} slots, ${map.products.length} products in ${seconds.toFixed(1)}s`);
  for (const rule of map.rules) console.log(`        ${rule.status.padEnd(11)} ${rule.type}: ${rule.message}`);

  console.log("4. Demo group");
  if (!process.env.DATABASE_URL) {
    console.log("   skip  No DATABASE_URL. grp_apartment loads in memory when the server starts.");
  } else {
    const { seedDemoGroup } = await import("@/lib/db/queries");
    const where = await seedDemoGroup();
    console.log(`   ok    Seeded grp_apartment (${where}).`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nReady.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exit(1);
});
