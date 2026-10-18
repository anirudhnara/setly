import type { ColorFamily } from "@/lib/search/color";
import type { Product } from "@/lib/types";

/**
 * A product's color family, for swatches and shuffling colors. The Tiger catalog's tagged color comes first
 * (`attributes.color`), then color words in the title. Null when neither says. Pure: shared by browser and server.
 */
const TITLE_COLORS: Array<[ColorFamily, RegExp]> = [
  ["multicolor", /\b(rainbow|multicolou?r|multi-colou?r)\b/i],
  ["navy", /\bnavy\b/i],
  ["teal", /\b(teal|turquoise|aqua)\b/i],
  ["blue", /\b(blue|denim|cobalt)\b/i],
  ["green", /\b(green|sage|olive|emerald|forest)\b/i],
  ["pink", /\b(pink|blush|rose)\b/i],
  ["red", /\b(red|burgundy|crimson)\b/i],
  ["orange", /\b(orange|rust|terracotta)\b/i],
  ["yellow", /\b(yellow|mustard)\b/i],
  ["purple", /\b(purple|lavender|lilac|plum)\b/i],
  ["gold", /\b(gold|brass)\b/i],
  ["silver", /\b(silver|chrome|nickel)\b/i],
  ["cream", /\b(cream|ivory|off[- ]white|oat|boucle)\b/i],
  ["white", /\bwhite\b/i],
  ["beige", /\b(beige|linen|natural)\b/i],
  ["tan", /\b(tan|camel|khaki|jute)\b/i],
  ["wood", /\b(oak|walnut|wood(en)?|bamboo|pine|teak|acacia)\b/i],
  ["brown", /\b(brown|espresso|chocolate|cognac)\b/i],
  ["gray", /\b(gr[ae]y|charcoal|slate)\b/i],
  ["black", /\b(black|ebony)\b/i],
  ["clear", /\b(clear|glass|acrylic)\b/i],
];

/** A representative shade per family, only for drawing a swatch. */
export const SWATCH: Record<ColorFamily, string> = {
  white: "#f7f6f2", cream: "#eee4cf", beige: "#d9c7a6", tan: "#c2a074", brown: "#7a5236", wood: "#a9784a",
  gray: "#9a9a98", black: "#232323", clear: "#dfeff2", red: "#c23b33", orange: "#e07b39", yellow: "#e9c13f",
  green: "#6e8f5a", teal: "#2f8f8a", blue: "#3f6fb5", navy: "#1f2f55", purple: "#7d5aa6", pink: "#e6a1ad",
  gold: "#c9a24a", silver: "#c4c7cc", multicolor: "conic-gradient(#c23b33, #e9c13f, #6e8f5a, #3f6fb5, #7d5aa6, #c23b33)",
};

const FAMILIES = new Set(Object.keys(SWATCH));

export function productColor(product: Pick<Product, "title" | "attributes">): ColorFamily | null {
  const tagged = product.attributes.color;
  if (typeof tagged === "string" && FAMILIES.has(tagged)) return tagged as ColorFamily;
  for (const [family, pattern] of TITLE_COLORS) if (pattern.test(product.title)) return family;
  return null;
}

/** The colors a slot can come in, the current one first, each with its closest-priced option. */
export function colorChoices(current: Product | null, options: Product[]): Array<{ color: ColorFamily; product: Product }> {
  const price = current?.priceCents ?? 0;
  const byColor = new Map<ColorFamily, Product>();
  for (const product of current ? [current, ...options] : options) {
    const color = productColor(product);
    if (!color) continue;
    const best = byColor.get(color);
    if (!best || (product.id !== best.id && best.id !== current?.id && Math.abs(product.priceCents - price) < Math.abs(best.priceCents - price))) byColor.set(color, product);
  }
  return [...byColor.entries()].map(([color, product]) => ({ color, product }));
}

/**
 * A different color of the same thing at a similar price: within 25% (or $15) of the current price, closest first,
 * with `random` choosing among the colors that qualify. Null when nothing qualifies or the current color is unknown.
 */
export function recolorPick(current: Product, options: Product[], random: () => number = Math.random): Product | null {
  const now = productColor(current);
  // Without a known color now, any "new color" would just be a different product.
  if (!now) return null;
  const band = Math.max(current.priceCents * 0.25, 1_500);
  const choices = colorChoices(current, options).filter(({ color, product }) => color !== now && product.id !== current.id && Math.abs(product.priceCents - current.priceCents) <= band);
  if (choices.length === 0) return null;
  return choices[Math.floor(random() * choices.length) % choices.length]?.product ?? null;
}
