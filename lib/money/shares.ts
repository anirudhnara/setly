import type { MapData, Member, MemberShare } from "@/lib/types";

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
  // TODO(Backend 1 (Money)): implement the split described above.
  void map;
  void members;
  return [];
}
