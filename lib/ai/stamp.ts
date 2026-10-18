import type { MapData, Slot } from "@/lib/types";

function slotSignature(slot: Slot) {
  return [
    slot.need,
    slot.quantityRule,
    String(slot.quantity),
    String(slot.budgetCents),
    slot.payType,
    slot.ownerMemberId ?? "",
    slot.chosenProductId ?? "",
  ].join("\0");
}

/** Marks slots that are new or whose contents changed, so other members can see who edited them. */
export function stampChangedSlots(previous: MapData, next: MapData, memberId: string): MapData {
  const before = new Map(previous.slots.map((slot) => [slot.id, slotSignature(slot)]));
  const updatedAt = new Date().toISOString();
  return {
    ...next,
    slots: next.slots.map((slot) => {
      if (before.get(slot.id) === slotSignature(slot)) return slot;
      return { ...slot, updatedBy: memberId, updatedAt };
    }),
  };
}
