import starterStructuresJson from "@/fixtures/starter-structures.json";
import { isCampingPrompt } from "@/lib/ai/fixture-map";
import { generatedMapSchema, type GeneratedMap } from "@/lib/ai/schemas";
import { loadApartmentMap, loadCampingMap } from "@/lib/fixtures/sample";
import type { MapData } from "@/lib/types";

/**
 * Map structure without the model. Used when Gemini is unavailable but search is live, so the set still fills
 * with real store results, and by refine, which edits the current map's structure and searches again.
 */

export const STYLE_WORDS = ["cozy", "minimal", "minimalist", "modern", "mid-century", "scandinavian", "boho", "industrial", "rustic", "warm", "calm", "bright", "outdoorsy", "rugged", "premium", "neutral", "colorful", "vintage", "japandi", "coastal", "farmhouse"];
const STYLED_NEEDS = /sofa|couch|loveseat|chair|stool|rug|lamp|table|pillow|cushion|curtain|blanket|throw|bed|duvet|comforter|desk|shelf|bookcase|planter|mirror|art|print|dresser|cabinet|ottoman|bench|console|stand|vase|frame|mug|dinnerware/i;

/** The first style word in the text, if any. "Style: cozy." and "a cozy living room" both give "cozy". */
export function styleWord(text: string): string | null {
  const lower = text.toLowerCase();
  return STYLE_WORDS.find((word) => new RegExp(`\\b${word}\\b`).test(lower)) ?? null;
}

/** Puts the style in front of searches for things where style shows (furniture and decor, not microwaves). */
export function withStyle(generated: GeneratedMap, style: string): GeneratedMap {
  const clean = style.toLowerCase().trim();
  return {
    ...generated,
    zones: generated.zones.map((zone) => ({
      ...zone,
      slots: zone.slots.map((slot) => {
        if (!STYLED_NEEDS.test(slot.need) || slot.payType === "already_owned") return slot;
        const bare = slot.searchQuery.replace(new RegExp(`\\b(${STYLE_WORDS.join("|")})\\b\\s*`, "gi"), "").trim();
        return { ...slot, searchQuery: `${clean} ${bare}`.slice(0, 120) };
      }),
    })),
  };
}

/** The starter structure that best fits the prompt: camping, bedroom, home office, or an apartment. */
export function starterStructure(prompt: string): GeneratedMap {
  let base: GeneratedMap;
  if (isCampingPrompt(prompt)) base = structureFromMap(loadCampingMap());
  else if (/bed ?room|dorm/i.test(prompt)) base = generatedMapSchema.parse(starterStructuresJson.bedroom);
  else if (/office|study|desk|work from home|wfh/i.test(prompt)) base = generatedMapSchema.parse(starterStructuresJson.office);
  else if (/kitchen/i.test(prompt) && !/living/i.test(prompt)) base = onlyZones(structureFromMap(loadApartmentMap()), /kitchen/i);
  else base = structureFromMap(loadApartmentMap());
  const style = styleWord(prompt);
  return style ? withStyle(base, style) : base;
}

/**
 * MapData → model-shaped structure. The search query rides on the chosen product (`attributes.searchQuery`)
 * when the map came from search; otherwise the need is the query. Budget weights follow the slot budgets.
 */
export function structureFromMap(map: MapData): GeneratedMap {
  const zones = [...map.zones].sort((a, b) => a.sortOrder - b.sortOrder);
  const maxBudget = Math.max(1, ...map.slots.map((slot) => slot.budgetCents));
  const needById = new Map(map.slots.map((slot) => [slot.id, slot.need]));
  const generatedZones = zones
    .map((zone, index) => ({
      name: zone.name.slice(0, 40),
      sortOrder: index,
      slots: map.slots
        .filter((slot) => slot.zoneId === zone.id)
        .slice(0, 15)
        .map((slot) => {
          const product = map.products.find((item) => item.id === slot.chosenProductId) ?? map.products.find((item) => item.slotId === slot.id);
          const saved = product?.attributes.searchQuery;
          const searchQuery = typeof saved === "string" && saved ? saved : slot.need.toLowerCase();
          return {
            need: slot.need.slice(0, 60),
            quantityRule: slot.quantityRule,
            quantity: Math.min(Math.max(1, slot.quantity), 50),
            payType: slot.payType,
            searchQuery: searchQuery.slice(0, 120),
            budgetWeight: Math.min(100, Math.max(1, Math.round((slot.budgetCents / maxBudget) * 40) || 10)),
          };
        }),
    }))
    .filter((zone) => zone.slots.length > 0)
    .slice(0, 8);
  const links = map.links
    .map((link) => ({ fromNeed: needById.get(link.fromSlotId) ?? "", toNeed: needById.get(link.toSlotId) ?? "", label: link.label.slice(0, 80) }))
    .filter((link) => link.fromNeed && link.toNeed);
  return { zones: generatedZones.length ? generatedZones : [{ name: "Plan", sortOrder: 0, slots: [] }], links, rules: [] };
}

function onlyZones(generated: GeneratedMap, pattern: RegExp): GeneratedMap {
  const zones = generated.zones.filter((zone) => pattern.test(zone.name));
  return zones.length ? { ...generated, zones: zones.map((zone, index) => ({ ...zone, sortOrder: index })) } : generated;
}
