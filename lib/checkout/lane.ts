import type { Authorization, MapData, Member, Product, ShippingAddress, StoreOrder, StoreOrderStatus, TrackingInfo } from "@/lib/types";

/**
 * A checkout lane buys one store's part of the plan. Lanes run outside the ledger lock: the orchestrator
 * reads the group, calls the lane, then writes the result in a short mutation.
 */
export interface LaneItem {
  product: Product;
  quantity: number;
}

export interface LaneOrder {
  order: StoreOrder;
  items: LaneItem[];
  address: ShippingAddress;
  /** The group card, for lanes that pay with it (protocol, guided). */
  cardId: string | null;
  /** The group's card authorizations so far; the guided lane watches these. */
  authorizations: Authorization[];
  now: Date;
}

export interface LaneQuote {
  quotedCents: number;
  externalId: string | null;
}

export interface LaneUpdate {
  status: StoreOrderStatus;
  externalId?: string | null;
  quotedCents?: number | null;
  finalTotalCents?: number | null;
  error?: string | null;
  tracking?: TrackingInfo[];
}

export interface CheckoutLane {
  /** What the store will charge, including tax and shipping. */
  quote(order: LaneOrder): Promise<LaneQuote>;
  /** Places the order within `order.capCents`. */
  place(order: LaneOrder): Promise<LaneUpdate>;
  /** Re-reads a placing order. */
  status(order: LaneOrder): Promise<LaneUpdate>;
}

/** What the plan buys at one store: each chosen product and how many. Per-person slots buy one per member. */
export function storeItems(map: MapData, members: Member[], store: string): LaneItem[] {
  return map.slots.flatMap((slot) => {
    if (slot.payType === "already_owned" || !slot.chosenProductId) return [];
    const product = map.products.find((item) => item.id === slot.chosenProductId);
    if (!product || product.store !== store) return [];
    const quantity = slot.quantity * (slot.payType === "per_person" ? members.length : 1);
    return quantity > 0 ? [{ product, quantity }] : [];
  });
}
