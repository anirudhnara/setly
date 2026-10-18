import { registryEntry } from "@/lib/checkout/registry";
import type { CheckoutLane } from "@/lib/checkout/lane";

/**
 * The guided lane: Setly can't buy from this store itself, so a member checks out on the store's site with
 * the group card. The order counts as placed once the card has an approved charge at that store.
 */
export const guidedLane: CheckoutLane = {
  async quote(order) {
    return { quotedCents: order.items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0), externalId: null };
  },

  async place(order) {
    const link = order.items.find((item) => /^https?:\/\//.test(item.product.url))?.product.url ?? registryEntry(order.order.store)?.baseUrl ?? null;
    return { status: "placing", externalId: link, error: null };
  },

  async status(order) {
    const store = order.order.store.toLowerCase();
    const charged = order.authorizations.filter((authorization) => authorization.approved && authorization.merchant.toLowerCase().includes(store));
    if (charged.length === 0) return { status: "placing" };
    return { status: "placed", finalTotalCents: charged.reduce((sum, authorization) => sum + authorization.amountCents, 0), error: null };
  },
};
