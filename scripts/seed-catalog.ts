/**
 * Builds the catalog_items table from search results already in search_cache. Spends no SerpApi quota.
 * Run with `npm run catalog:seed`. Safe to rerun: items are upserted by id.
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const [{ getDb }, { searchCache }, { catalogItemsFromSearches }, { upsertCatalogItems }, { printCoverage }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/schema"),
    import("@/lib/search/catalog"),
    import("@/lib/search/catalog-store"),
    import("./catalog-report"),
  ]);
  // "catalog:" rows are written by harvest-catalog.ts, which already loaded them with their real source.
  const rows = (await getDb().select().from(searchCache)).filter((row) => !row.query.startsWith("catalog:"));
  const searches = rows.map((row) => ({ query: row.query, products: productsFrom(row.resultsJson), fetchedAt: row.fetchedAt }));
  const items = catalogItemsFromSearches(searches);
  await upsertCatalogItems(items);

  const raw = searches.reduce((sum, search) => sum + search.products.length, 0);
  console.log(`${rows.length} cached searches, ${raw} results, ${items.length} catalog items after dedupe and the 3 star floor.`);
  await printCoverage();
  process.exit(0);
}

/** search_cache rows hold `{ products, failure }`; failed searches have no products. */
function productsFrom(json: unknown) {
  if (typeof json !== "object" || json === null || !("products" in json) || !Array.isArray(json.products)) return [];
  return json.products as import("@/lib/types").Product[];
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
