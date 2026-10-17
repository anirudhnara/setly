import { needMatches } from "@/lib/ai/parse";
import { planTotalCents } from "@/lib/rules/check";
import { searchProducts } from "@/lib/search/serpapi";
import type { MapData, Product } from "@/lib/types";

/**
 * Side Kick suggestions (PRD 4.2): missing required slots, things that go with the map, and things under the
 * remaining budget. Products come from search; the model isn't involved. Each suggestion becomes a new slot when
 * dragged onto the map.
 *
 * TODO(Backend 2 (Maps)): expose through app/api/maps once Backend 1 adds the request and response types.
 */
export interface Suggestion {
  need: string;
  reason: string;
  /** Slot-free search result: `slotId` is "" until the suggestion is placed. */
  product: Product;
}

export interface SuggestOptions {
  budgetCents: number | null;
  memberCount: number;
  limit?: number;
  search?: (query: string) => Promise<Product[]>;
}

/** Common companions for a need. Keys and values are needs; matching is loose ("lamp" matches "Floor lamp"). */
const COMPANIONS: Record<string, string[]> = {
  Sofa: ["Rug", "Coffee table", "Throw pillows", "Floor lamp", "Side table", "Throw blanket"],
  "Coffee table": ["Rug"],
  "TV stand": ["Sofa"],
  Desk: ["Desk chair", "Floor lamp", "Bookshelf"],
  "Bed frame": ["Mattress", "Side table", "Curtains"],
  Mattress: ["Bed frame"],
  "Dining table": ["Dining chairs"],
  Microwave: ["Trash bin", "Cookware set"],
  "Coffee maker": ["Mugs"],
  Bookshelf: ["Planter"],
  Tent: ["Sleeping pad", "Sleeping bag", "Lantern"],
  "Camp stove": ["Fuel canister", "Cooler"],
  "Sleeping bag": ["Sleeping pad", "Headlamp"],
};

const ALWAYS_USEFUL = ["Bookshelf", "Trash bin", "Planter", "Curtains"];

export async function suggestSlots(map: MapData, options: SuggestOptions): Promise<Suggestion[]> {
  const search = options.search ?? searchProducts;
  const limit = options.limit ?? 6;
  const onMap = (need: string) => map.slots.some((slot) => needMatches(slot.need, need));
  const remaining = options.budgetCents === null ? null : options.budgetCents - planTotalCents(map, options.memberCount);

  const candidates: { need: string; reason: string }[] = [];
  const add = (need: string, reason: string) => {
    if (!onMap(need) && !candidates.some((candidate) => needMatches(candidate.need, need))) candidates.push({ need, reason });
  };
  for (const rule of map.rules) {
    if (rule.type !== "required_or_banned" || !Array.isArray(rule.params.requiredNeeds)) continue;
    for (const need of rule.params.requiredNeeds) if (typeof need === "string") add(need, "Your plan requires it");
  }
  for (const slot of map.slots) {
    const companions = Object.entries(COMPANIONS).find(([need]) => needMatches(slot.need, need))?.[1] ?? [];
    for (const need of companions) add(need, `Goes with the ${slot.need.toLowerCase()}`);
  }
  for (const need of ALWAYS_USEFUL) add(need, "Often added to plans like this");

  const results = await Promise.allSettled(candidates.slice(0, limit * 2).map((candidate) => search(candidate.need)));
  const suggestions: Suggestion[] = [];
  results.forEach((result, index) => {
    if (suggestions.length >= limit || result.status !== "fulfilled" || result.value.length === 0) return;
    const candidate = candidates[index];
    const affordable = remaining === null ? result.value : result.value.filter((product) => product.priceCents <= remaining);
    const required = candidate.reason === "Your plan requires it";
    if (affordable.length === 0 && !required) return;
    const product = (affordable.length > 0 ? affordable : result.value).reduce((best, item) => (item.priceCents < best.priceCents ? item : best));
    const reason = remaining !== null && affordable.length > 0 && !required ? `${candidate.reason}, fits the budget left` : candidate.reason;
    suggestions.push({ need: candidate.need, reason, product: { ...product, slotId: "" } });
  });
  return suggestions;
}
