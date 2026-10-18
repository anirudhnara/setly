import { z } from "zod";
import { recolorPick } from "@/lib/catalog/product-color";
import { stampChangedSlots } from "@/lib/ai/stamp";
import { checkRules } from "@/lib/rules/check";
import { getSlotOptions } from "@/lib/search/options";
import type { GroupState, MapData, Product } from "@/lib/types";

/** "Shuffle colors": every item (or one branch's) moves to a different color of the same thing at a similar price. */
export const recolorRequestSchema = z.object({ groupId: z.string().min(1), zoneId: z.string().min(1).optional() });
export type RecolorRequest = z.infer<typeof recolorRequestSchema>;
export type RecolorResponse = { map: MapData; changed: number };

/** Looks up each slot's options, then returns the recolored map in one piece so it's saved in one write. */
export async function recolorMap(state: GroupState, memberId: string, zoneId?: string, random: () => number = Math.random): Promise<RecolorResponse> {
  const slots = state.map.slots.filter((slot) => slot.payType !== "already_owned" && slot.chosenProductId && (!zoneId || slot.zoneId === zoneId));
  const picks = await Promise.all(
    slots.map(async (slot) => {
      const current = state.map.products.find((product) => product.id === slot.chosenProductId);
      if (!current) return null;
      const options = (await getSlotOptions(slot.id).catch(() => null)) ?? [];
      const pick = recolorPick(current, options, random);
      return pick ? { slotId: slot.id, product: { ...pick, slotId: slot.id } } : null;
    }),
  );
  const changes = picks.filter((pick): pick is { slotId: string; product: Product } => Boolean(pick));
  if (changes.length === 0) return { map: state.map, changed: 0 };
  const next = new Map(changes.map((change) => [change.slotId, change.product]));
  const recolored: MapData = {
    ...state.map,
    slots: state.map.slots.map((slot) => {
      const product = next.get(slot.id);
      return product ? { ...slot, chosenProductId: product.id } : slot;
    }),
    products: [...state.map.products.filter((product) => !next.has(product.slotId)), ...changes.map((change) => change.product)],
  };
  const map = stampChangedSlots(state.map, recolored, memberId);
  if (state.members.length > 0) map.rules = checkRules(map, state.members);
  return { map, changed: changes.length };
}
