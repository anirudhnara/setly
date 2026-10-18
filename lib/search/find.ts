import { categorize } from "@/lib/catalog/taxonomy";
import { loadCatalog, type CatalogItem } from "@/lib/catalog/source";
import { sortByVibe, type VibeWeights } from "@/lib/catalog/vibes";
import { mockAiEnabled } from "@/lib/env";
import { databaseConfigured } from "@/lib/search/cache";
import { catalogItemToProduct, categorize as storedCategory, type CatalogItem as StoredItem } from "@/lib/search/catalog";
import { JUNK_TITLE, searchProducts } from "@/lib/search/serpapi";
import { demoStoreProducts } from "@/lib/stores/catalog";
import type { Product } from "@/lib/types";

/**
 * Products for one need, the way every step finds them: the Tiger store catalog (catalog_items) first, live search
 * only when the catalog has too little for it (falling back to what it has), then re-ordered by the group's vibe
 * using the catalog's Gemini color and style tags. Without a database (tests, MOCK_AI=1) the placeholder JSON
 * catalog stands in. Prices, stores, and links always come from the data.
 */
const MAX_RESULTS = 8;
const MIN_CATALOG = 3;
/** Candidates read per category: enough to cover every item in today's catalog, still one indexed read. */
const CANDIDATES = 400;
/** A category's rows are reused briefly, so growing a set and opening alternatives don't re-read them. */
const CATEGORY_TTL_MS = 5 * 60_000;
const categoryCache = new Map<string, { at: number; rows: Promise<StoredItem[]> }>();

export async function findProducts(query: string, vibes: VibeWeights = {}): Promise<Product[]> {
  const useStore = !mockAiEnabled() && databaseConfigured();
  // The demo stores lead either source, so a generated plan has protocol-lane stores to check out from.
  const fromCatalog = useStore ? withDemoStores(query, await storedProducts(query)) : await catalogProducts(query);
  const live = fromCatalog.length >= MIN_CATALOG ? [] : await searchProducts(query);
  // A slow or empty live search still gets the closest catalog items rather than an empty slot.
  const results = live.length ? live : fromCatalog;
  return sortByVibe(results, vibes, (product) => String(product.attributes.themes ?? ""));
}

/** Catalog items for a need from the database, best matches first. Never throws: no database means no items. */
export async function storedProducts(query: string): Promise<Product[]> {
  const category = storedCategory(query, "");
  if (category === "other") return [];
  try {
    let entry = categoryCache.get(category);
    if (!entry || Date.now() - entry.at > CATEGORY_TTL_MS) {
      const rows = import("@/lib/search/catalog-store").then(({ listCatalogItems }) => listCatalogItems({ category, condition: "new", limit: CANDIDATES }));
      entry = { at: Date.now(), rows };
      categoryCache.set(category, entry);
      // A failed read isn't kept, so the next request tries again.
      rows.catch(() => categoryCache.delete(category));
    }
    return pickStoredProducts(query, await entry.rows);
  } catch (error) {
    console.warn(`Catalog read failed for "${query}": ${error instanceof Error ? error.message : "unknown error"}`);
    return [];
  }
}

const STOPWORDS = new Set(["the", "and", "for", "with", "set", "pack", "piece", "pcs", "inch", "size"]);
const stem = (word: string) => word.replace(/(es|s)$/, "");

/**
 * Every item that is the thing asked for (they mention the query's last noun: "lamp" in "minimal brass floor lamp"),
 * ordered by how many other query words they share (title and tags), then by quality. Vibe words in the query
 * rank items but never exclude them; the vibe sort does the rest. Pure, exported for tests.
 */
export function rankStoredItems(query: string, items: StoredItem[]): StoredItem[] {
  const words = [...new Set(query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/))].filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const head = words.findLast((word) => !/\d/.test(word));
  if (!head) return [];
  const has = (text: string, word: string) => new RegExp(`\\b${stem(word)}`).test(text);
  const addOn = new RegExp(`\\b${stem(head)}s? (${ACCESSORY_WORDS})\\b|\\b(slipcovers?|replacement|refills?)\\b`, "i");
  const wantsAddOn = new RegExp(`\\b(${ACCESSORY_WORDS}|slipcovers?|replacement|refills?)\\b`, "i").test(query);
  const matches = items
    .filter((item) => (item.rating === null || item.rating >= 3.5) && (wantsAddOn || !addOn.test(item.title)))
    .map((item) => {
      const text = `${item.title} ${item.category.replace("_", " ")} ${tagWords(item.tags)}`.toLowerCase();
      return { item, text, hits: words.filter((word) => has(text, word)).length };
    })
    .filter((entry) => has(entry.text, head))
    .sort((a, b) => b.hits - a.hits || b.item.qualityScore - a.item.qualityScore);
  // "floor lamp", "desk chair", "coffee table": when enough items carry the whole name, the rest are other things.
  const words2 = query.toLowerCase().match(/([a-z]+)\s+([a-z]+)\s*$/);
  if (words2 && !STOPWORDS.has(words2[2]) && !SIZES.has(words2[1])) {
    const phrase = new RegExp(`\\b${stem(words2[1])}\\w*[\\s-]+${stem(words2[2])}`);
    const exact = matches.filter((entry) => phrase.test(entry.text));
    if (exact.length >= MIN_CATALOG) return exact.map((entry) => entry.item);
  }
  return matches.map((entry) => entry.item);
}

/**
 * What a slot gets from the catalog: ranked matches minus junk (digital plans, keychains, miniatures), then
 * the best few plus the cheapest good ones, so a tight slot budget still has a real pick. No price-outlier cut:
 * the catalog spans $70 and $2,800 mattresses, and the cheap real ones are exactly what a dorm budget needs.
 * Pure, exported for tests.
 */
export function pickStoredProducts(query: string, items: StoredItem[]): Product[] {
  const junk = (title: string) => (JUNK_TITLE.test(title) && !JUNK_TITLE.test(query)) || (NOVELTY.test(title) && !NOVELTY.test(query));
  const clean = rankStoredItems(query, items).filter((item) => !junk(item.title)).map(storedToProduct);
  const best = clean.slice(0, MAX_RESULTS - BUDGET_PICKS);
  const cheaper = clean.slice(best.length).sort((a, b) => a.priceCents - b.priceCents).slice(0, BUDGET_PICKS);
  return [...best, ...cheaper];
}

/** Add-ons named after the product ("sofa cover", "lamp shade"), skipped unless the query asks for one. */
const ACCESSORY_WORDS = "covers?|shades?|legs?|protectors?|parts?|brackets?|toppers?|pads?|encasements?";
/** Small stand-ins for the real thing ("miniature desk lamp", "lava lamp keychain"). */
const NOVELTY = /\b(miniature|mini figure|dollhouse|keychains?|key chains?|ornaments?|figurines?|toy|charms?|stickers?|magnets?)\b/i;
/** Size words describe the thing, they don't name it ("twin xl mattress" is a mattress, not an "xl mattress"). */
const SIZES = new Set(["twin", "xl", "full", "queen", "king", "small", "large", "mini", "compact", "oversized", "tall", "narrow", "inch"]);
const BUDGET_PICKS = 3;

/** Gemini's styles mapped to the words our vibe matchers know ("mid_century" → "mid-century"). */
const STYLE_WORDS: Record<string, string> = {
  minimalist: "minimal",
  mid_century: "mid-century",
  retro: "retro",
  japandi: "scandinavian minimal",
  rustic: "rustic wood",
  glam: "velvet gold",
  cottagecore: "cozy",
  outdoorsy: "durable",
  playful: "colorful",
  quirky: "colorful",
};

/**
 * The catalog's tags as plain words the vibe matchers in lib/catalog/vibes.ts recognize, so an item tagged
 * warm neutral or earth tones ranks for "Warm neutrals" or "Earthy" even when its title never says so.
 */
export function tagWords(tags: StoredItem["tags"]): string {
  const { color, styles = [], themes = [], colors = [], sizes = [] } = tags;
  const words = [...themes, ...colors, ...sizes, ...styles.map((style) => STYLE_WORDS[style] ?? style.replace("_", " "))];
  if (color) {
    words.push(color.family);
    if (color.palette === "earth_tones") words.push("earthy terracotta");
    if (color.palette === "neutrals" && color.temperature === "warm") words.push("warm beige");
    if (color.palette === "metallics") words.push("metal");
    if (color.temperature === "cool") words.push("cool slate");
    if (color.saturation === "vivid" && (color.palette === "brights" || color.palette === "jewel_tones" || color.palette === "multicolor")) words.push("vibrant");
  }
  return words.join(" ");
}

function storedToProduct(item: StoredItem): Product {
  const product = catalogItemToProduct(item);
  return { ...product, attributes: { ...product.attributes, themes: tagWords(item.tags) } };
}

/** Demo-store matches first (at most half the results), then the rest. */
function withDemoStores(query: string, products: Product[]): Product[] {
  const demo = demoStoreProducts(query).slice(0, MAX_RESULTS / 2);
  return [...demo, ...products].slice(0, MAX_RESULTS);
}

/**
 * Demo-store items, then placeholder JSON catalog items in the query's category, most query words in the
 * title first. Exported for tests.
 */
export async function catalogProducts(query: string): Promise<Product[]> {
  const category = categorize(query);
  if (!category) return [];
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const items = (await loadCatalog()).filter((item) => item.category === category.label);
  const fromCatalog = items
    .map((item, index) => ({ item, index, hits: words.filter((word) => item.title.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.hits - a.hits || (b.item.rating ?? 0) - (a.item.rating ?? 0) || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ item }) => toProduct(item));
  return withDemoStores(query, fromCatalog);
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
