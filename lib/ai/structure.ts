import { isCampingPrompt } from "@/lib/ai/fixture-map";
import type { QuestionnaireItems } from "@/lib/ai/parse";
import { generatedMapSchema, type GeneratedMap } from "@/lib/ai/schemas";
import { loadCampingMap } from "@/lib/fixtures/sample";
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

/**
 * The starter structure that best fits the prompt, used when Gemini can't plan. Camping keeps its trip fixture;
 * everything else is grown from what the prompt mentions (bed, bathroom, storage, desk…) into several branches,
 * topped up with the usual branches for the scene, so a fallback set still reads the brief.
 */
export function starterStructure(prompt: string): GeneratedMap {
  const base = isCampingPrompt(prompt) ? structureFromMap(loadCampingMap()) : branchesFromPrompt(prompt);
  const style = styleWord(prompt);
  return style ? withStyle(base, style) : base;
}

type BranchSlot = [need: string, searchQuery: string, budgetWeight: number, perPerson?: boolean];
interface Branch {
  name: string;
  /** Words in the brief that call for this branch. */
  cue: RegExp;
  slots: BranchSlot[];
}

const BRANCHES: Branch[] = [
  { name: "Sleep", cue: /\b(bed|beds|sleep|mattress|bedding|sheets|pillow|bedroom|dorm|bunk)/i, slots: [["Mattress topper", "twin xl mattress topper", 12, true], ["Sheet set", "twin xl sheet set", 6, true], ["Comforter", "twin xl comforter set", 8, true], ["Pillows", "bed pillows 2 pack", 4, true]] },
  { name: "Seating", cue: /\b(sofa|couch|seating|lounge|sectional|futon|living ?room|hang ?out)/i, slots: [["Sofa", "sofa couch", 35], ["Accent chair", "accent chair", 12], ["Throw pillows", "throw pillow covers set", 3]] },
  { name: "Bath", cue: /\b(bath|bathroom|shower|towel|toilet)/i, slots: [["Towel set", "bath towel set", 5, true], ["Shower caddy", "portable shower caddy", 2, true], ["Bath mat", "bath mat", 2], ["Shower curtain", "shower curtain with liner", 3]] },
  { name: "Storage", cue: /\b(storage|closet|organi[sz]|clothes|hanger|drawers?|shelf|shelves|clutter|space)/i, slots: [["Under-bed storage", "under bed storage bins", 5], ["Hangers", "slim velvet hangers 50 pack", 2], ["Closet organizer", "hanging closet organizer shelves", 4], ["Over-door organizer", "over the door organizer", 3]] },
  { name: "Study", cue: /\b(study|studying|desk|homework|work from home|wfh|office|laptop|school)/i, slots: [["Desk lamp", "led desk lamp", 4, true], ["Desk chair", "ergonomic desk chair", 12, true], ["Desk organizer", "desk organizer", 2, true]] },
  { name: "Kitchen", cue: /\b(kitchen|cook|cooking|dishes|dinner|food|meal|pots|pans)/i, slots: [["Cookware set", "nonstick cookware set", 12], ["Dinnerware", "dinnerware set for 4", 6], ["Microwave", "countertop microwave", 8], ["Utensil set", "kitchen utensil set", 3], ["Food storage", "glass food storage containers", 3]] },
  { name: "Lighting", cue: /\b(light|lighting|lamp|dark|bright)/i, slots: [["Floor lamp", "floor lamp", 6], ["String lights", "led string lights", 2]] },
  { name: "Decor", cue: /\b(decor|cool|aesthetic|wall|art|poster|plant|vibe|cute|mirror)/i, slots: [["Wall art", "framed wall art set", 4], ["LED strip lights", "led strip lights", 2], ["Mirror", "full length mirror", 5], ["Faux plant", "faux potted plant", 2]] },
  { name: "Living room", cue: /\b(rug|coffee table|tv|media)/i, slots: [["Rug", "area rug 5x7", 10], ["Coffee table", "coffee table", 10], ["TV stand", "tv stand", 10]] },
];

/** The usual branches for a scene, used to top up a thin brief. */
const SCENES: Array<[RegExp, string[]]> = [
  [/\bdorm|college|campus|move[- ]?in/i, ["Sleep", "Storage", "Study", "Decor"]],
  [/\bbed ?room/i, ["Sleep", "Storage", "Lighting", "Decor"]],
  [/\boffice|study|work from home|wfh/i, ["Study", "Lighting", "Storage"]],
  [/\bkitchen/i, ["Kitchen", "Storage"]],
  [/\bliving|apartment|house|home|roommates/i, ["Seating", "Living room", "Lighting", "Kitchen"]],
];

/** A multi-branch structure from the words in the brief. Exported for tests. */
export function branchesFromPrompt(prompt: string): GeneratedMap {
  // Only the person's own words choose branches, not the vibe line or answers to fixed questions.
  const brief = prompt.replace(/\b(Vibe|Avoid|Style|Door is|Needed by)\b[^.]*\./gi, " ");
  const people = Math.max(1, Number(brief.match(/\b(\d{1,2})\s*(?:people|roommates|friends|of us|students)/i)?.[1] ?? 1));
  const picked = BRANCHES.filter((branch) => branch.cue.test(brief)).map((branch) => branch.name);
  const scene = SCENES.find(([cue]) => cue.test(brief))?.[1] ?? ["Seating", "Living room", "Lighting"];
  for (const name of scene) if (picked.length < 3 && !picked.includes(name)) picked.push(name);
  const zones = picked.slice(0, 6).map((name, index) => {
    const branch = BRANCHES.find((item) => item.name === name)!;
    return {
      name,
      sortOrder: index,
      slots: branch.slots.map(([need, searchQuery, budgetWeight, perPerson]) => ({
        need,
        quantityRule: perPerson && people > 1 ? ("per_person" as const) : ("per_group" as const),
        // Per-person pay already multiplies by the number of members, so the quantity is one each.
        quantity: 1,
        payType: perPerson && people > 1 ? ("per_person" as const) : ("shared" as const),
        searchQuery,
        budgetWeight,
      })),
    };
  });
  return generatedMapSchema.parse({ zones, links: [], rules: [] });
}

/** Rough share of a set's budget by kind of thing, so a mattress gets more than hangers. */
const WEIGHTS: Array<[RegExp, number]> = [
  [/\b(sofa|couch|sectional|mattress(?! topper)|bed frame|dresser|tent)\b/i, 35],
  [/\b(desk(?! (lamp|organizer|fan))|desk chair|office chair|armchair|accent chair|bookshelf|tv stand|dining table|mini[- ]?fridge|microwave)\b/i, 18],
  [/\b(rug|coffee table|mattress topper|comforter|duvet|sleeping bag|cooler|camp stove|monitor|cookware|vacuum)\b/i, 10],
  [/\b(lamp|sheet|towel|pillow|curtain|mirror|organizer|bins?|hamper|shelf|chair|lantern|knife|dinnerware)\b/i, 5],
];
/** Things each person in a dorm or on a trip gets their own of. */
const OWN_EACH = /\b(sheets?|sheet set|comforter|duvet|pillows?|mattress topper|towels?|shower caddy|desk lamp|desk chair|sleeping (bag|pad)|headlamp|camp chair)\b/i;
/** Sizes a scene implies, put in front of searches where size matters. */
const SIZE_FOR: Array<[RegExp, RegExp, string]> = [
  [/\b(dorm|college|campus)\b/i, /\b(sheets?|sheet set|comforter|duvet|mattress|topper|bed)\b/i, "twin xl"],
  [/./, /\bmini[- ]?fridge\b/i, "3.1 cu ft"],
];

/**
 * The person's ticked list as the plan, when Gemini can't plan: their sections become the branches and their
 * wording the needs, searched with the size the scene implies. Nothing they didn't pick is added.
 */
export function picksStructure(prompt: string, items: QuestionnaireItems): GeneratedMap {
  const brief = prompt.replace(/\b(Vibe|Avoid|Style)\b[^.]*\./gi, " ");
  const people = Math.max(1, Number(brief.match(/\b(\d{1,2})\s*(?:people|roommates|friends|of us|students)/i)?.[1] ?? 1));
  const eachOwn = people > 1 && /\b(dorm|college|campus|camp|camping|trip|hike|hiking)\b/i.test(brief);
  const byGroup = new Map<string, string[]>();
  for (const item of items.mustHaves) {
    const group = items.groups?.[item.toLowerCase()] ?? "Your list";
    byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
  }
  const zones = [...byGroup.entries()].slice(0, 8).map(([name, needs], index) => ({
    name: name.slice(0, 40),
    sortOrder: index,
    slots: needs.slice(0, 15).map((need) => {
      const size = SIZE_FOR.find(([scene, thing]) => scene.test(brief) && thing.test(need) && !/twin|queen|king|full|cu ft/i.test(need))?.[2];
      const own = eachOwn && OWN_EACH.test(need);
      // A bare "pillow" in a sleep branch or bedroom is a bed pillow; the search would otherwise find throw pillows.
      const plain = /^pillows?$/i.test(need.trim()) && (/sleep|bed/i.test(name) || /\b(dorm|bed ?room)\b/i.test(brief)) ? "bed pillows" : need.toLowerCase();
      // Each person's own item costs its price times the headcount, so its share of the budget grows with it.
      const weight = (WEIGHTS.find(([pattern]) => pattern.test(need))?.[1] ?? 4) * (own ? people : 1);
      return {
        need: need.slice(0, 60),
        quantityRule: own ? ("per_person" as const) : ("per_group" as const),
        quantity: 1,
        payType: own ? ("per_person" as const) : ("shared" as const),
        searchQuery: `${size ? `${size} ` : ""}${plain}`.slice(0, 120),
        budgetWeight: Math.min(100, weight),
      };
    }),
  }));
  const base = generatedMapSchema.parse({ zones, links: [], rules: [] });
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
