/**
 * Imports hand-picked items from a CSV. Run with `npm run catalog:import -- path/to/items.csv`.
 * Columns: title,category,price,url,store,image_url,condition,source,added_by (see lib/search/catalog-import.ts).
 * Bad rows are reported by line and skipped; good rows are upserted.
 */
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path)) throw new Error("Pass the path to a CSV file");
  const [{ catalogItemsFromCsv }, { upsertCatalogItems }, { printCoverage }] = await Promise.all([
    import("@/lib/search/catalog-import"),
    import("@/lib/search/catalog-store"),
    import("./catalog-report"),
  ]);
  const { items, errors } = catalogItemsFromCsv(readFileSync(path, "utf8"), new Date());
  for (const error of errors) console.error(`  line ${error.line}: ${error.message}`);
  await upsertCatalogItems(items);
  console.log(`Imported ${items.length} items, skipped ${errors.length} rows.`);
  await printCoverage();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
