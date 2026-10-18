import { z } from "zod";
import type { catalogItems } from "@/lib/db/schema";
import type { Product } from "@/lib/types";
import { shortHash } from "@/lib/search/normalize";

/**
 * Pure catalog logic: categorize, score, tag, and group search results into catalog items.
 * No database or network calls; lib/search/catalog-store.ts does the IO.
 */

export type CatalogItem = typeof catalogItems.$inferSelect;

export const CATALOG_CATEGORIES = [
  "lighting", "desk_chair", "mattress", "bed_frame", "frames", "mini_fridge", "microwave", "cooler", "trash_can",
  "hangers", "shelving", "computer", "electronics", "athletics", "desk", "seating", "tables", "decor", "other",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/** Every category we want deep coverage of, so a set can be swapped item by item. */
export const CATEGORY_TARGET = 50;

/** First match wins, so specific phrases ("desk lamp", "bed frame") come before broad ones ("desk", "frame"). */
const CATEGORY_RULES: [CatalogCategory, RegExp][] = [
  ["lighting", /\b(lamps?|lights?|lighting|sconces?|lanterns?|led strips?)\b/],
  ["desk_chair", /\b(desk|office|gaming|task|computer) chairs?\b/],
  ["mattress", /\bmattress(es)?\b/],
  ["bed_frame", /\b(bed ?frames?|platform beds?|loft beds?|bunk beds?|headboards?)\b/],
  ["frames", /\b((picture|photo|poster|wall) frames?|frames)\b/],
  ["mini_fridge", /\b(mini[- ]?fridges?|fridges?|refrigerators?)\b/],
  ["microwave", /\bmicrowaves?\b/],
  ["cooler", /\bcoolers?\b/],
  ["trash_can", /\b(trash (can|bin)s?|waste ?(bin|basket)s?|wastebaskets?|garbage cans?)\b/],
  ["hangers", /\bhangers?\b/],
  ["shelving", /\b(shel(f|ves|ving)|bookshel(f|ves)|bookcases?|cube organizers?|storage cubes?)\b/],
  ["computer", /\b(laptops?|monitors?|keyboards?|mouse|computers?|chromebooks?|macbook|webcams?)\b/],
  ["electronics", /\b(headphones?|earbuds|speakers?|chargers?|power strips?|surge protectors?|tablets?|tvs?|television|fans?|alarm clocks?)\b/],
  ["athletics", /\b(dumbbells?|yoga mats?|kettlebells?|resistance bands?|jump ropes?|foam rollers?|exercise|fitness|workout|basketball|soccer ball)\b/],
  ["desk", /\b(desks?|writing tables?)\b/],
  ["seating", /\b(sofas?|couch(es)?|loveseats?|sectionals?|armchairs?|accent chairs?|ottomans?|bean bags?|futons?|chairs?|seating)\b/],
  ["tables", /\b(tables?|nightstands?)\b/],
  ["decor", /\b(rugs?|pillows?|blankets?|throws?|curtains?|wall art|posters?|plants?|houseplants?|planters?|mirrors?|tapestr(y|ies)|vases?|candles?|decor)\b/],
];

export function categorize(query: string, title: string): CatalogCategory {
  // The query says what we searched for, so it beats the title ("cozy rug" can return a rug named "Cloud Lamp Rug").
  for (const text of [query, title]) {
    const lower = text.toLowerCase();
    for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(lower)) return category;
  }
  return "other";
}

const COLORS: [string, RegExp][] = [
  ["black", /\bblack\b/], ["white", /\bwhite\b/], ["gray", /\bgr[ae]y\b/], ["beige", /\bbeige\b/],
  ["cream", /\b(cream|ivory|off[- ]white)\b/], ["brown", /\b(brown|espresso|chocolate)\b/], ["tan", /\b(tan|camel)\b/],
  ["natural", /\b(natural|oak|walnut|bamboo|wood(en)?)\b/], ["navy", /\bnavy\b/], ["blue", /\bblue\b/],
  ["green", /\b(green|sage|olive)\b/], ["pink", /\b(pink|blush)\b/], ["red", /\bred\b/], ["orange", /\b(orange|rust)\b/],
  ["yellow", /\b(yellow|mustard)\b/], ["purple", /\b(purple|lavender|lilac)\b/], ["gold", /\b(gold|brass)\b/],
  ["silver", /\b(silver|chrome)\b/], ["multicolor", /\b(rainbow|multicolou?r|rgb)\b/],
];
const NEUTRAL_COLORS = new Set(["black", "white", "gray", "beige", "cream", "brown", "tan", "natural", "silver"]);

const THEMES: [string, RegExp][] = [
  ["cozy", /\b(cozy|plush|sherpa|fleece|knit|chunky|fluffy|faux fur|boucle)\b/],
  ["minimalist", /\b(minimalist|minimal|simple|sleek)\b/],
  ["modern", /\b(modern|contemporary)\b/],
  ["mid_century", /\bmid[- ]century\b/],
  ["industrial", /\b(industrial|metal pipe)\b/],
  ["rustic", /\b(rustic|farmhouse|reclaimed|distressed)\b/],
  ["boho", /\b(boho|bohemian|rattan|macrame|jute|wicker)\b/],
  ["scandinavian", /\b(scandinavian|nordic|scandi)\b/],
  ["retro", /\b(retro|vintage|groovy|70s|80s)\b/],
  ["quirky", /\b(mushroom|neon|novelty|cloud|moon|dinosaur|frog|cute|funny|lava|disco|squiggle|wavy|kawaii|ufo|astronaut)\b/],
  ["gaming", /\b(gaming|gamer|rgb)\b/],
  ["glam", /\b(glam|marble|crystal|velvet)\b/],
];
/** Themes that pair with almost anything, so they don't make an item a set anchor. */
const NEUTRAL_THEMES = new Set(["minimalist", "modern", "scandinavian"]);

const SIZE_PATTERN = /\b(twin xl|twin|full|queen|king|compact|mini|small|large|oversized|tall|narrow|\d+\s?x\s?\d+)\b/g;

const HEALTH = /\b(ergonomic|lumbar|memory foam|orthopedic|hypoallergenic|bpa[- ]free|non[- ]toxic|certipur|breathable|air purifier|blue light|standing desk|height adjustable)\b/;
const PRACTICAL = /\b(storage|foldable|folding|collapsible|adjustable|stackable|space[- ]saving|2[- ]in[- ]1|washable|portable|rolling|wheels|drawers?)\b/;
const USABLE = /\b(easy (assembly|to clean)|no tools|remote|touch|dimmable|usb|quiet|lightweight)\b/;

/** Base usability, practicality, health (1 to 5) per category before title keywords adjust them. */
const BASE_SCORES: Record<CatalogCategory, [number, number, number]> = {
  lighting: [4, 3, 3], desk_chair: [4, 4, 3], mattress: [3, 4, 4], bed_frame: [3, 4, 3], frames: [4, 2, 3],
  mini_fridge: [4, 5, 3], microwave: [4, 5, 3], cooler: [4, 4, 3], trash_can: [4, 5, 3], hangers: [5, 5, 3],
  shelving: [3, 5, 3], computer: [4, 5, 3], electronics: [4, 4, 3], athletics: [3, 3, 5], desk: [3, 5, 3],
  seating: [4, 3, 3], tables: [3, 4, 3], decor: [4, 2, 3], other: [3, 3, 3],
};

/** Prior for the weighted rating: an item needs reviews before its own stars outweigh the average. */
const PRIOR_RATING = 4;
const PRIOR_WEIGHT = 30;
const UNRATED_SCORE = 3.5;
export const MIN_RATING = 3;

/** Rating pulled toward 4.0 when there are few reviews, so 4.6 with 3,000 reviews beats 5.0 with 4. */
export function qualityScore(rating: number | null, reviews: number | null): number {
  if (rating === null) return UNRATED_SCORE;
  const count = Math.max(0, reviews ?? 0);
  return round((count * rating + PRIOR_WEIGHT * PRIOR_RATING) / (count + PRIOR_WEIGHT), 3);
}

/** Latest delivery day when the text gives one ("Delivery in 3-5 days" is 5). Vague text is null. */
export function shippingDaysMax(delivery: string | null): number | null {
  if (!delivery) return null;
  const text = delivery.toLowerCase();
  if (/\b(today|same[- ]day)\b/.test(text)) return 0;
  if (/\b(tomorrow|next[- ]day|overnight)\b/.test(text)) return 1;
  const range = text.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:business\s+)?days?/);
  if (range) return Number(range[2]);
  const single = text.match(/(\d+)[- ]?(?:business\s+)?days?/);
  return single ? Number(single[1]) : null;
}

export function tagTitle(title: string) {
  const lower = title.toLowerCase();
  const colors = COLORS.filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  const themes = THEMES.filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  const sizes = [...new Set([...lower.matchAll(SIZE_PATTERN)].map((match) => match[1].replace(/\s/g, "")))];
  return { colors, themes, sizes };
}

/** Anchors set a set's look (a strong theme or a bold color). Neutral items fit into many sets. */
export function roleFor(tags: { colors: string[]; themes: string[] }): "anchor" | "neutral" {
  const boldTheme = tags.themes.some((theme) => !NEUTRAL_THEMES.has(theme));
  const boldColor = tags.colors.some((color) => !NEUTRAL_COLORS.has(color));
  return boldTheme || boldColor ? "anchor" : "neutral";
}

export function scoresFor(category: CatalogCategory, title: string, reviews: number | null) {
  const lower = title.toLowerCase();
  const [usability, practicality, health] = BASE_SCORES[category];
  return {
    usability: Math.min(5, usability + (USABLE.test(lower) ? 1 : 0)),
    practicality: Math.min(5, practicality + (PRACTICAL.test(lower) ? 1 : 0)),
    health: Math.min(5, health + (HEALTH.test(lower) ? 1 : 0)),
    popularity: round(Math.min(1, Math.log10((reviews ?? 0) + 1) / 4), 2),
  };
}

const VARIANT_STOPWORDS = new Set([
  "a", "an", "and", "the", "for", "with", "of", "in", "inch", "inches", "ft", "set", "pack", "pcs", "piece", "pieces", "x",
]);

/**
 * Near-duplicates (the same item in another color or size) share a group so a set can swap between them.
 * The group is the category plus the first five words left after removing colors, sizes, and numbers.
 */
export function variantGroup(category: CatalogCategory, title: string): string {
  let text = title.toLowerCase();
  for (const [, pattern] of COLORS) text = text.replace(new RegExp(pattern.source, "g"), " ");
  text = text.replace(SIZE_PATTERN, " ").replace(/[^a-z\s]/g, " ");
  const words = text.split(/\s+/).filter((word) => word.length > 1 && !VARIANT_STOPWORDS.has(word));
  return `${category}:${shortHash(words.slice(0, 5).join(" "))}`;
}

function numberAttribute(attributes: Record<string, string | number>, key: string): number | null {
  const value = attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One search result as a catalog item, or null when it's rated below 3 stars. */
export function catalogItemFromProduct(product: Product, query: string, fetchedAt: Date): CatalogItem | null {
  const rating = numberAttribute(product.attributes, "rating");
  if (rating !== null && rating < MIN_RATING) return null;
  const reviewCount = numberAttribute(product.attributes, "reviews");
  const delivery = typeof product.attributes.delivery === "string" ? product.attributes.delivery : null;
  const category = categorize(query, product.title);
  const tags = tagTitle(product.title);
  return {
    id: product.id,
    category,
    title: product.title,
    store: product.store,
    priceCents: product.priceCents,
    url: product.url,
    imageUrl: product.imageUrl,
    condition: "new",
    source: "search",
    rating,
    reviewCount,
    qualityScore: qualityScore(rating, reviewCount),
    delivery,
    shippingDaysMax: shippingDaysMax(delivery),
    variantGroup: variantGroup(category, product.title),
    role: roleFor(tags),
    tags,
    scores: scoresFor(category, product.title, reviewCount),
    attributes: product.attributes,
    searchQuery: query,
    addedBy: null,
    fetchedAt,
  };
}

/** Builds catalog items from cached searches. Keeps the newest copy of each product and drops items under 3 stars. */
export function catalogItemsFromSearches(searches: { query: string; products: Product[]; fetchedAt: Date }[]): CatalogItem[] {
  const byId = new Map<string, CatalogItem>();
  for (const search of searches) {
    for (const product of search.products) {
      if (product.priceCents <= 0 || !Number.isInteger(product.priceCents)) continue;
      const item = catalogItemFromProduct(product, search.query, search.fetchedAt);
      if (!item) continue;
      const existing = byId.get(item.id);
      if (!existing || existing.fetchedAt < item.fetchedAt) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

export const SECONDHAND_SOURCES = ["ebay", "facebook_marketplace", "craigslist", "other"] as const;
const SOURCE_STORE: Record<(typeof SECONDHAND_SOURCES)[number], string> = {
  ebay: "eBay",
  facebook_marketplace: "Facebook Marketplace",
  craigslist: "Craigslist",
  other: "Other seller",
};

/** A listing someone adds by hand, usually secondhand from eBay or Facebook Marketplace. */
export const secondhandItemInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(CATALOG_CATEGORIES),
  priceCents: z.number().int().positive(),
  url: z.url(),
  imageUrl: z.url().optional(),
  source: z.enum(SECONDHAND_SOURCES),
  condition: z.enum(["new", "used"]).default("used"),
  addedBy: z.string().trim().min(1).max(60).optional(),
});
export type SecondhandItemInput = z.input<typeof secondhandItemInputSchema>;

export function catalogItemFromSecondhand(input: SecondhandItemInput, now: Date): CatalogItem {
  const parsed = secondhandItemInputSchema.parse(input);
  const tags = tagTitle(parsed.title);
  return {
    id: `user_${shortHash(parsed.url)}`,
    category: parsed.category,
    title: parsed.title,
    store: SOURCE_STORE[parsed.source],
    priceCents: parsed.priceCents,
    url: parsed.url,
    imageUrl: parsed.imageUrl ?? `https://placehold.co/480x360?text=${encodeURIComponent(parsed.title.slice(0, 40))}`,
    condition: parsed.condition,
    source: parsed.source,
    rating: null,
    reviewCount: null,
    qualityScore: UNRATED_SCORE,
    delivery: null,
    shippingDaysMax: null,
    variantGroup: variantGroup(parsed.category, parsed.title),
    role: roleFor(tags),
    tags,
    scores: scoresFor(parsed.category, parsed.title, null),
    attributes: {},
    searchQuery: null,
    addedBy: parsed.addedBy ?? null,
    fetchedAt: now,
  };
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
