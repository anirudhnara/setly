import { authorizeCharge, returnItem, runCheckout } from "@/lib/db/ledger";
import { getLedgerStore } from "@/lib/db/memory-store";
import type { Card } from "@/lib/types";
import type { Issuer } from "@/lib/payments/issuer";
import { getStripe } from "@/lib/payments/stripe-client";
import { refundContributions } from "@/lib/payments/stripe-refunds";

export const stripeIssuer: Issuer = {
  async createCard(groupId, limits) {
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe secret key is not set");
    const limitCents = limits.reduce((sum, limit) => sum + limit.limitCents, 0);
    try {
      const cardholder = await stripe.issuing.cardholders.create(
        {
          type: "individual",
          name: "Setly Demo",
          email: "issuing@setly.test",
          phone_number: "+18085550100",
          billing: {
            address: { line1: "1234 Main Street", city: "Seattle", state: "WA", postal_code: "98105", country: "US" },
          },
          individual: { first_name: "Setly", last_name: "Demo", dob: { day: 1, month: 1, year: 1990 } },
        },
        { idempotencyKey: `cardholder:${groupId}` },
      );
      const card = await stripe.issuing.cards.create(
        {
          cardholder: cardholder.id,
          currency: "usd",
          type: "virtual",
          status: "active",
          spending_controls: limitCents > 0 ? { spending_limits: [{ amount: limitCents, interval: "all_time" }] } : undefined,
          metadata: { groupId },
        },
        { idempotencyKey: `card:${groupId}` },
      );
      const issued: Card = {
        id: card.id,
        groupId,
        last4: card.last4 ?? "4242",
        limitCents,
        status: limitCents > 0 ? "active" : "inactive",
      };
      return issued;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe Issuing request failed";
      throw new Error(`Stripe Issuing could not create a card. ${message}`);
    }
  },

  authorize(cardId, merchant, amountCents) {
    return authorizeCharge(cardId, merchant, amountCents);
  },

  runDemoCheckout(groupId) {
    return runCheckout(groupId);
  },

  async refundItem(productId) {
    const state = await (await getLedgerStore()).findByProductId(productId);
    if (!state) return [];
    const result = await returnItem(state.group.id, productId);
    if (result.created) await refundContributions(result.refunds, result.contributions);
    return result.refunds;
  },
};
