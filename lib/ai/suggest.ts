import { z } from "zod";
import { needKey } from "@/lib/ai/build-map";
import { GEMINI_FAST_MODEL, askGeminiJson, geminiConfigured } from "@/lib/ai/llm";
import { needMatches } from "@/lib/ai/parse";
import { CATEGORIES } from "@/lib/catalog/taxonomy";
import { parseVibeLine, vibeSummary } from "@/lib/catalog/vibes";
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

  const fresh = proposals.filter((idea, index, list) => !needs.some((need) => needMatches(need, idea.need)) && list.findIndex((other) => needKey(other.need) === needKey(idea.need)) === index).slice(0, MAX_IDEAS);
  const found = await Promise.all(fresh.map(async (idea) => ({ idea, product: (await findProducts(idea.searchQuery, vibes).catch(() => []))[0] })));
  return found.filter((entry): entry is { idea: (typeof fresh)[number]; product: Product } => Boolean(entry.product)).map(({ idea, product }) => ({ ...idea, product }));
}

/** Without Gemini: catalog categories not in the set yet, from the branch's room first. Exported for tests. */
export function fallbackIdeas(zoneName: string, needs: string[], loves: string[]) {
  const style = loves.find((label) => !["Budget-smart", "Premium", "Durable", "Compact"].includes(label))?.toLowerCase() ?? "";
  const room = CATEGORIES.find((category) => category.room.toLowerCase() === zoneName.toLowerCase())?.room;
  return CATEGORIES.filter((category) => !needs.some((need) => needMatches(need, category.label)))
    .sort((a, b) => Number(b.room === room) - Number(a.room === room))
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
