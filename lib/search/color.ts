/**
 * Color theory for sets, on generalized color families (never RGB).
 * Gemini only labels an item's family, temperature, value, and saturation; code decides what goes together.
 */

export const COLOR_FAMILIES = [
  "white", "cream", "beige", "tan", "brown", "wood", "gray", "black", "clear",
  "red", "orange", "yellow", "green", "teal", "blue", "navy", "purple", "pink",
  "gold", "silver", "multicolor",
] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

/** Families that sit with anything: whites, earth neutrals, grays, black, and clear. */
const NEUTRALS = new Set<ColorFamily>(["white", "cream", "beige", "tan", "brown", "wood", "gray", "black", "clear"]);
/** Metals act as neutral accents, but gold and silver fight each other. */
const METALLICS = new Set<ColorFamily>(["gold", "silver"]);

/**
 * Position on the painter's (RYB) color wheel in degrees, the one interior and fashion color theory uses:
 * red/green, yellow/purple, and blue/orange are opposites. Navy is a dark blue; pink is a light red.
 */
const HUE: Partial<Record<ColorFamily, number>> = {
  red: 0, orange: 60, yellow: 120, green: 180, teal: 210, blue: 240, navy: 245, purple: 300, pink: 345,
};

export type Temperature = "warm" | "cool" | "neutral";
export type Value = "light" | "medium" | "dark";
export type Saturation = "muted" | "pastel" | "vivid";
export type Palette = "neutrals" | "earth_tones" | "pastels" | "jewel_tones" | "brights" | "muted_colors" | "metallics" | "multicolor";

export interface ColorProfile {
  family: ColorFamily;
  accent: ColorFamily | "none";
  temperature: Temperature;
  value: Value;
  saturation: Saturation;
  /** "stated" when the title names the color, "inferred" when it's the usual color for that product. */
  confidence: "stated" | "inferred";
  palette: Palette;
}

export function isNeutral(family: ColorFamily) {
  return NEUTRALS.has(family);
}

/** Broad palette the item belongs to, derived from its family, saturation, and value. */
export function paletteFor(family: ColorFamily, saturation: Saturation, value: Value): Palette {
  if (family === "multicolor") return "multicolor";
  if (METALLICS.has(family)) return "metallics";
  if (family === "brown" || family === "tan" || family === "wood") return "earth_tones";
  if (NEUTRALS.has(family)) return "neutrals";
  if (saturation === "pastel") return "pastels";
  if (saturation === "muted") return family === "green" || family === "orange" || family === "yellow" ? "earth_tones" : "muted_colors";
  return value === "dark" ? "jewel_tones" : "brights";
}

export type Harmony = "neutral" | "monochrome" | "analogous" | "complementary" | "triadic" | "busy" | "clash";

/**
 * How two colors relate on the wheel. Neutrals pair with anything; same family is monochrome;
 * neighbors (within 60°, one step either way on a 6-hue wheel) are analogous; opposites (150° to 210°) are complementary; 120° ± 15° is triadic.
 */
export function harmony(a: ColorFamily, b: ColorFamily): Harmony {
  if (NEUTRALS.has(a) || NEUTRALS.has(b)) return "neutral";
  if (a === b) return "monochrome";
  if (METALLICS.has(a) && METALLICS.has(b)) return "clash";
  if (METALLICS.has(a) || METALLICS.has(b)) return "neutral";
  if (a === "multicolor" || b === "multicolor") return "busy";
  const hueA = HUE[a];
  const hueB = HUE[b];
  if (hueA === undefined || hueB === undefined) return "clash";
  const raw = Math.abs(hueA - hueB) % 360;
  const distance = Math.min(raw, 360 - raw);
  if (distance <= 60) return "analogous";
  if (distance >= 150) return "complementary";
  if (distance >= 105 && distance <= 135) return "triadic";
  return "clash";
}

export function colorsWork(a: ColorFamily, b: ColorFamily) {
  const relation = harmony(a, b);
  return relation !== "clash" && relation !== "busy";
}

/**
 * Share of color pairs in a set that work together, 0 to 1. A set with one or no colors scores 1.
 * Only each item's main family counts; accents are details.
 */
export function paletteScore(families: ColorFamily[]): number {
  let pairs = 0;
  let good = 0;
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      pairs += 1;
      if (colorsWork(families[i], families[j])) good += 1;
    }
  }
  return pairs === 0 ? 1 : Math.round((good / pairs) * 1000) / 1000;
}
