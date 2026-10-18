/**
 * Builds fixtures/space-catalog.json, the placeholder catalog for the 3D space, from real cached search results
 * (search_cache). Run: npx tsx --env-file=.env.local scripts/build-space-catalog.ts
 * When the pre-loaded store database is ready, lib/catalog/source.ts reads that instead; this file is only the stand-in.
 */
import { writeFileSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { searchCache } from "@/lib/db/schema";
import { categorize, themesFor } from "@/lib/catalog/taxonomy";
import type { CatalogItem } from "@/lib/catalog/source";
import { withoutJunk } from "@/lib/search/serpapi";
import type { Product } from "@/lib/types";

async function main() {
  const rows = await getDb().select().from(searchCache);
  const items = new Map<string, CatalogItem>();
  for (const row of rows) {
    const value = row.resultsJson as { products?: Product[] } | Product[];
    const products = withoutJunk(Array.isArray(value) ? value : (value.products ?? []), row.query);
    const category = categorize(row.query);
    if (!category) continue;
    for (const product of products) {
      const key = `${product.store}|${product.title}`.toLowerCase();
      if (items.has(key) || !/^https?:\/\//.test(product.imageUrl)) continue;
      const themes = [...new Set([...themesFor(row.query), ...themesFor(product.title)])];
      items.set(key, {
        id: `cat_${product.id.replace(/^serp_/, "")}`.slice(0, 60),
        title: product.title,
        store: product.store,
        priceCents: product.priceCents,
        url: product.url,
        imageUrl: product.imageUrl,
        category: category.label,
        room: category.room,
        themes: themes.length ? themes : ["Minimal"],
        rating: typeof product.attributes.rating === "number" ? product.attributes.rating : null,
      });
    }
  }
  const list = [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.priceCents - b.priceCents);
  writeFileSync("fixtures/space-catalog.json", `${JSON.stringify({ _note: "Placeholder catalog from cached real searches. Replace with the pre-loaded store database (see lib/catalog/source.ts).", items: list }, null, 1)}\n`);
  const byCategory = list.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.category]: (acc[item.category] ?? 0) + 1 }), {});
  console.log(list.length, "items", JSON.stringify(byCategory));
  process.exit(0);
}
void main();
