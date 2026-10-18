import type { MapData, Member, MemberShare, ShareLine, Slot } from "@/lib/types";
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
 * `MemberShare.totalCents` is the sum of that member's lines.
 */
export function computeShares(map: MapData, members: Member[]): MemberShare[] {
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
