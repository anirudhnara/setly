import { customAlphabet } from "nanoid";
import { loadApartmentMap, loadCampingMap } from "@/lib/fixtures/sample";
import { needMatches, type QuestionnaireItems } from "@/lib/ai/parse";
import { checkRules } from "@/lib/rules/check";
import { searchCatalog } from "@/lib/search/serpapi";
import { generatedSlotId, registerMapSlots } from "@/lib/search/options";
import type { MapData, Rule } from "@/lib/types";

/**
 * Starter map for MOCK_AI=1 and the fallback when Gemini fails.
 * Every id gets a fresh suffix ("slot_sofa__k3x9...") so two groups can be saved without key collisions;
 * the options route strips the suffix to find the fixture slot. Budget, group size, and door width
 * from the questionnaire are applied, then every rule is re-checked in code.
 */
const makeSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const BULKY_NEEDS = /sofa|couch|coffee table|bookshelf|tv stand|desk|dining table|bed frame/i;

export interface FixtureMapOptions {
  budgetCents: number | null;
  memberCount: number | null;
  doorWidthIn: number | null;
  groupId: string;
  items?: QuestionnaireItems;
}

export function isCampingPrompt(text: string) {
  return /camp|tent|trail|hike|hiking|backpack/i.test(text);
}

export function fixtureMapForPrompt(prompt: string, options: FixtureMapOptions): MapData {
  const camping = isCampingPrompt(prompt);
  const source = camping ? loadCampingMap() : loadApartmentMap();
  const suffix = makeSuffix();
  const slotId = (id: string) => `${id}__${suffix}`;
  const now = new Date().toISOString();

  const map: MapData = {
    zones: source.zones.map((zone) => ({ ...zone, id: `${zone.id}__${suffix}`, groupId: options.groupId })),
    slots: source.slots.map((slot) => ({
      ...slot,
      id: slotId(slot.id),
      zoneId: `${slot.zoneId}__${suffix}`,
      chosenProductId: slot.chosenProductId ? `${slotId(slot.id)}_${slot.chosenProductId}` : null,
      // A new group has no members yet, so fixture owners and editors don't carry over.
      ownerMemberId: null,
      updatedBy: null,
      updatedAt: now,
    })),
    products: source.products.map((product) => ({ ...product, id: `${slotId(product.slotId)}_${product.id}`, slotId: slotId(product.slotId) })),
    links: source.links.map((link) => ({ ...link, id: `${link.id}__${suffix}`, fromSlotId: slotId(link.fromSlotId), toSlotId: slotId(link.toSlotId) })),
    rules: source.rules.map((rule): Rule => ({ ...rule, id: `${rule.id}__${suffix}`, groupId: options.groupId, slotIds: rule.slotIds.map(slotId), params: { ...rule.params } })),
  };

  if (options.items) applyItems(map, options.items, options.groupId, suffix);

  if (options.budgetCents !== null) {
    scaleSlotBudgets(map, options.budgetCents);
    const budget = map.rules.find((rule) => rule.type === "budget");
    if (budget) budget.params = { ...budget.params, maxCents: options.budgetCents };
    else map.rules.unshift({ id: `rule_budget__${suffix}`, groupId: options.groupId, type: "budget", slotIds: [], params: { maxCents: options.budgetCents }, status: "not_checked", message: "" });
  }

  if (options.doorWidthIn !== null) {
    const bulky = map.slots.filter((slot) => slot.payType !== "already_owned" && BULKY_NEEDS.test(slot.need)).map((slot) => slot.id);
    if (bulky.length > 0) {
      map.rules.push({ id: `rule_door__${suffix}`, groupId: options.groupId, type: "size", slotIds: bulky, params: { doorWidthIn: options.doorWidthIn }, status: "not_checked", message: "" });
    }
  }

  const memberCount = options.memberCount ?? (camping ? 6 : 4);
  map.rules = checkRules(map, [], { memberCount });
  registerMapSlots(map);
  return map;
}

/** Rescales fixture slot budgets to the questionnaire budget. Integer cents; the remainder goes to the first slots. */
function scaleSlotBudgets(map: MapData, budgetCents: number) {
  const charged = map.slots.filter((slot) => slot.payType !== "already_owned" && slot.budgetCents > 0);
  const total = charged.reduce((sum, slot) => sum + slot.budgetCents, 0);
  if (total === 0) return;
  let assigned = 0;
  for (const slot of charged) {
    slot.budgetCents = Math.floor((slot.budgetCents * budgetCents) / total);
    assigned += slot.budgetCents;
  }
  for (let index = 0; assigned < budgetCents; index = (index + 1) % charged.length) {
    charged[index].budgetCents += 1;
    assigned += 1;
  }
}

/** Owned items cost nothing; missing must-haves get a slot with a sample product and a required rule. */
function applyItems(map: MapData, items: QuestionnaireItems, groupId: string, suffix: string) {
  for (const slot of map.slots) {
    if (items.owned.some((item) => needMatches(slot.need, item))) {
      slot.payType = "already_owned";
      slot.budgetCents = 0;
    }
  }
  const zoneId = map.zones[0]?.id;
  if (!zoneId) return;
  for (const need of items.mustHaves) {
    if (map.slots.some((slot) => needMatches(slot.need, need))) continue;
    const id = generatedSlotId(need, suffix);
    const product = searchCatalog(need)[0];
    map.slots.push({
      id, zoneId, need, quantityRule: "per_group", quantity: 1, budgetCents: product?.priceCents ?? 0, payType: "shared",
      ownerMemberId: null, chosenProductId: product ? `${id}_${product.id}` : null, updatedBy: null, updatedAt: new Date().toISOString(),
    });
    if (product) map.products.push({ ...product, id: `${id}_${product.id}`, slotId: id });
  }
  if (items.mustHaves.length > 0) {
    map.rules.push({ id: `rule_must__${suffix}`, groupId, type: "required_or_banned", slotIds: [], params: { requiredNeeds: items.mustHaves }, status: "not_checked", message: "" });
  }
}
