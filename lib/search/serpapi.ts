import catalogJson from "@/fixtures/catalog.json";
import { getEnv, mockAiEnabled } from "@/lib/env";
import type { Product } from "@/lib/types";
import { getCachedSearch, setCachedSearch, type CacheFailure } from "@/lib/search/cache";
import { dollarsToCents, normalizePriceToCents, normalizeQuery, normalizeStore, shortHash } from "@/lib/search/normalize";

/**
 * Search results are slot-free: `slotId` is "" and `id` is a stable source id.
 * `lib/search/options.ts` attaches them to a slot and gives them slot-scoped ids.
 */
const SEARCH_TIMEOUT_MS = 6000;
const MAX_RESULTS = 8;

interface CatalogEntry {
  need: string;
  keywords: string[];
  products: { key: string; title: string; store: string; priceCents: number; url: string; imageUrl: string; attributes: Record<string, string | number> }[];
}

const catalog = (catalogJson as { entries: CatalogEntry[] }).entries;

/** Sample catalog lookup used by MOCK_AI=1 and as the fallback when SerpApi fails. Returns [] when nothing matches. */
export function searchCatalog(query: string): Product[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const words = needle.split(" ").filter((word) => word.length > 2);
  let best: { entry: CatalogEntry; score: number } | null = null;
  for (const entry of catalog) {
    const need = entry.need.toLowerCase();
    let score = 0;
    if (needle === need || needle === `${need}s` || `${needle}s` === need) score += 100;
    for (const keyword of entry.keywords) {
      if (new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(needle)) score += 10 + keyword.length;
    }
    for (const word of words) {
      if (need.includes(word)) score += 3;
    }
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  if (!best) return [];
  return best.entry.products.map((item) => ({
    id: `cat_${item.key}`,
    slotId: "",
    title: item.title,
    store: normalizeStore(item.store),
    priceCents: item.priceCents,
    url: item.url,
    imageUrl: item.imageUrl,
    attributes: { ...item.attributes, source: "sample" },
  }));
}

/**
 * Real products for a query. Prices, stores, and URLs come from this data, never from the model.
 * Every outcome is cached, failures included, so a bad query doesn't spend quota on every map.
 * A failure serves the sample catalog, which is never written to the cache as if it were real.
 */
export async function searchProducts(query: string): Promise<Product[]> {
  if (mockAiEnabled()) return searchCatalog(query);
  const cached = await getCachedSearch(query);
  if (cached) return cached.failure ? searchCatalog(query) : cached.results;
  try {
    const results = await searchSerpApi(query);
    if (results.length > 0) {
      await setCachedSearch(query, results);
      return results;
    }
    await setCachedSearch(query, [], "empty");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`SerpApi search failed for "${query}": ${message}`);
    await setCachedSearch(query, [], failureKind(error));
  }
  return searchCatalog(query);
}

/** Out of searches or a bad key won't fix itself in minutes; a timeout might. */
export function failureKind(error: unknown): CacheFailure {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof SerpApiError && (error.status === 401 || error.status === 403 || error.status === 429)) return "quota";
  return /run out of searches|searches per|invalid api key|limit/i.test(message) ? "quota" : "error";
}

class SerpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface SerpShoppingResult {
  title?: unknown;
  product_id?: unknown;
  link?: unknown;
  product_link?: unknown;
  source?: unknown;
  price?: unknown;
  extracted_price?: unknown;
  thumbnail?: unknown;
  serpapi_thumbnail?: unknown;
  rating?: unknown;
  reviews?: unknown;
  delivery?: unknown;
  second_hand_condition?: unknown;
}

async function searchSerpApi(query: string): Promise<Product[]> {
  const apiKey = getEnv().SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY is not set");
  const params = new URLSearchParams({ engine: "google_shopping", q: query, gl: "us", hl: "en", api_key: apiKey });
  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.json().then((body: unknown) => (isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : ""), () => "");
    throw new SerpApiError(`SerpApi responded ${response.status}${detail}`, response.status);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("SerpApi returned an unexpected body");
  if (typeof body.error === "string") throw new Error(body.error);
  const raw = Array.isArray(body.shopping_results) ? (body.shopping_results as SerpShoppingResult[]) : [];
  return toProducts(raw);
}

/** Exported for tests. Drops results without a price, store, or link, used items, and duplicates. */
export function toProducts(raw: SerpShoppingResult[]): Product[] {
  const seen = new Set<string>();
  const products: Product[] = [];
  for (const item of raw) {
    if (products.length >= MAX_RESULTS) break;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const store = typeof item.source === "string" ? normalizeStore(item.source) : "";
    const url = typeof item.link === "string" ? item.link : typeof item.product_link === "string" ? item.product_link : "";
    const priceCents =
      typeof item.extracted_price === "number"
        ? dollarsToCents(item.extracted_price)
        : typeof item.price === "string"
          ? normalizePriceToCents(item.price)
          : 0;
    if (!title || !store || !url || priceCents <= 0 || item.second_hand_condition) continue;
    const dedupeKey = `${store.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const attributes: Record<string, string | number> = {};
    if (typeof item.rating === "number") attributes.rating = item.rating;
    if (typeof item.reviews === "number") attributes.reviews = item.reviews;
    if (typeof item.delivery === "string") attributes.delivery = item.delivery;
    const imageUrl =
      typeof item.thumbnail === "string" && item.thumbnail
        ? item.thumbnail
        : typeof item.serpapi_thumbnail === "string" && item.serpapi_thumbnail
          ? item.serpapi_thumbnail
          : `https://placehold.co/480x360?text=${encodeURIComponent(title.slice(0, 40))}`;
    const sourceId = typeof item.product_id === "string" && item.product_id ? item.product_id : shortHash(dedupeKey);
    products.push({ id: `serp_${sourceId}`, slotId: "", title, store, priceCents, url, imageUrl, attributes });
  }
  return products;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
