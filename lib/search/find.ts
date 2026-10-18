import { categorize } from "@/lib/catalog/taxonomy";
import { loadCatalog, type CatalogItem } from "@/lib/catalog/source";
import { sortByVibe, type VibeWeights } from "@/lib/catalog/vibes";
import { mockAiEnabled } from "@/lib/env";
import { databaseConfigured } from "@/lib/search/cache";
import { catalogItemToProduct, categorize as storedCategory, type CatalogItem as StoredItem } from "@/lib/search/catalog";
import { JUNK_TITLE, searchProducts } from "@/lib/search/serpapi";
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
  const fromCatalog = useStore ? await storedProducts(query) : await catalogProducts(query);
  // The catalog was just searched (more strictly than searchProducts would), so live search goes to the stores.
  const live = fromCatalog.length >= MIN_CATALOG ? [] : await searchProducts(query, { skipCatalog: useStore });
  // Live results get the same "is it actually the thing?" check as the catalog. Order of preference: relevant live
  // results, then the catalog's (already relevant) items, then whatever live search had rather than an empty slot.
  const relevant = live.length ? relevantProducts(query, live) : [];
  const results = relevant.length ? relevant : fromCatalog;
  if (results.length === 0) {
    // Nothing that is actually the thing: try once with just the item ("minimal clear under bed storage bins" →
    // "storage bins"), then the catalog without the exact-name rule (a "knife set" can be a "knife block set").
    // Still nothing means an empty slot the person can tap, never a random stand-in.
    const simpler = coreQuery(query);
    const retried = simpler && simpler !== query.toLowerCase().trim() ? await findProducts(simpler, vibes) : [];
    if (retried.length) return retried;
    const loose = useStore ? await storedProducts(query, false) : [];
    return sortByVibe(loose, vibes, (product) => String(product.attributes.themes ?? ""));
  }
  return sortByVibe(results, vibes, (product) => String(product.attributes.themes ?? ""));
}

/** The item itself from a styled query: its last two meaningful words ("led desk lamp" → "desk lamp"). */
export function coreQuery(query: string): string {
  const words = query.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return words.slice(-2).join(" ");
}

/** Catalog items for a need from the database, best matches first. Never throws: no database means no items. */
export async function storedProducts(query: string, strict = true): Promise<Product[]> {
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
    return pickStoredProducts(query, await entry.rows, strict);
  } catch (error) {
    console.warn(`Catalog read failed for "${query}": ${error instanceof Error ? error.message : "unknown error"}`);
    return [];
  }
}

const STOPWORDS = new Set(["the", "and", "for", "with", "set", "sets", "pack", "piece", "pcs", "inch", "size", "of"]);
const stem = (word: string) => word.replace(/(es|s)$/, "");

/**
 * Every item that is the thing asked for: it mentions the query's last noun ("lamp" in "minimal brass floor lamp"),
 * isn't an add-on named after it ("lamp shade"), and, when enough items carry the whole name ("floor lamp",
 * "bed pillow"), carries it too. Ordered by how many other query words it shares, then by quality. Vibe words in
 * the query rank items but never exclude them; the vibe sort does the rest. Pure, exported for tests.
 */
export function rankByRelevance<T>(query: string, items: T[], read: (item: T) => { title: string; text: string; quality: number }, options: { strict?: boolean } = {}): T[] {
  const words = [...new Set(query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/))].filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const nouns = words.filter((word) => !/\d/.test(word));
  const head = nouns.at(-1);
  if (!head) return [];
  const has = (text: string, word: string) => new RegExp(`\\b${stem(word)}`).test(text);
  const addOn = new RegExp(`\\b${stem(head)}s? (${ACCESSORY_WORDS})\\b|\\b(slipcovers?|replacement|refills?)\\b`, "i");
  const wantsAddOn = new RegExp(`\\b(${ACCESSORY_WORDS}|slipcovers?|replacement|refills?)\\b`, "i").test(query);
  const junk = (title: string) => (JUNK_TITLE.test(title) && !JUNK_TITLE.test(query)) || (NOVELTY.test(title) && !NOVELTY.test(query));
  // A different kind of the same thing ("throw pillow" for a bed pillow, "night lamp" for a desk lamp) is a lookalike.
  const lookalike = new RegExp(`\\b(${LOOKALIKES.filter((word) => !new RegExp(`\\b${word}\\b`, "i").test(query)).join("|") || "(?!)"})[\\s-]+${stem(head)}`, "i");
  const matches = items
    .map((item, index) => {
      const { title, text, quality } = read(item);
      const lower = `${title} ${text}`.toLowerCase();
      return { item, index, title: title.toLowerCase(), quality, hits: words.filter((word) => has(lower, word)).length };
    })
    // The item's own name has to say what it is; tags only help rank (a "rug"-tagged throw blanket isn't a rug).
    .filter((entry) => has(entry.title, head) && (wantsAddOn || !addOn.test(entry.title)) && !junk(entry.title) && !lookalike.test(entry.title))
    .sort((a, b) => b.hits - a.hits || b.quality - a.quality || a.index - b.index);
  // Weak matches (far fewer of the query's words than the best) are other things that share a word.
  const top = matches[0]?.hits ?? 0;
  const strong = top >= 3 ? matches.filter((entry) => entry.hits >= top - 1) : matches;
  // "floor lamp", "bed pillow", "desk chair": when enough names carry the whole thing, the rest are lookalikes.
  const modifier = nouns.at(-2);
  if (modifier && !SIZES.has(modifier)) {
    const phrase = new RegExp(`\\b${stem(modifier)}\\w*[\\s-]+${stem(head)}`);
    const exact = strong.filter((entry) => phrase.test(entry.title));
    if (exact.length >= MIN_CATALOG) return exact.map((entry) => entry.item);
    // Strict (the store catalog): too few carry the whole name, so the catalog doesn't really have this kind
    // ("bed pillow" when it only stocks throw pillows) and a live search should answer instead.
    if (options.strict) return exact.map((entry) => entry.item);
  }
  return strong.map((entry) => entry.item);
}

/** Store catalog items that are the thing asked for, well rated (or unrated), best first. Exported for tests. */
export function rankStoredItems(query: string, items: StoredItem[], strict = true): StoredItem[] {
  return rankByRelevance(
    query,
    items.filter((item) => item.rating === null || item.rating >= 3.5),
    (item) => ({ title: item.title, text: `${item.title} ${item.category.replace("_", " ")} ${tagWords(item.tags)}`, quality: item.qualityScore }),
    { strict },
  );
}

/** Live search results held to the same bar, keeping the store's order among equals. Exported for tests. */
export function relevantProducts(query: string, products: Product[]): Product[] {
  return rankByRelevance(query, products, (product) => ({ title: product.title, text: product.title, quality: 0 }));
}

/**
 * What a slot gets from the catalog: ranked matches minus junk (digital plans, keychains, miniatures), then
 * the best few plus the cheapest good ones, so a tight slot budget still has a real pick. No price-outlier cut:
 * the catalog spans $70 and $2,800 mattresses, and the cheap real ones are exactly what a dorm budget needs.
 * Pure, exported for tests.
 */
export function pickStoredProducts(query: string, items: StoredItem[], strict = true): Product[] {
  const clean = rankStoredItems(query, items, strict).map(storedToProduct);
  const best = clean.slice(0, MAX_RESULTS - BUDGET_PICKS);
  const cheaper = clean.slice(best.length).sort((a, b) => a.priceCents - b.priceCents).slice(0, BUDGET_PICKS);
  return [...best, ...cheaper];
}

/** Add-ons named after the product ("sofa cover", "lamp shade"), skipped unless the query asks for one. */
const ACCESSORY_WORDS = "covers?|shades?|legs?|protectors?|parts?|brackets?|toppers?|pads?|encasements?";
/** Small stand-ins for the real thing ("miniature desk lamp", "lava lamp keychain"). */
const NOVELTY = /\b(miniature|mini figure|dollhouse|keychains?|key chains?|ornaments?|figurines?|toy|charms?|stickers?|magnets?|samples?|swatch(es)?)\b/i;
/** Words that make a different kind of the same thing, skipped unless the query says them. */
const LOOKALIKES = ["throw", "decorative", "lumbar", "accent", "outdoor", "night", "lava", "sunset", "projection", "neon", "novelty", "toy", "pet", "dog", "cat", "kids", "baby"];
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

/** Placeholder JSON catalog items in the query's category, most query words in the title first. Exported for tests. */
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
