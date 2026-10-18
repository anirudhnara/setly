import type { MapData, Member } from "@/lib/types";

/** Zinc charges $1 per order on top of the items. */
export const ZINC_FEE_CENTS = 100;

/** 10% of the subtotal, rounded up to the cent. Covers tax and shipping the search price doesn't show. */
export function bufferCents(subtotalCents: number) {
  if (subtotalCents <= 0) return 0;
  return Math.floor((subtotalCents + 9) / 10);
}

/** The most a store may charge without the group approving more: subtotal plus buffer. */
export function capCents(subtotalCents: number) {
  return subtotalCents + bufferCents(subtotalCents);
}

/**
 * What the plan buys at each store, in integer cents, in first-seen order.
 * Per-person slots buy one set per member; already-owned slots and slots with no product buy nothing.
 */
export function storeSubtotals(map: MapData, members: Member[]): { store: string; subtotalCents: number }[] {
  const totals = new Map<string, number>();
  for (const slot of map.slots) {
    if (slot.payType === "already_owned" || !slot.chosenProductId) continue;
    const product = map.products.find((item) => item.id === slot.chosenProductId);
    if (!product) continue;
    const each = product.priceCents * slot.quantity;
    const amount = slot.payType === "per_person" ? each * members.length : each;
    if (amount <= 0) continue;
    totals.set(product.store, (totals.get(product.store) ?? 0) + amount);
  }
  return [...totals.entries()].map(([store, subtotalCents]) => ({ store, subtotalCents }));
}
