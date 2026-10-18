/**
 * Fills catalog_items from live sources. Dry run by default: prints the queries it would send.
 *
 *   npm run catalog:harvest -- --source serp            # preview
 *   npm run catalog:harvest -- --source serp --run --max 30
 *   npm run catalog:harvest -- --source bestbuy --run    # needs BESTBUY_API_KEY
 *   npm run catalog:harvest -- --source ebay --run       # needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET
 *
 * Each query's raw results are saved in search_cache under "catalog:<source>:<query>" before loading,
 * so reruns reload them for free and never spend the same search twice.
 */
import { existsSync } from "node:fs";
import type { Product } from "@/lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

type Source = "serp" | "bestbuy" | "ebay";

/** SerpApi covers everything for now; Best Buy and eBay are optional extras when their keys are set. */
const QUERIES: Record<Source, string[]> = {
  serp: [
    "velvet clothes hangers", "wooden clothes hangers", "space saving hangers",
    "picture frames set", "gallery wall frame set", "poster frame 24x36",
    "yoga mat", "adjustable dumbbells", "resistance bands set", "foam roller",
    "small desk for dorm", "standing desk", "desk with drawers",
    "twin xl mattress", "twin xl mattress topper", "twin xl bed frame", "loft bed frame",
    "dorm trash can", "trash can with lid", "portable cooler", "soft cooler bag", "mini fridge with freezer", "compact microwave",
    "wall shelves", "bookshelf for dorm", "ergonomic desk chair",
    "mushroom lamp", "sunset projection lamp", "neon sign light", "led strip lights", "lava lamp",
    // Best Buy's developer sign-up wasn't available, so SerpApi covers computers and electronics too.
    "laptop", "computer monitor", "wireless keyboard and mouse", "webcam", "laptop stand",
    "bluetooth speaker", "noise cancelling headphones", "desk fan", "surge protector power strip", "alarm clock",
  ],
  bestbuy: [
    "laptop", "computer monitor", "keyboard", "mouse", "webcam", "tablet",
    "headphones", "bluetooth speaker", "desk fan", "surge protector", "mini fridge", "microwave",
  ],
  ebay: [
    "desk", "desk chair", "mini fridge", "microwave", "bookshelf", "bed frame",
    "floor lamp", "dumbbells", "computer monitor", "picture frames",
  ],
};

const CATALOG_SOURCE = { serp: "search", bestbuy: "bestbuy", ebay: "ebay" } as const;

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const source = value("--source");
  if (source !== "serp" && source !== "bestbuy" && source !== "ebay") throw new Error("Pass --source serp, bestbuy, or ebay");
  const max = Number(value("--max") ?? QUERIES[source].length);
  if (!Number.isInteger(max) || max < 0) throw new Error("--max must be a whole number");
  return { source: source as Source, run: argv.includes("--run"), max };
}

async function main() {
  const { source, run, max } = parseArgs(process.argv.slice(2));
  const [{ getDb }, { searchCache }, { inArray }, { catalogItemFromProduct, CATEGORY_TARGET }, { upsertCatalogItems }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/schema"),
    import("drizzle-orm"),
    import("@/lib/search/catalog"),
    import("@/lib/search/catalog-store"),
  ]);
  const keyFor = (query: string) => `catalog:${source}:${query}`;
  const cachedRows = await getDb()
    .select()
    .from(searchCache)
    .where(inArray(searchCache.query, QUERIES[source].map(keyFor)));
  const cached = new Map(cachedRows.map((row) => [row.query, row]));
  const fresh = QUERIES[source].filter((query) => !cached.has(keyFor(query))).slice(0, max);

  console.log(`${source}: ${cached.size} queries already fetched (reloaded for free), ${fresh.length} new to send${run ? "" : " (dry run, pass --run to send)"}.`);
  for (const query of fresh) console.log(`  ${query}`);
  if (!run) process.exit(0);

  const load = async (query: string, products: Product[], fetchedAt: Date) => {
    const items = products.flatMap((product) => catalogItemFromProduct(product, query, fetchedAt, CATALOG_SOURCE[source]) ?? []);
    await upsertCatalogItems(items);
    return items.length;
  };
  let added = 0;
  for (const row of cached.values()) {
    added += await load(row.query.slice(`catalog:${source}:`.length), productsFrom(row.resultsJson), row.fetchedAt);
  }

  const search = await searcher(source);
  for (const query of fresh) {
    try {
      const products = await search(query);
      const now = new Date();
      // Save the raw results first so a failed load never wastes the search; a rerun reloads them from here.
      await getDb()
        .insert(searchCache)
        .values({ query: keyFor(query), resultsJson: { failure: null, products }, fetchedAt: now })
        .onConflictDoUpdate({ target: searchCache.query, set: { resultsJson: { failure: null, products }, fetchedAt: now } });
      const kept = await load(query, products, now);
      added += kept;
      console.log(`  ✓ ${query}: ${products.length} results, ${kept} kept`);
    } catch (error) {
      // Stop on the first failure so a bad key or exhausted quota doesn't burn through the list.
      const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error);
      console.error(`  ✗ ${query}: ${message}`);
      break;
    }
  }
  console.log(`Added or refreshed ${added} items. Coverage (target ${CATEGORY_TARGET} per category):`);
  await (await import("./catalog-report")).printCoverage();
  process.exit(0);
}

async function searcher(source: Source): Promise<(query: string) => Promise<Product[]>> {
  if (source === "serp") return (await import("@/lib/search/serpapi")).searchSerpApiForCatalog;
  if (source === "bestbuy") return (await import("@/lib/search/bestbuy")).searchBestBuy;
  const { searchEbay } = await import("@/lib/search/ebay");
  return (query) => searchEbay(query, { condition: "used" });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

function productsFrom(json: unknown): Product[] {
  if (typeof json !== "object" || json === null || !("products" in json) || !Array.isArray(json.products)) return [];
  return json.products as Product[];
}
