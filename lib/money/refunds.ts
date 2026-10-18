import { nanoid } from "nanoid";
import type { Contribution, MemberShare, Refund } from "@/lib/types";
import { splitCents } from "@/lib/money/cents";

/**
 * Builds refunds for one returned product.
 *
 * Refunds go only to the members who paid for that item, in proportion to what each of them paid for it
 * (the matching `MemberShare` line, limited to contributions with status `paid`). Members who did not pay
 * for the item get nothing. Amounts are integer cents and sum to the cents those payers actually put toward
 * the item. Leftover cents go one each to the largest payers, with earlier shares winning a tie.
 * `groupId` comes from the contributions.
 */
export function computeRefunds(
  productId: string,
  contributions: Contribution[],
  shares: MemberShare[],
  products: { id: string; slotId: string }[],
): Refund[] {
  const slotId = products.find((product) => product.id === productId)?.slotId;
  if (!slotId) return [];
  const paid = new Set(contributions.filter((contribution) => contribution.status === "paid").map((contribution) => contribution.memberId));
  const payers = shares.flatMap((share) => {
    const cents = share.lines.find((line) => line.slotId === slotId)?.cents ?? 0;
    if (cents <= 0 || !paid.has(share.memberId)) return [];
    return [{ memberId: share.memberId, cents }];
  });
  if (payers.length === 0) return [];
  const pool = payers.reduce((sum, payer) => sum + payer.cents, 0);
  const amounts = splitCents(pool, payers.map((payer) => payer.cents));
  const createdAt = new Date().toISOString();
  return payers.flatMap((payer, index) => {
    const amountCents = amounts[index] ?? 0;
    if (amountCents <= 0) return [];
    const groupId = contributions.find((contribution) => contribution.memberId === payer.memberId)?.groupId ?? contributions[0]?.groupId;
    if (!groupId) return [];
    const refund: Refund = {
      id: `ref_${nanoid(8)}`,
      groupId,
      productId,
      storeOrderId: null,
      memberId: payer.memberId,
      amountCents,
      reason: "return",
      createdAt,
    };
    return [refund];
  });
}
