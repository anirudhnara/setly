import { z } from "zod";
import type { RankSlot } from "@/lib/ai/build-map";
import { askGeminiJson } from "@/lib/ai/llm";

/**
 * Gemini orders each slot's real search results by how well they fit what the group asked for.
 * The model sees short labels ("s0", "o3") for results it was given and nothing else; any label it invents is dropped.
 * Prices stay out of the prompt: the budget pass in buildMap picks within the ranked order.
 */
const RANK_TIMEOUT_MS = 6_000;
const MAX_OPTIONS_PER_SLOT = 8;

const rankSchema = z.object({
  picks: z.array(z.object({ slot: z.string(), order: z.array(z.string()).max(MAX_OPTIONS_PER_SLOT) })).max(30),
});

const RANK_SYSTEM = `You are a sharp personal shopper. For each slot, order the given search results from best to worst fit for the group's request: style, use, quality signals in the title, and whether it is actually the thing needed (not an accessory, part, or bundle of something else).
Return JSON only. Use only the slot and option labels you were given. Put results that are the wrong kind of product last.`;

export async function rankWithGemini(request: string, slots: RankSlot[]): Promise<Map<string, string[]>> {
  const lines: string[] = [`Group request: ${request.slice(0, 800)}`, ""];
  slots.forEach((slot, slotIndex) => {
    lines.push(`s${slotIndex} need: ${slot.need}`);
    slot.options.slice(0, MAX_OPTIONS_PER_SLOT).forEach((option, optionIndex) => {
      lines.push(`  o${optionIndex}: ${option.title.slice(0, 110)} (${option.store})`);
    });
  });
  const result = await askGeminiJson({ prompt: lines.join("\n"), system: RANK_SYSTEM, schema: rankSchema, timeoutMs: RANK_TIMEOUT_MS, temperature: 0.2 });
  return labelsToIds(result, slots);
}

/** Maps "s0" / "o3" labels back to slot and product ids, dropping anything the model made up. Exported for tests. */
export function labelsToIds(result: z.infer<typeof rankSchema>, slots: RankSlot[]): Map<string, string[]> {
  const order = new Map<string, string[]>();
  for (const pick of result.picks) {
    const slot = slots[Number(pick.slot.replace(/^s/i, ""))];
    if (!slot || !/^s?\d+$/i.test(pick.slot)) continue;
    const ids = pick.order
      .map((label) => (/^o?\d+$/i.test(label) ? slot.options[Number(label.replace(/^o/i, ""))]?.id : undefined))
      .filter((id): id is string => id !== undefined);
    if (ids.length) order.set(slot.slotId, ids);
  }
  return order;
}
