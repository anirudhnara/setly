import { checkoutZincMode } from "@/lib/env";
import type { CheckoutLane, LaneOrder, LaneUpdate } from "@/lib/checkout/lane";
import { createZincOrder, getZincOrder } from "@/lib/checkout/zinc/client";
import { buildZincOrder, zincBlocker } from "@/lib/checkout/zinc/request";
import { createSimOrder, simOrderStatus } from "@/lib/checkout/zinc/simulator";
import { ZincRequestError, type ZincOrder } from "@/lib/checkout/zinc/types";

/**
 * The Zinc lane buys real retailers' items with max_price = the store order's cap.
 * CHECKOUT_ZINC=off uses the simulator (no network); sandbox and live call api.zinc.com.
 */
const READABLE: Record<string, string> = {
  out_of_stock: "is out of stock",
  shipping_unavailable: "can't ship to this address",
  invalid_variant: "no longer sells this option",
  max_price_exceeded: "costs more than the approved cap",
};

function key() {
  const value = process.env.ZINC_API_KEY;
  if (!value) throw new ZincRequestError("ZINC_API_KEY is not set", 500);
  return value;
}

export function toLaneUpdate(order: LaneOrder, zinc: ZincOrder): LaneUpdate {
  const prices = zinc.job_result?.price_components;
  const tracking = (zinc.tracking_numbers ?? []).flatMap((entry) =>
    entry.tracking_number ? [{ carrier: entry.carrier ?? "Carrier", number: entry.tracking_number, url: entry.zinc_tracking_url ?? null }] : [],
  );
  switch (zinc.status) {
    case "pending":
    case "in_progress":
      return { status: "placing" };
    case "order_placed":
      return { status: "placed", finalTotalCents: prices?.total ?? null, tracking, error: null };
    case "cancelled":
    case "cancelled_by_retailer":
      return { status: "canceled", error: `${order.order.store} canceled the order` };
    case "order_failed": {
      const type = zinc.job_result?.error_type ?? "unknown";
      if (type === "max_price_exceeded") {
        return { status: "needs_approval", quotedCents: prices?.total ?? null, error: `${order.order.store} ${READABLE[type]}` };
      }
      return { status: "failed", error: `${order.order.store} ${READABLE[type] ?? `failed (${type})`}` };
    }
  }
}

function simItems(order: LaneOrder) {
  return order.items.map((item) => ({ url: item.product.url, quantity: item.quantity, priceCents: item.product.priceCents }));
}

export const zincLane: CheckoutLane = {
  async quote(order) {
    // Zinc has no quote call: the cap is sent as max_price, and an over-cap total comes back as max_price_exceeded.
    return { quotedCents: order.items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0), externalId: null };
  },

  async place(order) {
    const mode = checkoutZincMode();
    const blocker = zincBlocker(order, mode !== "off");
    if (blocker) return { status: "failed", error: blocker };
    const request = buildZincOrder(order);
    try {
      const created = mode === "off" ? createSimOrder(request, order.now) : await createZincOrder(key(), request);
      return { ...toLaneUpdate(order, created), externalId: created.id };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "Zinc order failed" };
    }
  },

  async status(order) {
    const id = order.order.externalId;
    if (!id) return { status: "failed", error: "Zinc order id is missing" };
    try {
      const zinc = id.startsWith("zsim_") ? simOrderStatus(id, simItems(order), order.order.capCents, order.now) : await getZincOrder(key(), id);
      return toLaneUpdate(order, zinc);
    } catch (error) {
      // A slow poll isn't a failed order; try again on the next read.
      console.warn(`Zinc status check failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return { status: order.order.status };
    }
  },
};
