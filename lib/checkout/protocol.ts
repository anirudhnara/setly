import { demoStoreSlug } from "@/lib/checkout/registry";
import type { CheckoutLane, LaneOrder } from "@/lib/checkout/lane";
import type { SessionAddress } from "@/lib/stores/session";
import { sessionTotal, type CheckoutSession } from "@/lib/stores/session";
import { completeSession, createSession, type StoreResult } from "@/lib/stores/server";

/**
 * The protocol lane: an agentic checkout against the demo stores' ACP-shaped seller endpoints.
 * quote = create a session with the items and address and read its total; place = complete it with the card.
 */
function slugFor(order: LaneOrder) {
  const slug = demoStoreSlug(order.order.store);
  if (!slug) throw new Error(`${order.order.store} has no protocol checkout`);
  return slug;
}

function sessionAddress(order: LaneOrder): SessionAddress {
  const address = order.address;
  return {
    name: `${address.firstName} ${address.lastName}`,
    line_one: address.line1,
    line_two: address.line2,
    city: address.city,
    state: address.state,
    postal_code: address.postalCode,
    country: "US",
  };
}

function sku(item: LaneOrder["items"][number]) {
  const value = item.product.attributes.sku;
  return typeof value === "string" && value ? value : item.product.id;
}

function errorOf(result: StoreResult) {
  const body = result.body;
  if ("error" in body) return body.error;
  return body.messages.find((message) => message.type === "error")?.content ?? "The store rejected the checkout";
}

function session(result: StoreResult): CheckoutSession | null {
  return "error" in result.body ? null : result.body;
}

export const protocolLane: CheckoutLane = {
  async quote(order) {
    const result = createSession(slugFor(order), {
      items: order.items.map((item) => ({ id: sku(item), quantity: item.quantity })),
      fulfillment_address: sessionAddress(order),
    });
    const created = session(result);
    if (!created || created.status !== "ready_for_payment") throw new Error(errorOf(result));
    return { quotedCents: sessionTotal(created), externalId: created.id };
  },

  async place(order) {
    const sessionId = order.order.externalId;
    if (!sessionId || !order.cardId) return { status: "failed", error: "Checkout session or card is missing" };
    const result = await completeSession(slugFor(order), sessionId, { payment_data: { token: order.cardId, provider: "setly" } });
    const completed = session(result);
    if (result.status !== 200 || !completed?.order) return { status: "failed", error: errorOf(result) };
    return { status: "placed", externalId: completed.order.id, finalTotalCents: sessionTotal(completed), error: null };
  },

  async status(order) {
    // Completing a session places the order at once; nothing more to poll.
    return { status: order.order.status };
  },
};
