import { z } from "zod";
import { needKey } from "@/lib/ai/build-map";
import { GEMINI_FAST_MODEL, askGeminiJson, geminiConfigured } from "@/lib/ai/llm";
import { needMatches } from "@/lib/ai/parse";
import { CATEGORIES } from "@/lib/catalog/taxonomy";
import { parseVibeLine, vibeSummary } from "@/lib/catalog/vibes";
import { categorize as storeCategory } from "@/lib/search/catalog";
import { findProducts } from "@/lib/search/find";
import { attachToSlot, generatedSlotId } from "@/lib/search/options";
import { checkRules } from "@/lib/rules/check";
import type { GroupState, MapData, Product, Slot } from "@/lib/types";

/**
 * "Tap a branch to grow more ideas": Gemini proposes things a branch is missing, real products are found for each,
 * and adding one re-finds the product on the server so the saved price is the store's, never the browser's.
 */
const SUGGEST_TIMEOUT_MS = 9_000;
const MAX_IDEAS = 4;

export const suggestRequestSchema = z.object({ groupId: z.string().min(1), zoneId: z.string().min(1) });
export const addRequestSchema = z.object({
  groupId: z.string().min(1),
  zoneId: z.string().min(1),
  need: z.string().min(1).max(60),
  searchQuery: z.string().min(1).max(120),
  productId: z.string().min(1),
});
export type SuggestRequest = z.infer<typeof suggestRequestSchema>;
export type AddRequest = z.infer<typeof addRequestSchema>;
export interface Idea {
  need: string;
  searchQuery: string;
  why: string;
  product: Product;
}
export type SuggestResponse = { ideas: Idea[] };

// Lengths are trimmed in code rather than rejected (Vertex can't be told string limits).
const ideasSchema = z.object({
  ideas: z.array(z.object({ need: z.string().min(1), searchQuery: z.string().min(1), why: z.string() })),
});

const SYSTEM = `You help a group grow one branch of their shopping set. Suggest things that branch is MISSING and would genuinely be used, given the request and vibe.
Never repeat anything already in the set. "need" is a short noun phrase ("Floor lamp"). "searchQuery" is what to type into a store search, using the strongest vibe words ("warm white rattan floor lamp"); never use avoided vibe words. "why" is max 8 words.
Return 3 or 4 ideas, most useful first. JSON only. No prices or stores.`;

export async function suggestForZone(state: GroupState, zoneId: string): Promise<Idea[]> {
  const zone = state.map.zones.find((item) => item.id === zoneId);
  if (!zone) return [];
  const needs = state.map.slots.map((slot) => slot.need);
  const zoneNeeds = state.map.slots.filter((slot) => slot.zoneId === zoneId).map((slot) => slot.need);
  const vibes = parseVibeLine(state.group.prompt);
  const { loves, avoids } = vibeSummary(vibes);

  let proposals: Array<{ need: string; searchQuery: string; why: string }> = [];
  if (geminiConfigured()) {
    try {
      const result = await askGeminiJson({
        prompt: `Request: ${state.group.prompt}\nBranch: ${zone.name} (has: ${zoneNeeds.join(", ") || "nothing yet"})\nWhole set has: ${needs.join(", ")}\nVibe loves: ${loves.join(", ") || "none"}; avoid: ${avoids.join(", ") || "none"}`,
        system: SYSTEM,
        schema: ideasSchema,
        timeoutMs: SUGGEST_TIMEOUT_MS,
        temperature: 0.5,
        model: GEMINI_FAST_MODEL,
      });
      proposals = result.ideas.slice(0, 6).map((idea) => ({ need: idea.need.trim().slice(0, 60), searchQuery: idea.searchQuery.trim().slice(0, 120), why: idea.why.trim().slice(0, 70) }));
    } catch (error) {
      console.warn("Branch ideas fell back to rules");
    }
  }
  if (proposals.length === 0) proposals = fallbackIdeas(zone.name, needs, loves);

  const fresh = proposals.filter((idea, index, list) => !needs.some((need) => needMatches(need, idea.need)) && list.findIndex((other) => needKey(other.need) === needKey(idea.need)) === index).slice(0, MAX_IDEAS + 3);
  const budget = priceContext(state.map, state.group.budgetCents);
  const found = await Promise.all(
    fresh.map(async (idea) => ({ idea, product: pickAffordable(idea.searchQuery, await findProducts(idea.searchQuery, vibes).catch(() => []), budget) })),
  );
  // A few spare ideas are looked up, so ideas the catalog can't fill don't leave the branch short.
  return found
    .filter((entry): entry is { idea: (typeof fresh)[number]; product: Product } => Boolean(entry.product))
    .slice(0, MAX_IDEAS)
    .map(({ idea, product }) => ({ ...idea, product }));
}

const stem = (word: string) => word.replace(/(es|s)$/, "");
/** Words that count things rather than name them: "knife set" is a knife. */
const COUNT_WORDS = new Set(["set", "sets", "pack", "packs", "kit", "kits", "piece", "pc", "pcs", "bundle"]);
/** Words that say what kind of thing it is, so the whole name has to match: a patio curtain isn't a shower curtain. */
const KIND_WORDS = new Set(["shower", "bath", "bathroom", "desk", "floor", "coffee", "side", "kitchen", "office", "sleeping", "camp", "camping", "drying", "ironing", "laundry", "storage", "trash", "bedside", "area", "sheet", "mini"]);

/**
 * Products that name the thing asked for: its last two naming words as a phrase ("bath mat", "shower curtain") when
 * any title has it, otherwise the last one as a whole word, so a "doormat" isn't a "mat". When the first word says
 * what kind of thing it is, only the phrase counts.
 */
function namedProducts(searchQuery: string, products: Product[]) {
  const words = searchQuery.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((word) => word && !COUNT_WORDS.has(word));
  const head = words.at(-1);
  if (!head) return products;
  const kind = words.at(-2);
  const has = (title: string, pattern: string) => new RegExp(`\\b${pattern}`, "i").test(title);
  if (kind) {
    const withPhrase = products.filter((product) => has(product.title, `${stem(kind)}\\w*[\\s-]+${stem(head)}`));
    if (withPhrase.length > 0 || KIND_WORDS.has(kind)) return withPhrase;
  }
  return products.filter((product) => has(product.title, stem(head)));
}

export interface PriceContext {
  /** The most one suggestion may cost. */
  capCents: number;
}

/**
 * What a new idea may cost. With budget left, never more than what's left. With the budget already used (or no
 * budget), the typical price of an item in the set, so an idea doesn't blow the plan out; the group can still
 * trade it for something elsewhere. Pure, exported for tests.
 */
export function priceContext(map: MapData, budgetCents: number): PriceContext {
  const prices = map.slots.flatMap((slot) => {
    if (slot.payType === "already_owned") return [];
    const product = map.products.find((item) => item.id === slot.chosenProductId);
    return product ? [product.priceCents * slot.quantity] : [];
  });
  const spent = prices.reduce((sum, cents) => sum + cents, 0);
  const sorted = [...prices].sort((a, b) => a - b);
  const typical = sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
  const left = budgetCents - spent;
  if (budgetCents > 0 && left > 0) return { capCents: left };
  return { capCents: typical > 0 ? typical : budgetCents > 0 ? budgetCents : Number.POSITIVE_INFINITY };
}

/**
 * The idea's product: one that is actually the thing asked for (same store category as the search), costs no more
 * than the cap, and sits in the middle of what's affordable rather than at the top. Null when nothing fits.
 * Pure, exported for tests.
 */
export function pickAffordable(searchQuery: string, products: Product[], context: PriceContext): Product | null {
  const wanted = storeCategory(searchQuery, "");
  // A title that names another category ("sherpa sofa" for "bath mat") is something else; one naming none may be it.
  const onTopic = wanted === "other" ? products : products.filter((product) => ["other", wanted].includes(storeCategory("", product.title)));
  const named = namedProducts(searchQuery, onTopic);
  const affordable = named.filter((product) => product.priceCents > 0 && product.priceCents <= context.capCents);
  if (affordable.length === 0) return null;
  const prices = affordable.map((product) => product.priceCents).sort((a, b) => a - b);
  const middle = prices[Math.floor((prices.length - 1) / 2)] ?? 0;
  // Ranked best-first by search already: keep that order among items near the middle price.
  const near = affordable.filter((product) => product.priceCents <= middle * 1.25);
  return near[0] ?? affordable[0] ?? null;
}

/**
 * What each kind of room usually needs, for when Gemini is off. Search words are chosen to land in the store
 * catalog's category for that thing ("bath mat" is a bath item; "bathroom trash can" is a trash can).
 */
const ROOM_IDEAS: Array<{ room: RegExp; ideas: Array<[need: string, query: string]> }> = [
  { room: /bath|restroom|washroom|powder/i, ideas: [["Bath towels", "bath towel set"], ["Bath mat", "bath mat"], ["Shower curtain", "shower curtain"], ["Shower caddy", "shower caddy"], ["Bathroom trash can", "small bathroom trash can"], ["Bathroom mirror", "bathroom wall mirror"]] },
  { room: /kitchen|pantry|dining/i, ideas: [["Cookware set", "nonstick cookware set"], ["Dinnerware", "dinnerware set"], ["Coffee maker", "coffee maker"], ["Knife set", "kitchen knife set"], ["Cutting board", "cutting board"], ["Kitchen trash can", "kitchen trash can"], ["Microwave", "microwave"]] },
  { room: /bed ?room|sleep/i, ideas: [["Sheet set", "sheet set"], ["Comforter", "comforter"], ["Nightstand", "nightstand table"], ["Bedside lamp", "bedside table lamp"], ["Hangers", "clothes hangers"], ["Curtains", "blackout curtains"]] },
  { room: /office|study|desk|work/i, ideas: [["Desk lamp", "desk lamp"], ["Desk chair", "office desk chair"], ["Monitor", "computer monitor"], ["Bookshelf", "bookshelf"], ["Waste bin", "office waste basket"], ["Power strip", "surge protector power strip"]] },
  { room: /laundry|utility/i, ideas: [["Laundry hamper", "laundry hamper"], ["Drying rack", "clothes drying rack"], ["Ironing board", "ironing board"], ["Hangers", "clothes hangers"]] },
  { room: /dorm/i, ideas: [["Mini fridge", "mini fridge"], ["Desk lamp", "desk lamp"], ["Storage cubes", "storage cube organizer"], ["Sheet set", "twin xl sheet set"], ["Laundry hamper", "laundry hamper"], ["Hangers", "clothes hangers"]] },
  { room: /camp|outdoor|patio|trail|hike/i, ideas: [["Tent", "camping tent"], ["Sleeping bag", "sleeping bag"], ["Camp table", "camp table"], ["Cooler", "cooler"], ["Headlamp", "headlamp"], ["Lantern", "camping lantern"]] },
  { room: /entry|hall|mud/i, ideas: [["Shoe rack", "shoe rack shelf"], ["Entry rug", "entryway rug"], ["Wall mirror", "wall mirror"], ["Storage bench", "entryway storage bench seating"]] },
];

/**
 * Without Gemini: what this kind of room usually needs and the set doesn't have yet. Living rooms (and rooms we
 * don't recognize) use the catalog's living-room categories. Exported for tests.
 */
export function fallbackIdeas(zoneName: string, needs: string[], loves: string[]) {
  const style = loves.find((label) => !["Budget-smart", "Premium", "Durable", "Compact"].includes(label))?.toLowerCase() ?? "";
  const missing = (need: string) => !needs.some((existing) => needMatches(existing, need));
  const known = ROOM_IDEAS.find((entry) => entry.room.test(zoneName));
  if (known) {
    return known.ideas
      .filter(([need]) => missing(need))
      .map(([need, query]) => ({ need, searchQuery: query, why: `Most ${zoneName.toLowerCase()}s use one` }));
  }
  const room = CATEGORIES.find((category) => category.room.toLowerCase() === zoneName.toLowerCase())?.room ?? "Living room";
  return CATEGORIES.filter((category) => category.room === room && missing(category.label))
    .slice(0, MAX_IDEAS)
    .map((category) => ({ need: category.label, searchQuery: `${style} ${category.label.toLowerCase()}`.trim(), why: "Rounds out this branch" }));
}

/** Adds one idea to a branch. The product is looked up again from the same search, by id. */
export async function addToZone(state: GroupState, input: AddRequest): Promise<MapData | null> {
  const zone = state.map.zones.find((item) => item.id === input.zoneId);
  if (!zone) return null;
  const vibes = parseVibeLine(state.group.prompt);
  const product = (await findProducts(input.searchQuery, vibes)).find((item) => item.id === input.productId);
  if (!product) return null;
  const slotId = generatedSlotId(input.searchQuery, Date.now().toString(36));
  const [attached] = attachToSlot([{ ...product, attributes: { ...product.attributes, searchQuery: input.searchQuery } }], slotId);
  const slot: Slot = {
    id: slotId, zoneId: zone.id, need: input.need, quantityRule: "per_group", quantity: 1, budgetCents: product.priceCents, payType: "shared",
    ownerMemberId: null, chosenProductId: attached.id, updatedBy: null, updatedAt: new Date().toISOString(),
  };
  const map: MapData = { ...state.map, slots: [...state.map.slots, slot], products: [...state.map.products, attached] };
  if (state.members.length > 0) map.rules = checkRules(map, state.members);
  return map;
}
