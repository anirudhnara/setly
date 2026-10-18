import { categorize } from "@/lib/catalog/taxonomy";
import { loadCatalog, type CatalogItem } from "@/lib/catalog/source";
import { sortByVibe, type VibeWeights } from "@/lib/catalog/vibes";
import { searchProducts } from "@/lib/search/serpapi";
import type { Product } from "@/lib/types";

/**
 * Products for one need, the way every step finds them: the store catalog first (the pre-loaded database once it
 * lands), live search only when the catalog has too little for it (falling back to what it has), then re-ordered by the group's vibe.
 * Prices, stores, and links always come from the data.
 */
const MAX_RESULTS = 8;
const MIN_CATALOG = 3;

export async function findProducts(query: string, vibes: VibeWeights = {}): Promise<Product[]> {
  const fromCatalog = await catalogProducts(query);
  const live = fromCatalog.length >= MIN_CATALOG ? [] : await searchProducts(query);
  // A slow or empty live search still gets the closest catalog items rather than an empty slot.
  const results = live.length ? live : fromCatalog;
  return sortByVibe(results, vibes, (product) => String(product.attributes.themes ?? ""));
}

/** Catalog items in the query's category, most query words in the title first. Exported for tests. */
export async function catalogProducts(query: string): Promise<Product[]> {
  const category = categorize(query);
  if (!category) return [];
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const items = (await loadCatalog()).filter((item) => item.category === category.label);
  return items
    .map((item, index) => ({ item, index, hits: words.filter((word) => item.title.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.hits - a.hits || (b.item.rating ?? 0) - (a.item.rating ?? 0) || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ item }) => toProduct(item));
}

function toProduct(item: CatalogItem): Product {
  return {
    id: item.id,
    slotId: "",
    title: item.title,
    store: item.store,
    priceCents: item.priceCents,
    url: item.url,
    imageUrl: item.imageUrl,
    attributes: { source: "catalog", themes: item.themes.join(" "), ...(item.rating ? { rating: item.rating } : {}) },
  };
}
