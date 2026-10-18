/**
 * The vibe vocabulary for step 2 (the 3D vibe space). Gemini chooses which vibes to show for a brief, but only from
 * this list, because code has to be able to measure how well a real product fits each one. Pure: shared by the
 * browser and the server.
 */
export type VibeGroup = "Style" | "Color" | "Material" | "Priority";

export interface Vibe {
  label: string;
  group: VibeGroup;
  color: string;
  /** What it means, in a few words, for the tooltip. */
  hint: string;
  /** Title words that suggest a product has this vibe. Price-based priorities have no matcher. */
  match: RegExp | null;
}

export const VIBES: Vibe[] = [
  { label: "Minimal", group: "Style", color: "#8fd3ff", hint: "Clean lines, nothing extra", match: /minimal|simple|sleek|clean|low[- ]profile|streamlined/i },
  { label: "Cozy", group: "Style", color: "#ff9f7a", hint: "Soft, warm, sink-in comfy", match: /cozy|plush|soft|sherpa|fleece|chunky|comfy|knit|cushioned/i },
  { label: "Modern", group: "Style", color: "#9db4ff", hint: "Fresh, current shapes", match: /modern|contemporary|geometric|curved/i },
  { label: "Vintage", group: "Style", color: "#e8b07a", hint: "Retro and mid-century charm", match: /vintage|retro|mid[- ]century|antique|classic|tufted/i },
  { label: "Boho", group: "Style", color: "#f6a6c8", hint: "Layered, woven, relaxed", match: /boho|bohemian|macrame|fringe|tassel|moroccan|kilim/i },
  { label: "Scandinavian", group: "Style", color: "#cfe8ff", hint: "Light woods, airy calm", match: /scandi|scandinavian|nordic|danish|hygge/i },
  { label: "Industrial", group: "Style", color: "#b8b8c8", hint: "Metal, raw, loft-y", match: /industrial|iron|steel|pipe|loft|rustic metal/i },
  { label: "Warm neutrals", group: "Color", color: "#f3d9b1", hint: "Cream, oat, beige, tan", match: /beige|cream|ivory|oat|tan|sand|natural|camel|taupe|khaki/i },
  { label: "Cool tones", group: "Color", color: "#7fb7e8", hint: "Blues, greys, sage", match: /blue|navy|gr[ae]y|sage|slate|teal|silver/i },
  { label: "Earthy", group: "Color", color: "#c98a5a", hint: "Terracotta, olive, rust", match: /terracotta|olive|rust|brown|clay|green|forest|ochre|mustard/i },
  { label: "Bold color", group: "Color", color: "#ff6b8b", hint: "Bright, playful pops", match: /red|pink|yellow|orange|purple|colorful|multicolor|vibrant|bright/i },
  { label: "Black & white", group: "Color", color: "#e9e9ef", hint: "Crisp contrast", match: /black|white|monochrome/i },
  { label: "Wood", group: "Material", color: "#d9a066", hint: "Oak, walnut, natural grain", match: /wood|oak|walnut|acacia|pine|teak|bamboo|mango/i },
  { label: "Metal", group: "Material", color: "#c7d0dc", hint: "Brass, steel, chrome", match: /metal|brass|gold|steel|chrome|iron|aluminum/i },
  { label: "Rattan & woven", group: "Material", color: "#e2c48f", hint: "Cane, jute, wicker", match: /rattan|wicker|cane|jute|woven|seagrass|rope/i },
  { label: "Velvet & plush", group: "Material", color: "#c39bff", hint: "Rich, touchable fabrics", match: /velvet|boucl|chenille|plush|faux fur|sherpa/i },
  { label: "Linen & cotton", group: "Material", color: "#f1ead8", hint: "Breathable, washable", match: /linen|cotton|canvas|washable/i },
  { label: "Budget-smart", group: "Priority", color: "#7ee0a8", hint: "Stretch every dollar", match: null },
  { label: "Premium", group: "Priority", color: "#ffd166", hint: "Fewer, nicer things", match: null },
  { label: "Durable", group: "Priority", color: "#9ff0c2", hint: "Built to last, easy care", match: /durable|heavy[- ]duty|solid|sturdy|stain[- ]resistant|performance|commercial/i },
  { label: "Compact", group: "Priority", color: "#ffe08a", hint: "Small-space friendly", match: /compact|small|mini|narrow|apartment|space[- ]saving|folding|stackable/i },
];

export const VIBE_LABELS = VIBES.map((vibe) => vibe.label);
export type VibeWeights = Record<string, number>;

const byLower = new Map(VIBES.map((vibe) => [vibe.label.toLowerCase(), vibe]));

/** Tolerates "Cozy (Style)" and "black and white" from the model. */
export function vibeFor(label: string) {
  const clean = label.replace(/\s*\([^)]*\)\s*$/, "").replace(/\band\b/gi, "&").replace(/\s+/g, " ").trim().toLowerCase();
  return byLower.get(clean) ?? null;
}

/** Vibes worth mentioning: close ones as preferences, pushed-away ones to avoid. Sorted strongest first. */
export function vibeSummary(weights: VibeWeights) {
  const entries = Object.entries(weights).filter(([label]) => vibeFor(label));
  return {
    loves: entries.filter(([, weight]) => weight >= 0.6).sort((a, b) => b[1] - a[1]).map(([label]) => label),
    avoids: entries.filter(([, weight]) => weight <= 0.2).sort((a, b) => a[1] - b[1]).map(([label]) => label),
  };
}

/**
 * The line saved into the set's prompt, so planning, ranking, alternatives, and refine all see the vibe later:
 * "Vibe: Minimal 90%, Wood 80%. Avoid: Bold color."
 */
export function vibeLine(weights: VibeWeights) {
  const parts = Object.entries(weights)
    .filter(([label]) => vibeFor(label))
    .sort((a, b) => b[1] - a[1])
    .filter(([, weight]) => weight >= 0.45)
    .map(([label, weight]) => `${label} ${Math.round(weight * 100)}%`);
  const { avoids } = vibeSummary(weights);
  return [parts.length ? `Vibe: ${parts.join(", ")}.` : "", avoids.length ? `Avoid: ${avoids.join(", ")}.` : ""].filter(Boolean).join(" ");
}

/** Reads weights back out of a prompt written with `vibeLine`. Unknown labels are ignored. */
export function parseVibeLine(prompt: string): VibeWeights {
  const weights: VibeWeights = {};
  const loves = prompt.match(/Vibe:\s*([^.]+)\./i)?.[1] ?? "";
  for (const part of loves.split(",")) {
    const match = part.trim().match(/^(.+?)\s+(\d{1,3})%$/);
    const vibe = match ? vibeFor(match[1]) : null;
    if (vibe && match) weights[vibe.label] = Math.min(1, Number(match[2]) / 100);
  }
  const avoids = prompt.match(/Avoid:\s*([^.]+)\./i)?.[1] ?? "";
  for (const part of avoids.split(",")) {
    const vibe = vibeFor(part);
    if (vibe) weights[vibe.label] = 0;
  }
  return weights;
}

/**
 * How well a product fits the vibe, roughly -1..1. Matching words for vibes pulled close add, matching words for
 * vibes pushed away subtract. Budget-smart and Premium use where the price sits among the options instead.
 */
export function vibeScore(text: string, weights: VibeWeights, priceRank = 0.5) {
  let score = 0;
  let total = 0;
  for (const [label, weight] of Object.entries(weights)) {
    const vibe = vibeFor(label);
    if (!vibe) continue;
    const pull = weight - 0.4;
    total += Math.abs(pull);
    if (vibe.label === "Budget-smart") score += pull * (1 - priceRank) * 1.5;
    else if (vibe.label === "Premium") score += pull * priceRank * 1.5;
    else if (vibe.match?.test(text)) score += pull;
  }
  return total === 0 ? 0 : score / Math.max(1, total * 0.6);
}

/** Stable re-order by vibe fit; search relevance breaks ties. */
export function sortByVibe<T extends { title: string; priceCents: number }>(items: T[], weights: VibeWeights, extra: (item: T) => string = () => "") {
  if (Object.keys(weights).length === 0 || items.length < 2) return items;
  const prices = [...items].map((item) => item.priceCents).sort((a, b) => a - b);
  const rankOf = (cents: number) => (prices.length > 1 ? prices.indexOf(cents) / (prices.length - 1) : 0.5);
  return items
    .map((item, index) => ({ item, index, score: vibeScore(`${item.title} ${extra(item)}`, weights, rankOf(item.priceCents)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
