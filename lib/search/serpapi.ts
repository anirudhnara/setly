import { mockAiEnabled } from "@/lib/env";
import { loadApartmentMap, loadCampingMap } from "@/lib/fixtures/sample";
import type { Product } from "@/lib/types";
import { getCachedSearch, setCachedSearch } from "@/lib/search/cache";
import { normalizeStore } from "@/lib/search/normalize";

function sampleProducts(query: string): Product[] {
  const source = /camp|tent|trail|stove/i.test(query) ? loadCampingMap() : loadApartmentMap();
  const needle = query.trim().toLowerCase();
  const matches = source.products.filter((product) => {
    const haystack = `${product.title} ${product.store}`.toLowerCase();
    return needle.length === 0 || haystack.includes(needle) || needle.split(/\s+/).some((word) => word.length > 2 && haystack.includes(word));
  });
  return (matches.length > 0 ? matches : source.products).map((product) => ({
    ...product,
    store: normalizeStore(product.store),
  }));
}

export async function searchProducts(query: string): Promise<Product[]> {
  if (mockAiEnabled()) {
    const cached = getCachedSearch(query);
    if (cached) return cached;
    const results = sampleProducts(query);
    setCachedSearch(query, results);
    return results;
  }
  // TODO(Backend 2 (Maps)): call SerpApi Google Shopping. Prices come from this response, never from the model.
  void process.env.SERPAPI_KEY;
  throw new Error("not implemented");
}
