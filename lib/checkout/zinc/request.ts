import { createHash } from "node:crypto";
import { registryEntry } from "@/lib/checkout/registry";
import type { LaneOrder } from "@/lib/checkout/lane";
import type { ZincOrderRequest } from "@/lib/checkout/zinc/types";

/** A UUID derived from the store order and attempt, so a retried POST is the same order to Zinc. */
export function idempotencyKey(storeOrderId: string, attempt: number) {
  const hex = createHash("sha256").update(`zinc:${storeOrderId}:${attempt}`).digest("hex");
  const variant = ((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Why this order can't go to Zinc, or null when it can.
 * Every item must be from the order's store. In sandbox and live modes each URL must also be on the
 * retailer's own domain, because Zinc can't buy a google.com link; the simulator skips that check.
 */
export function zincBlocker(order: LaneOrder, checkUrls: boolean): string | null {
  if (order.items.length === 0) return `Nothing to buy at ${order.order.store}`;
  const stray = order.items.find((item) => item.product.store !== order.order.store);
  if (stray) return `${stray.product.title} is from ${stray.product.store}, not ${order.order.store}`;
  if (!checkUrls) return null;
  const domain = registryEntry(order.order.store)?.baseUrl?.replace(/^https?:\/\//, "");
  for (const item of order.items) {
    let host = "";
    try {
      host = new URL(item.product.url).hostname.replace(/^www\./, "");
    } catch {
      return `${item.product.title} has no store link`;
    }
    if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) return `${item.product.title} doesn't link to ${order.order.store}`;
  }
  return null;
}

/** The POST /orders body. Pure. `max_price` is the store order's cap; Zinc never charges past it. */
export function buildZincOrder(order: LaneOrder): ZincOrderRequest {
  const address = order.address;
  return {
    products: order.items.map((item) => ({ url: item.product.url, quantity: item.quantity })),
    shipping_address: {
      first_name: address.firstName,
      last_name: address.lastName,
      address_line1: address.line1,
      ...(address.line2 ? { address_line2: address.line2 } : {}),
      city: address.city,
      state: address.state,
      postal_code: address.postalCode,
      phone_number: address.phone,
      country: "US",
    },
    max_price: order.order.capCents,
    idempotency_key: idempotencyKey(order.order.id, order.order.attempt),
    metadata: { groupId: order.order.groupId, storeOrderId: order.order.id },
  };
}
