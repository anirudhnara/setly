import { z } from "zod";
import { askGeminiJson } from "@/lib/ai/llm";
import { COLOR_FAMILIES, paletteFor, type ColorProfile } from "@/lib/search/color";

/**
 * Gemini labels catalog items with a generalized color and a few styles, from the title only.
 * It never sees or produces prices, and entries for indexes it wasn't given are dropped.
 */

export const STYLES = [
  "cozy", "minimalist", "modern", "mid_century", "industrial", "rustic", "boho", "scandinavian", "japandi", "retro",
  "quirky", "gaming", "glam", "coastal", "cottagecore", "preppy", "outdoorsy", "playful", "techy", "classic",
] as const;
export type Style = (typeof STYLES)[number];

/** Styles that pair with almost anything, so they don't make an item a set anchor. */
const NEUTRAL_STYLES = new Set<Style>(["minimalist", "modern", "scandinavian", "japandi", "classic", "techy", "outdoorsy"]);

const itemTagSchema = z.object({
  i: z.number().int(),
  family: z.enum(COLOR_FAMILIES),
  accent: z.enum([...COLOR_FAMILIES, "none"]),
  temperature: z.enum(["warm", "cool", "neutral"]),
  value: z.enum(["light", "medium", "dark"]),
  saturation: z.enum(["muted", "pastel", "vivid"]),
  confidence: z.enum(["stated", "inferred"]),
  styles: z.array(z.enum(STYLES)).max(3),
});
const batchSchema = z.object({ items: z.array(itemTagSchema) });

const SYSTEM = `You label products in a home and lifestyle shopping catalog with color and style.
Use color families, never hex or RGB: ${COLOR_FAMILIES.join(", ")}.
- "family" is the main visible color. "accent" is a clear second color, or "none".
- If the title names a color, use it and set confidence "stated". Otherwise give the usual color for that product and set "inferred" (for example a stainless microwave is silver, a laptop is usually silver or gray, unfinished wood is wood).
- Map shades to families: ivory or off-white is cream, sage or olive is green, rust or terracotta is orange, blush is pink, charcoal is gray, espresso is brown, brass is gold, chrome or stainless is silver.
- temperature: warm (reds, oranges, yellows, warm browns, gold), cool (blues, greens, purples, silver), or neutral.
- value: light, medium, or dark. saturation: muted (dusty, earthy, greyed), pastel (soft and light), or vivid (strong, saturated).
- styles: up to 3 from: ${STYLES.join(", ")}. Use an empty list if nothing fits.
Return exactly one entry per input item, using its "i".`;

export interface TagInput {
  title: string;
  category: string;
}

export interface ItemTags {
  color: ColorProfile;
  styles: Style[];
}

/** Tags a batch. Results line up with the input; an item Gemini skipped is null. */
export async function tagCatalogBatch(items: TagInput[]): Promise<(ItemTags | null)[]> {
  const prompt = JSON.stringify(items.map((item, i) => ({ i, title: item.title, category: item.category })));
  const result = await askGeminiJson({ prompt, system: SYSTEM, schema: batchSchema, timeoutMs: 120_000, temperature: 0.1 });
  return alignTags(result.items, items.length);
}

/** Exported for tests. Drops out-of-range indexes and keeps the first entry for each index. */
export function alignTags(entries: z.infer<typeof itemTagSchema>[], count: number): (ItemTags | null)[] {
  const aligned: (ItemTags | null)[] = Array.from({ length: count }, () => null);
  for (const entry of entries) {
    if (entry.i < 0 || entry.i >= count || aligned[entry.i]) continue;
    aligned[entry.i] = {
      color: {
        family: entry.family,
        accent: entry.accent === entry.family ? "none" : entry.accent,
        temperature: entry.temperature,
        value: entry.value,
        saturation: entry.saturation,
        confidence: entry.confidence,
        palette: paletteFor(entry.family, entry.saturation, entry.value),
      },
      styles: [...new Set(entry.styles)],
    };
  }
  return aligned;
}

/** Anchors set a set's look: a bold style, or a vivid or jewel-toned main color. */
export function roleFromTags(tags: ItemTags): "anchor" | "neutral" {
  const boldStyle = tags.styles.some((style) => !NEUTRAL_STYLES.has(style));
  const boldColor = tags.color.palette === "brights" || tags.color.palette === "jewel_tones" || tags.color.palette === "multicolor";
  return boldStyle || boldColor ? "anchor" : "neutral";
}
