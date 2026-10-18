import { customAlphabet } from "nanoid";
import type { GeneratedMap, GeneratedSlot } from "@/lib/ai/schemas";
import { needMatches } from "@/lib/ai/parse";
import { chargedCentsForSlot, checkRules } from "@/lib/rules/check";
import { attachToSlot, generatedSlotId, registerMapSlots } from "@/lib/search/options";
import type { Link, MapData, Product, Rule, Slot, Zone } from "@/lib/types";

/**
 * Turns model structure plus search results into a MapData.
 * Prices, stores, and URLs come only from `search`. Rules reference slots by need; unknown needs are dropped.
 * The returned map holds only the chosen product for each slot; alternatives come from the options route.
 */
export interface BuildMapInput {
  generated: GeneratedMap;
  budgetCents: number | null;
  memberCount: number;
  groupId: string;
  doorWidthIn?: number | null;
  search: (query: string) => Promise<Product[]>;
  /** Optional re-ranking of each slot's search results (Gemini taste ranking). Unknown ids are ignored. */
  rank?: (slots: RankSlot[]) => Promise<Map<string, string[]>>;
  /** Products to keep, by need key: a loved item stays put through a refine. No search is spent on it. */
  keep?: Map<string, Product>;
  /** Products to avoid, by need key, as "store|title" keys: an item someone passed on isn't picked again. */
  avoid?: Map<string, string[]>;
  /**
   * Growing a new set: when cheaper picks alone can't reach the budget, leave out the items that overshoot their
   * share most until the set fits, so it opens within budget with as many things as the money covers.
   */
  trimToBudget?: boolean;
  now?: Date;
}

export interface RankSlot {
  slotId: string;
  need: string;
  options: Product[];
}

const makeSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const BULKY_NEEDS = /sofa|couch|loveseat|sectional|table|desk|bookshelf|bookcase|dresser|bed|mattress|tv stand|media console|cabinet|wardrobe/i;

interface Draft {
  slot: Slot;
  generated: GeneratedSlot;
  options: Product[];
  units: number;
}

export async function buildMap(input: BuildMapInput): Promise<MapData> {
  const { generated, budgetCents, memberCount, groupId } = input;
  const suffix = makeSuffix();
  const now = (input.now ?? new Date()).toISOString();
  const zones: Zone[] = [];
  const drafts: Draft[] = [];
  const slotIdByNeed = new Map<string, string>();

  const sortedZones = [...generated.zones].sort((a, b) => a.sortOrder - b.sortOrder);
  sortedZones.forEach((generatedZone, zoneIndex) => {
    const zone: Zone = { id: `zone_${slug(generatedZone.name)}_${suffix}${zoneIndex}`, groupId, name: generatedZone.name, sortOrder: zoneIndex };
    let kept = 0;
    for (const generatedSlot of generatedZone.slots) {
      const key = needKey(generatedSlot.need);
      if (slotIdByNeed.has(key)) continue;
      const normalized = normalizeSlot(generatedSlot, memberCount);
      const id = generatedSlotId(normalized.searchQuery, `${suffix}${drafts.length}`);
      slotIdByNeed.set(key, id);
      kept += 1;
      drafts.push({
        generated: normalized,
        options: [],
        units: normalized.payType === "per_person" ? normalized.quantity * memberCount : normalized.quantity,
        slot: {
          id,
          zoneId: zone.id,
          need: normalized.need,
          quantityRule: normalized.quantityRule,
          quantity: normalized.quantity,
          budgetCents: 0,
          payType: normalized.payType,
          ownerMemberId: null,
          chosenProductId: null,
          updatedBy: null,
          updatedAt: now,
        },
      });
    }
    if (kept > 0) zones.push(zone);
  });

  // Search every slot in parallel. A failed search leaves that slot empty instead of failing the map.
  const kept = (draft: Draft) => (draft.slot.payType === "already_owned" ? undefined : input.keep?.get(needKey(draft.slot.need)));
  const results = await Promise.allSettled(
    drafts.map((draft) => (draft.slot.payType === "already_owned" || kept(draft) ? Promise.resolve([]) : input.search(draft.generated.searchQuery))),
  );
  results.forEach((result, index) => {
    const draft = drafts[index];
    const keep = kept(draft);
    if (keep) {
      draft.options = [reattach(keep, draft.slot.id)];
      return;
    }
    const found = result.status === "fulfilled" ? attachToSlot(result.value, draft.slot.id) : [];
    // The query rides along on the product so the options route can repeat the same cached search after a restart.
    const options = found.map((product) => ({ ...product, attributes: { ...product.attributes, searchQuery: draft.generated.searchQuery } }));
    const avoid = new Set(input.avoid?.get(needKey(draft.slot.need)) ?? []);
    const allowed = avoid.size ? options.filter((product) => !avoid.has(productKey(product))) : options;
    draft.options = allowed.length > 0 ? allowed : options;
  });

  if (input.rank) await applyRanking(drafts.filter((draft) => draft.options.length > 1 && !kept(draft)), input.rank);

  allocateBudgets(drafts, budgetCents);
  const chosen = new Map<string, Product>();
  for (const draft of drafts) {
    const pick = pickProduct(draft);
    if (pick) chosen.set(draft.slot.id, pick);
  }
  if (budgetCents !== null) fitToBudget(drafts, chosen, budgetCents, memberCount);
  const dropped = budgetCents !== null && input.trimToBudget ? trimToBudget(drafts, chosen, budgetCents, memberCount) : [];
  if (dropped.length > 0) {
    const gone = new Set(dropped.map((draft) => draft.slot.id));
    for (const id of gone) chosen.delete(id);
    drafts.splice(0, drafts.length, ...drafts.filter((draft) => !gone.has(draft.slot.id)));
    for (const [key, id] of slotIdByNeed) if (gone.has(id)) slotIdByNeed.delete(key);
    const used = new Set(drafts.map((draft) => draft.slot.zoneId));
    zones.splice(0, zones.length, ...zones.filter((zone) => used.has(zone.id)));
  }
  for (const draft of drafts) {
    const product = chosen.get(draft.slot.id) ?? null;
    draft.slot.chosenProductId = product?.id ?? null;
    if (budgetCents === null) draft.slot.budgetCents = product ? product.priceCents * draft.units : 0;
  }

  const slots = drafts.map((draft) => draft.slot);
  const products = [...chosen.values()];
  const links: Link[] = [];
  generated.links.forEach((link, index) => {
    const fromSlotId = slotIdByNeed.get(needKey(link.fromNeed));
    const toSlotId = slotIdByNeed.get(needKey(link.toNeed));
    if (fromSlotId && toSlotId && fromSlotId !== toSlotId) links.push({ id: `link_${suffix}${index}`, fromSlotId, toSlotId, label: link.label });
  });

  const rules = buildRules(generated, slotIdByNeed, slots, groupId, suffix, budgetCents, input.doorWidthIn ?? null, dropped.map((draft) => draft.slot.need));
  const map: MapData = { zones, slots, products, links, rules };
  map.rules = checkRules(map, [], { memberCount, now: input.now });

  const searchQueries = new Map(drafts.map((draft) => [draft.slot.id, draft.generated.searchQuery]));
  registerMapSlots(map, searchQueries);
  return map;
}

/**
 * Keeps per-person math consistent with lib/money: per-person pay means per-person quantity.
 * A shared slot marked per_person becomes a fixed count for the whole group.
 */
export function normalizeSlot(slot: GeneratedSlot, memberCount: number): GeneratedSlot {
  if (slot.payType === "per_person") return { ...slot, quantityRule: "per_person" };
  if (slot.quantityRule === "per_person") return { ...slot, quantityRule: "fixed", quantity: slot.quantity * memberCount };
  return slot;
}

/** Splits the budget across charged slots by budgetWeight. Integer cents; the remainder goes to the first slots. */
function allocateBudgets(drafts: Draft[], budgetCents: number | null) {
  if (budgetCents === null) return;
  const charged = drafts.filter((draft) => draft.slot.payType !== "already_owned");
  const weights = charged.map((draft) => draft.generated.budgetWeight ?? 10);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) return;
  let assigned = 0;
  charged.forEach((draft, index) => {
    draft.slot.budgetCents = Math.floor((budgetCents * weights[index]) / totalWeight);
    assigned += draft.slot.budgetCents;
  });
  for (let index = 0; assigned < budgetCents && charged.length > 0; index = (index + 1) % charged.length) {
    charged[index].slot.budgetCents += 1;
    assigned += 1;
  }
}

/** Best-ranked result that fits the slot budget, else the cheapest. No budget: best-ranked. */
function pickProduct(draft: Draft): Product | null {
  if (draft.options.length === 0 || draft.slot.payType === "already_owned") return null;
  if (draft.slot.budgetCents <= 0) return draft.options[0];
  // Integer cents only: compare the full charge for the slot, never a divided per-unit budget.
  const units = Math.max(1, draft.units);
  return draft.options.find((product) => product.priceCents * units <= draft.slot.budgetCents) ?? cheapest(draft.options);
}

/**
 * Still over after the cheaper picks: leave out, one at a time, the item that overshoots its share of the budget
 * most, until the set fits. Keeps at least one item. Returns what was left out.
 */
function trimToBudget(drafts: Draft[], chosen: Map<string, Product>, budgetCents: number, memberCount: number): Draft[] {
  const charged = (draft: Draft) => chargedCentsForSlot(draft.slot, chosen.get(draft.slot.id) ?? null, memberCount);
  const kept = [...drafts];
  const dropped: Draft[] = [];
  while (kept.reduce((sum, draft) => sum + charged(draft), 0) > budgetCents) {
    const costly = kept.filter((draft) => charged(draft) > 0);
    if (costly.length <= 1) break;
    const worst = costly.reduce((a, b) => (charged(b) - b.slot.budgetCents > charged(a) - a.slot.budgetCents ? b : a));
    kept.splice(kept.indexOf(worst), 1);
    dropped.push(worst);
  }
  return dropped;
}

/** While the plan is over budget, step the most expensive slot down to its next cheaper option. */
function fitToBudget(drafts: Draft[], chosen: Map<string, Product>, budgetCents: number, memberCount: number) {
  const charged = (draft: Draft) => chargedCentsForSlot(draft.slot, chosen.get(draft.slot.id) ?? null, memberCount);
  for (let step = 0; step < 100; step += 1) {
    const total = drafts.reduce((sum, draft) => sum + charged(draft), 0);
    if (total <= budgetCents) return;
    const candidates = drafts
      .map((draft) => {
        const current = chosen.get(draft.slot.id);
        if (!current) return null;
        const cheaper = draft.options.filter((product) => product.priceCents < current.priceCents).sort((a, b) => b.priceCents - a.priceCents)[0];
        return cheaper ? { draft, cheaper, cost: charged(draft) } : null;
      })
      .filter((entry): entry is { draft: Draft; cheaper: Product; cost: number } => entry !== null)
      .sort((a, b) => b.cost - a.cost);
    if (candidates.length === 0) return;
    chosen.set(candidates[0].draft.slot.id, candidates[0].cheaper);
  }
}

function buildRules(
  generated: GeneratedMap,
  slotIdByNeed: Map<string, string>,
  slots: Slot[],
  groupId: string,
  suffix: string,
  budgetCents: number | null,
  doorWidthIn: number | null,
  leftOut: string[] = [],
): Rule[] {
  const rules: Rule[] = [];
  const add = (rule: Omit<Rule, "id" | "groupId" | "status" | "message">) =>
    rules.push({ ...rule, id: `rule_${rule.type}_${suffix}${rules.length}`, groupId, status: "not_checked", message: "" });

  if (budgetCents !== null) add({ type: "budget", slotIds: [], params: { maxCents: budgetCents } });
  for (const rule of generated.rules) {
    if (rule.type === "budget") continue;
    const slotIds = rule.needs.map((need) => slotIdByNeed.get(needKey(need))).filter((id): id is string => id !== undefined);
    const params = Object.fromEntries(Object.entries(rule.params).filter(([, value]) => value !== undefined));
    // Items left out to fit the budget aren't required any more.
    if (Array.isArray(params.requiredNeeds) && leftOut.length) {
      params.requiredNeeds = (params.requiredNeeds as string[]).filter((need) => !leftOut.some((left) => needMatches(left, need)));
      if ((params.requiredNeeds as string[]).length === 0 && !params.bannedNeeds && !params.bannedStores) continue;
    }
    if (rule.type !== "required_or_banned" && slotIds.length === 0) continue;
    if (rule.type === "size" && doorWidthIn !== null && params.doorWidthIn === undefined && params.maxWidthIn === undefined && params.relation === undefined) {
      params.doorWidthIn = doorWidthIn;
    }
    add({ type: rule.type, slotIds: [...new Set(slotIds)], params });
  }

  // The questionnaire's door width becomes a rule even when the model forgot it.
  if (doorWidthIn !== null && !rules.some((rule) => rule.type === "size" && rule.params.doorWidthIn !== undefined)) {
    const bulky = slots.filter((slot) => slot.payType !== "already_owned" && BULKY_NEEDS.test(slot.need)).map((slot) => slot.id);
    if (bulky.length > 0) add({ type: "size", slotIds: bulky, params: { doorWidthIn } });
  }
  return rules;
}

/** Ranked ids first, in the model's order, then everything it left out. Ranking never adds a product. */
async function applyRanking(drafts: Draft[], rank: NonNullable<BuildMapInput["rank"]>) {
  if (drafts.length === 0) return;
  let order: Map<string, string[]>;
  try {
    order = await rank(drafts.map((draft) => ({ slotId: draft.slot.id, need: draft.slot.need, options: draft.options })));
  } catch {
    return;
  }
  for (const draft of drafts) {
    const ids = order.get(draft.slot.id);
    if (!ids?.length) continue;
    const byId = new Map(draft.options.map((product) => [product.id, product]));
    const ranked = [...new Set(ids)].map((id) => byId.get(id)).filter((product): product is Product => product !== undefined);
    const rest = draft.options.filter((product) => !ranked.includes(product));
    draft.options = [...ranked, ...rest];
  }
}

/** A product moved to a new slot keeps its source id, so the options route builds the same id for it. */
function reattach(product: Product, slotId: string): Product {
  const sourceId = product.slotId && product.id.startsWith(`${product.slotId}_`) ? product.id.slice(product.slotId.length + 1) : product.id;
  return { ...product, id: `${slotId}_${sourceId}`, slotId };
}

/** "store|title", the key used to recognise the same product across searches. */
export function productKey(product: Pick<Product, "store" | "title">) {
  return `${product.store.toLowerCase()}|${product.title.toLowerCase()}`;
}

function cheapest(products: Product[]) {
  return products.reduce((best, product) => (product.priceCents < best.priceCents ? product : best));
}

export function needKey(need: string) {
  return need.trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "item";
}
