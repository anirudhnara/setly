/**
 * Builds the catalog_items table from search results already in search_cache. Spends no SerpApi quota.
 * Run with `npm run catalog:seed`. Safe to rerun: items are upserted by id.
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const [{ getDb }, { searchCache }, { catalogItemsFromSearches, CATALOG_CATEGORIES, CATEGORY_TARGET }, { upsertCatalogItems }] =
    await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/db/schema"),
      import("@/lib/search/catalog"),
      import("@/lib/search/catalog-store"),
    ]);
  const rows = await getDb().select().from(searchCache);
  const searches = rows.map((row) => ({ query: row.query, products: productsFrom(row.resultsJson), fetchedAt: row.fetchedAt }));
  const items = catalogItemsFromSearches(searches);
  await upsertCatalogItems(items);

  const raw = searches.reduce((sum, search) => sum + search.products.length, 0);
  console.log(`${rows.length} cached searches, ${raw} results, ${items.length} catalog items after dedupe and the 3 star floor.`);
  for (const category of CATALOG_CATEGORIES) {
    const inCategory = items.filter((item) => item.category === category);
    const groups = new Set(inCategory.map((item) => item.variantGroup)).size;
    const flag = inCategory.length < CATEGORY_TARGET ? `  needs ${CATEGORY_TARGET - inCategory.length} more` : "";
    console.log(`  ${category.padEnd(12)} ${String(inCategory.length).padStart(4)} items, ${String(groups).padStart(4)} variant groups${flag}`);
  }
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
