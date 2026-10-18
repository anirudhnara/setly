import { z } from "zod";
import { buildMap, needKey, productKey } from "@/lib/ai/build-map";
import { askGeminiJson, describe, geminiConfigured } from "@/lib/ai/llm";
import { needMatches, parseBudgetCents } from "@/lib/ai/parse";
import { MAP_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { rankWithGemini } from "@/lib/ai/rank";
import { generatedMapSchema, type GeneratedMap } from "@/lib/ai/schemas";
import { structureFromMap, styleWord, withStyle } from "@/lib/ai/structure";
import { planTotalCents } from "@/lib/rules/check";
import { parseVibeLine } from "@/lib/catalog/vibes";
import { findProducts } from "@/lib/search/find";
import type { MapData, Product } from "@/lib/types";

/**
 * Grows the set again from feedback ("make it cheaper", "add a TV", "more minimal", a loved or passed-on item).
 * Gemini revises the structure when it's reachable; otherwise a small rule-based editor applies the same kinds of
 * changes. Either way every product comes from search, loved items stay, passed-on items aren't picked again,
 * and the budget is set by code, never by the model.
 */
const REFINE_TIMEOUT_MS = 14_000;

export const refineRequestSchema = z.object({
  groupId: z.string().min(1),
  message: z.string().max(500).default(""),
  /** Earlier feedback, oldest first, so the set keeps what the group already asked for. */
  history: z.array(z.string().max(500)).max(20).default([]),
  liked: z.array(z.string().min(1)).max(40).default([]),
  disliked: z.array(z.string().min(1)).max(40).default([]),
});
export type RefineRequest = z.input<typeof refineRequestSchema>;

export interface RefineChanges {
  added: string[];
  removed: string[];
  changed: string[];
}
export type RefineResponse = { map: MapData; reply: string; changes: RefineChanges; budgetCents: number | null };

export const chooseRequestSchema = z.object({
  groupId: z.string().min(1),
  slotId: z.string().min(1),
  productId: z.string().min(1),
});
export type ChooseRequest = z.infer<typeof chooseRequestSchema>;
export type ChooseResponse = MapData;

const refinedMapSchema = generatedMapSchema.extend({ reply: z.string().min(1).max(240) });

const REFINE_SYSTEM = `${MAP_SYSTEM_PROMPT}

You are revising an existing plan from the group's feedback. Return the FULL revised plan.
- Keep every slot the feedback doesn't touch exactly as it is (same need and searchQuery).
- Loved items must stay with the same need and searchQuery.
- For passed-on items, keep the need but write a different searchQuery that answers the feedback.
- Add, remove, or restyle slots only when the feedback asks for it. Style changes rewrite searchQuery wording.
"reply" is one short, friendly line telling the group what you changed. No prices or store names.`;

export interface RefineInput {
  prompt: string;
  history: string[];
  message: string;
  map: MapData;
  liked: string[];
  disliked: string[];
  budgetCents: number | null;
  memberCount: number;
  groupId: string;
}

export async function refineMap(input: RefineInput): Promise<RefineResponse> {
  const current = structureFromMap(input.map);
  const budgetCents = nextBudget(input.message, input.budgetCents, planTotalCents(input.map, input.memberCount));
  const likedSlots = input.map.slots.filter((slot) => input.liked.includes(slot.id));
  const dislikedSlots = input.map.slots.filter((slot) => input.disliked.includes(slot.id));

  let generated: GeneratedMap;
  let reply = "";
  let usedModel = false;
  const ruleEdit = applyFeedback(current, input.message);
  if (geminiConfigured()) {
    try {
      const revised = await askGeminiJson({
        prompt: refinePrompt(input, current, budgetCents, likedSlots.map((slot) => slot.need), dislikedSlots.map((slot) => slot.need)),
        system: REFINE_SYSTEM,
        schema: refinedMapSchema,
        timeoutMs: REFINE_TIMEOUT_MS,
      });
      const { reply: modelReply, ...rest } = revised;
      generated = rest;
      reply = modelReply;
      usedModel = true;
    } catch (error) {
      console.warn(`Refine fell back to the rule-based editor: ${describe(error)}`);
      generated = ruleEdit.generated;
    }
  } else {
    generated = ruleEdit.generated;
  }

  // Loved items stay; passed-on items (and anything the message asked to swap) avoid their current product.
  const keep = new Map<string, Product>();
  const avoid = new Map<string, string[]>();
  // Slots the feedback didn't touch (same need, same search) keep their pick, so a refine only moves what was asked.
  const queryFor = (structure: GeneratedMap) => new Map(structure.zones.flatMap((zone) => zone.slots.map((slot) => [needKey(slot.need), slot.searchQuery.trim().toLowerCase()] as const)));
  const before = queryFor(current);
  const after = queryFor(generated);
  for (const slot of input.map.slots) {
    const product = input.map.products.find((item) => item.id === slot.chosenProductId);
    if (!product) continue;
    const swapped = input.disliked.includes(slot.id) || ruleEdit.swapNeeds.some((need) => needMatches(slot.need, need));
    const untouched = before.get(needKey(slot.need)) === after.get(needKey(slot.need));
    if (input.liked.includes(slot.id) || (untouched && !swapped && budgetCents === input.budgetCents)) keep.set(needKey(slot.need), product);
    else if (input.disliked.includes(slot.id) || ruleEdit.swapNeeds.some((need) => needMatches(slot.need, need))) {
      avoid.set(needKey(slot.need), [productKey(product)]);
    }
  }

  const request = [input.prompt, ...input.history, input.message].filter(Boolean).join(" ");
  const map = await buildMap({
    generated,
    budgetCents,
    memberCount: input.memberCount,
    groupId: input.groupId,
    search: (query) => findProducts(query, parseVibeLine(input.prompt)),
    rank: usedModel ? (slots) => rankWithGemini(request, slots) : undefined,
    keep,
    avoid,
  });
  const changes = diffMaps(input.map, map);
  return { map, reply: reply || describeChanges(changes, budgetCents, input.budgetCents), changes, budgetCents };
}

function refinePrompt(input: RefineInput, current: GeneratedMap, budgetCents: number | null, liked: string[], disliked: string[]) {
  const lines = [`Original request: ${input.prompt}`];
  if (input.history.length) lines.push(`Earlier feedback: ${input.history.join(" | ")}`);
  lines.push(`New feedback: ${input.message || "(none — only the item reactions below)"}`);
  if (liked.length) lines.push(`Loved (keep): ${liked.join(", ")}`);
  if (disliked.length) lines.push(`Passed on (find something different): ${disliked.join(", ")}`);
  lines.push(budgetCents ? `Total budget: $${Math.round(budgetCents / 100)} for the whole group.` : "No budget was given.");
  lines.push(`People in the group: ${input.memberCount}.`);
  lines.push(`Current plan:\n${JSON.stringify({ zones: current.zones, links: current.links })}`);
  return lines.join("\n");
}

/** Budget in integer cents after the feedback: an amount in the message wins, then "cheaper" and "nicer". */
export function nextBudget(message: string, budgetCents: number | null, totalCents: number): number | null {
  const stated = parseBudgetCents(message) ?? parseBudgetCents(message.replace(/\b(under|below|max|around|about)\s+(\d)/i, "budget $2"));
  if (stated) return stated;
  const base = budgetCents ?? (totalCents > 0 ? totalCents : null);
  if (base === null) return null;
  if (/\b(cheaper|less expensive|lower|save|tighter|too (much|expensive|pricey)|cut (the )?cost|on a budget|affordable)\b/i.test(message)) {
    return Math.round(Math.min(base, totalCents || base) * 0.8);
  }
  if (/\b(nicer|premium|upgrade|splurge|higher[- ]end|better quality|luxur)/i.test(message)) return Math.round(base * 1.25);
  return budgetCents;
}

const STOP_ITEMS = /^(it|them|this|that|something|anything|more|less|cheaper|nicer|everything|stuff|things|one|some|to|be|a bit|the budget|budget|money)\b/i;

/**
 * Rule-based edits for when the model is unavailable. Exported for tests.
 * "add a TV and a plant", "no rug", "remove the coffee table", "more minimal", "swap the lamp".
 */
export function applyFeedback(generated: GeneratedMap, message: string): { generated: GeneratedMap; swapNeeds: string[] } {
  let next: GeneratedMap = { ...generated, zones: generated.zones.map((zone) => ({ ...zone, slots: [...zone.slots] })) };
  const text = ` ${message.toLowerCase()} `;
  const items = (pattern: RegExp) =>
    [...text.matchAll(pattern)]
      .flatMap((match) => match[1].split(/\s*(?:,|\band\b|&|\bplus\b)\s*/))
      .map((item) => item.replace(/^(?:a|an|the|some|our|my|another|new)\s+/, "").replace(/\s+(?:too|as well|please|instead)$/, "").trim())
      .filter((item) => item.length >= 2 && item.length <= 40 && !STOP_ITEMS.test(item));

  const removals = items(/\b(?:remove|drop|ditch|lose|skip|without|get rid of|don'?t need|do not need|no more|no)\s+([a-z][a-z ,&'-]*?)(?=[.;!?]|$|\s+(?:but|then|so|because)\b)/g);
  const additions = items(/\b(?:add|include|also need|we need|we want|throw in|plus)\s+([a-z][a-z ,&'-]*?)(?=[.;!?]|$|\s+(?:but|then|so|because|for)\b)/g);
  const swapNeeds = items(/\b(?:swap|replace|change|different|another|hate|don'?t like)\s+(?:out\s+)?([a-z][a-z ,&'-]*?)(?=[.;!?]|$|\s+(?:but|then|so|because|for|with)\b)/g);

  if (removals.length) {
    next.zones = next.zones.map((zone) => ({ ...zone, slots: zone.slots.filter((slot) => !removals.some((item) => needMatches(slot.need, item))) }));
  }
  const style = styleWord(message);
  for (const item of additions) {
    const exists = next.zones.some((zone) => zone.slots.some((slot) => needMatches(slot.need, item)));
    if (exists || next.zones.length === 0) continue;
    const need = item.charAt(0).toUpperCase() + item.slice(1);
    const zone = next.zones.find((candidate) => candidate.slots.length < 15) ?? next.zones[0];
    zone.slots.push({ need, quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: style ? `${style} ${item}` : item, budgetWeight: 10 });
  }
  if (style) next = withStyle(next, style);
  next.zones = next.zones.filter((zone) => zone.slots.length > 0).map((zone, index) => ({ ...zone, sortOrder: index }));
  if (next.zones.length === 0) next = generated;
  return { generated: next, swapNeeds };
}

/** What changed between two maps, by need. Exported for tests. */
export function diffMaps(before: MapData, after: MapData): RefineChanges {
  const chosen = (map: MapData) =>
    new Map(
      map.slots.map((slot) => {
        const product = map.products.find((item) => item.id === slot.chosenProductId);
        return [needKey(slot.need), { need: slot.need, key: product ? productKey(product) : "" }];
      }),
    );
  const old = chosen(before);
  const fresh = chosen(after);
  const added = [...fresh.entries()].filter(([key]) => !old.has(key)).map(([, value]) => value.need);
  const removed = [...old.entries()].filter(([key]) => !fresh.has(key)).map(([, value]) => value.need);
  const changed = [...fresh.entries()].filter(([key, value]) => old.has(key) && old.get(key)?.key !== value.key).map(([, value]) => value.need);
  return { added, removed, changed };
}

function describeChanges(changes: RefineChanges, budgetCents: number | null, previous: number | null) {
  const parts: string[] = [];
  if (changes.added.length) parts.push(`added ${list(changes.added)}`);
  if (changes.removed.length) parts.push(`dropped ${list(changes.removed)}`);
  if (changes.changed.length) parts.push(`found new picks for ${list(changes.changed)}`);
  if (budgetCents !== previous && budgetCents) parts.push(`aimed for $${Math.round(budgetCents / 100).toLocaleString("en-US")}`);
  if (parts.length === 0) return "I checked the set again and it already fits what you asked for.";
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function list(items: string[]) {
  const lower = items.map((item) => item.toLowerCase());
  if (lower.length <= 2) return lower.join(" and ");
  return `${lower.slice(0, 2).join(", ")} and ${lower.length - 2} more`;
}

