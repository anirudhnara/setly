import type { CheckoutLaneName, MapData, Member, MemberShare, ShareLine, Slot } from "@/lib/types";
import { bufferCents, ZINC_FEE_CENTS } from "@/lib/money/buffer";
import { splitCents } from "@/lib/money/cents";

/**
 * Splits a map across members. Money is integer cents and the returned shares sum to the exact charged total.
 *
 * Charged amount for a slot is the chosen product's priceCents times the slot quantity.
 * - Shared slots are split evenly across every member. Remainder cents are given one each to the earliest
 *   members in join order (`joinedAt` ascending), so the lines for that slot sum to the exact charged amount.
 * - Per-person slots charge each member their own item: priceCents times quantity, not split.
 * - Already-owned slots cost nothing and do not add a line.
 * - A slot with no chosen product charges nothing.
 *
 * With `laneForStore` (checkout pricing), each store also gets:
 * - a `buffer` line: 10% of the store's subtotal, rounded up, split by each member's item cents at that store;
 * - for Zinc stores, a `zinc_fee` line: $1 split evenly, leftover cents to the earliest members.
 * Whatever the buffer and fee don't end up covering is refunded at settle (lib/money/leftover.ts).
 *
 * `MemberShare.totalCents` is the sum of that member's lines.
 */
export function computeShares(map: MapData, members: Member[], laneForStore?: (store: string) => CheckoutLaneName): MemberShare[] {
  const ordered = [...members].sort(byJoin);
  const lines = new Map<string, ShareLine[]>();
  for (const member of ordered) lines.set(member.id, []);

  for (const slot of map.slots) {
    const product = chosenProduct(map, slot);
    const charged = product ? product.priceCents * slot.quantity : null;
    if (!product || charged === null || charged <= 0 || slot.payType === "already_owned") continue;
    const store = product.store;
    if (slot.payType === "per_person") {
      for (const member of ordered) {
        lines.get(member.id)?.push({ kind: "item", slotId: slot.id, store, cents: charged });
      }
      continue;
    }
    const parts = splitCents(charged, ordered.map(() => 1));
    ordered.forEach((member, index) => {
      const cents = parts[index] ?? 0;
      if (cents > 0) lines.get(member.id)?.push({ kind: "item", slotId: slot.id, store, cents });
    });
  }

  if (laneForStore) {
    const stores = [...new Set(ordered.flatMap((member) => (lines.get(member.id) ?? []).map((line) => line.store ?? "")))].filter(Boolean);
    for (const store of stores) {
      const weights = ordered.map((member) =>
        (lines.get(member.id) ?? []).filter((line) => line.store === store).reduce((sum, line) => sum + line.cents, 0),
      );
      const subtotal = weights.reduce((sum, cents) => sum + cents, 0);
      const buffers = splitCents(bufferCents(subtotal), weights);
      const fees = laneForStore(store) === "zinc" ? splitCents(ZINC_FEE_CENTS, ordered.map(() => 1)) : [];
      ordered.forEach((member, index) => {
        const memberLines = lines.get(member.id);
        const buffer = buffers[index] ?? 0;
        const fee = fees[index] ?? 0;
        if (buffer > 0) memberLines?.push({ kind: "buffer", slotId: null, store, cents: buffer });
        if (fee > 0) memberLines?.push({ kind: "zinc_fee", slotId: null, store, cents: fee });
      });
    }
  }

  return ordered.map((member) => {
    const memberLines = lines.get(member.id) ?? [];
    return {
      memberId: member.id,
      totalCents: memberLines.reduce((sum, line) => sum + line.cents, 0),
      lines: memberLines,
    };
  });
}

function chosenProduct(map: MapData, slot: Slot) {
  if (!slot.chosenProductId) return null;
  return map.products.find((item) => item.id === slot.chosenProductId) ?? null;
}

function byJoin(left: Member, right: Member) {
  const time = left.joinedAt.localeCompare(right.joinedAt);
  return time === 0 ? left.id.localeCompare(right.id) : time;
}
