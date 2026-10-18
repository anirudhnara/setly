import type { Contribution, Refund } from "@/lib/types";
import { getStripe } from "@/lib/payments/stripe-client";

export async function refundContributions(refunds: Refund[], contributions: Contribution[]) {
  const stripe = getStripe();
  if (!stripe) return;
  for (const refund of refunds) {
    const contribution = contributions.find((item) => item.memberId === refund.memberId && item.stripePaymentIntentId);
    if (!contribution?.stripePaymentIntentId) continue;
    try {
      await stripe.refunds.create(
        { payment_intent: contribution.stripePaymentIntentId, amount: refund.amountCents },
        { idempotencyKey: refundKey(refund) },
      );
    } catch {
      // The ledger row is already stored. A missing test PaymentIntent should not block the return.
    }
  }
}

/** Returns key by product; checkout leftovers by store order (a failed Zinc order's fee refund gets its own key). */
export function refundKey(refund: Refund) {
  if (refund.productId) return `refund:${refund.productId}:${refund.memberId}`;
  return `refund:${refund.storeOrderId}:${refund.memberId}${refund.id.endsWith("_fee") ? ":fee" : ""}`;
}
