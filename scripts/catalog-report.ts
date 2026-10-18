/** Prints catalog coverage per category against the target. Run with `npm run catalog:report`. */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export async function printCoverage() {
  const [{ CATALOG_CATEGORIES, CATEGORY_TARGET }, { catalogCoverage }] = await Promise.all([
    import("@/lib/search/catalog"),
    import("@/lib/search/catalog-store"),
  ]);
  const rows = new Map((await catalogCoverage()).map((row) => [row.category, row]));
  let total = 0;
  for (const category of CATALOG_CATEGORIES) {
    const row = rows.get(category) ?? { items: 0, variantGroups: 0, used: 0 };
    total += row.items;
    const flag = category !== "other" && row.items < CATEGORY_TARGET ? `  needs ${CATEGORY_TARGET - row.items} more` : "";
    console.log(
      `  ${category.padEnd(12)} ${String(row.items).padStart(4)} items  ${String(row.variantGroups).padStart(4)} variant groups  ${String(row.used).padStart(3)} used${flag}`,
    );
  }
  console.log(`  ${"total".padEnd(12)} ${String(total).padStart(4)} items`);
}

if (process.argv[1]?.endsWith("catalog-report.ts")) {
  printCoverage()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
