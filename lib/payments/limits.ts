import type { MapData, Member } from "@/lib/types";
import type { StoreLimitInput } from "@/lib/payments/issuer";

export function storeLimitInputs(map: MapData, members: Member[]): StoreLimitInput[] {
  const totals = new Map<string, number>();
  for (const slot of map.slots) {
    if (slot.payType === "already_owned" || !slot.chosenProductId) continue;
    const product = map.products.find((item) => item.id === slot.chosenProductId);
    if (!product) continue;
    const amount = slot.payType === "per_person" ? product.priceCents * slot.quantity * members.length : product.priceCents * slot.quantity;
    totals.set(product.store, (totals.get(product.store) ?? 0) + amount);
  }
  return [...totals.entries()].map(([store, limitCents]) => ({ store, limitCents }));
}
