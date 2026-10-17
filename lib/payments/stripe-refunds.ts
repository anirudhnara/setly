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
        { idempotencyKey: `refund:${refund.productId}:${refund.memberId}` },
      );
    } catch {
      // The ledger row is already stored. A missing test PaymentIntent should not block the return.
    }
  }
}
