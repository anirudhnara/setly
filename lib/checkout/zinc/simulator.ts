import { shortHash } from "@/lib/search/normalize";
import { ZincRequestError, type ZincOrder, type ZincOrderRequest } from "@/lib/checkout/zinc/types";

/**
 * A stateless stand-in for Zinc (CHECKOUT_ZINC=off). The order id carries its creation time, and status is
 * derived from elapsed time and the order itself, so any server instance answers the same and no fetch runs:
 * 0–2s pending, 2–6s in_progress, ≥6s placed (or failed), ≥9s tracking. Tax is 8.5%; a total over
 * max_price fails with max_price_exceeded, like Zinc. The sandbox test product slugs behave as documented.
 */
export const SIM_TAX_BASIS_POINTS = 850;

export interface SimItem {
  url: string;
  quantity: number;
  priceCents: number;
}

const slugOf = (items: { url: string }[]) => items.map((item) => item.url.match(/\/shop\/products\/(test-[a-z-]+)/)?.[1]).find(Boolean) ?? null;

const ASYNC_FAILURES: Record<string, string> = {
  "test-out-of-stock": "out_of_stock",
  "test-shipping-unavailable": "shipping_unavailable",
  "test-invalid-variant": "invalid_variant",
};

export function createSimOrder(request: ZincOrderRequest, now: Date): ZincOrder {
  const slug = slugOf(request.products);
  if (slug === "test-invalid-address") throw new ZincRequestError("The shipping address is invalid", 400);
  if (slug === "test-insufficient-funds") throw new ZincRequestError("The Zinc wallet has insufficient funds", 402);
  return { id: `zsim_${now.getTime()}_${shortHash(request.idempotency_key)}`, status: "pending", job_result: null, tracking_numbers: [], merchant_order_ids: [] };
}

export function simOrderStatus(id: string, items: SimItem[], maxPrice: number, now: Date): ZincOrder {
  const createdAt = Number(id.split("_")[1]);
  const elapsed = Number.isFinite(createdAt) ? now.getTime() - createdAt : 0;
  const base = { id, job_result: null, tracking_numbers: [], merchant_order_ids: [] };
  if (elapsed < 2_000) return { ...base, status: "pending" };
  if (elapsed < 6_000) return { ...base, status: "in_progress" };
  const slug = slugOf(items);
  const subtotal = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const tax = Math.round((subtotal * SIM_TAX_BASIS_POINTS) / 10_000);
  const total = subtotal + tax;
  const price_components = { subtotal, tax, shipping: 0, total };
  const failure = slug ? ASYNC_FAILURES[slug] : undefined;
  if (failure) return { ...base, status: "order_failed", job_result: { price_components: null, error_type: failure } };
  if (slug === "test-price-exceeded" || total > maxPrice) {
    const over = total > maxPrice ? price_components : { ...price_components, shipping: maxPrice + 500 - total, total: maxPrice + 500 };
    return { ...base, status: "order_failed", job_result: { price_components: over, error_type: "max_price_exceeded" } };
  }
  const tracking =
    elapsed >= 9_000
      ? [{ carrier: "UPS", tracking_number: `1ZSIM${shortHash(id).toUpperCase()}`, status: "in_transit", zinc_tracking_url: null }]
      : [];
  return { ...base, status: "order_placed", job_result: { price_components }, tracking_numbers: tracking, merchant_order_ids: [`sim-${shortHash(id)}`] };
}
