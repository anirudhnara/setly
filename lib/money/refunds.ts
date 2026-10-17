import type { Contribution, MemberShare, Refund } from "@/lib/types";

/**
 * Builds refunds for one returned product.
 *
 * Refunds go only to the members who paid for that item, in proportion to what each of them paid for it
 * (the matching `MemberShare` line, limited to contributions with status `paid`). Members who did not pay
 * for the item get nothing. Amounts are integer cents and sum to the cents those payers actually put toward
 * the item. `groupId` comes from the contributions. The stub does not invent ids or timestamps yet.
 */
export function computeRefunds(productId: string, contributions: Contribution[], shares: MemberShare[]): Refund[] {
  // TODO(Backend 1 (Money)): implement proportional refunds described above.
  void productId;
  void contributions;
  void shares;
  return [];
}
