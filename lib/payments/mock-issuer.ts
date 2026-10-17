import { nanoid } from "nanoid";
import { authorizeCharge, returnItemByProductId, runCheckout } from "@/lib/db/ledger";
import type { Card } from "@/lib/types";
import type { Issuer } from "@/lib/payments/issuer";

export const mockIssuer: Issuer = {
  async createCard(groupId, limits) {
    const limitCents = limits.reduce((sum, limit) => sum + limit.limitCents, 0);
    const card: Card = {
      id: `card_${nanoid(8)}`,
      groupId,
      last4: "4242",
      limitCents,
      status: limitCents > 0 ? "active" : "inactive",
    };
    return card;
  },

  authorize(cardId, merchant, amountCents) {
    return authorizeCharge(cardId, merchant, amountCents);
  },

  runDemoCheckout(groupId) {
    return runCheckout(groupId);
  },

  refundItem(productId) {
    return returnItemByProductId(productId);
  },
};
