/** Shared domain contract. All money is integer cents. All ids are strings. */

export type GroupStatus = "editing" | "funding" | "active" | "purchased" | "settled";

export interface Group {
  id: string;
  name: string;
  prompt: string;
  budgetCents: number;
  status: GroupStatus;
  createdAt: string;
}

export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Member {
  id: string;
  groupId: string;
  userId: string;
  name: string;
  isOrganizer: boolean;
  joinedAt: string;
}

export interface Zone {
  id: string;
  groupId: string;
  name: string;
  sortOrder: number;
}

export type QuantityRule = "per_group" | "per_person" | "fixed";
export type PayType = "shared" | "per_person" | "already_owned";

export interface Slot {
  id: string;
  zoneId: string;
  need: string;
  quantityRule: QuantityRule;
  quantity: number;
  budgetCents: number;
  payType: PayType;
  ownerMemberId: string | null;
  chosenProductId: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface Product {
  id: string;
  slotId: string;
  title: string;
  store: string;
  priceCents: number;
  url: string;
  imageUrl: string;
  attributes: Record<string, string | number>;
}

export interface Link {
  id: string;
  fromSlotId: string;
  toSlotId: string;
  label: string;
}

export type RuleType = "budget" | "quantity" | "compatibility" | "size" | "timing" | "required_or_banned";
export type RuleStatus = "ok" | "warning" | "broken" | "not_checked";

export interface Rule {
  id: string;
  groupId: string;
  type: RuleType;
  slotIds: string[];
  params: Record<string, unknown>;
  status: RuleStatus;
  message: string;
}

/** `item` lines pay for a slot. `buffer` and `zinc_fee` lines belong to a store, not a slot, so their `slotId` is null. */
export type ShareLineKind = "item" | "buffer" | "zinc_fee";

export interface ShareLine {
  kind: ShareLineKind;
  slotId: string | null;
  store: string | null;
  cents: number;
}

export interface MemberShare {
  memberId: string;
  totalCents: number;
  lines: ShareLine[];
}

export interface Contribution {
  id: string;
  groupId: string;
  memberId: string;
  amountCents: number;
  stripePaymentIntentId: string | null;
  status: "pending" | "paid" | "refunded_partial";
}

export interface Card {
  id: string;
  groupId: string;
  last4: string;
  limitCents: number;
  status: "inactive" | "active" | "closed";
}

export interface StoreLimit {
  cardId: string;
  store: string;
  limitCents: number;
  spentCents: number;
}

export interface Authorization {
  id: string;
  cardId: string;
  merchant: string;
  amountCents: number;
  approved: boolean;
  reason: string;
  createdAt: string;
}

export type RefundReason = "return" | "leftover_buffer" | "zinc_held" | "store_failed";

export interface Refund {
  id: string;
  groupId: string;
  /** Set for returns. Null for refunds of a store's unused buffer or a failed store order. */
  productId: string | null;
  /** Set for checkout refunds, so each one has a stable idempotency key. */
  storeOrderId: string | null;
  memberId: string;
  amountCents: number;
  reason: RefundReason;
  createdAt: string;
}

export type CheckoutLaneName = "protocol" | "zinc" | "guided";

export type StoreOrderStatus = "pending" | "quoting" | "needs_approval" | "placing" | "placed" | "failed" | "canceled";

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
}

export interface TrackingInfo {
  carrier: string;
  number: string;
  url: string | null;
}

/** One store's part of checkout. `capCents` = subtotal + buffer; the store may never charge more without approval. */
export interface StoreOrder {
  id: string;
  groupId: string;
  store: string;
  lane: CheckoutLaneName;
  status: StoreOrderStatus;
  subtotalCents: number;
  capCents: number;
  quotedCents: number | null;
  /** The lane's id for this order: a protocol session id, a Zinc order id, or the store URL for guided. */
  externalId: string | null;
  /** Bumped on every retry, so each attempt gets its own idempotency key. */
  attempt: number;
  error: string | null;
  tracking: TrackingInfo[];
  finalTotalCents: number | null;
  updatedAt: string;
}

export interface StoreRegistryEntry {
  name: string;
  lane: CheckoutLaneName;
  baseUrl?: string;
}

export interface MapData {
  zones: Zone[];
  slots: Slot[];
  products: Product[];
  links: Link[];
  rules: Rule[];
}

export interface GroupState {
  group: Group;
  members: Member[];
  map: MapData;
  shares: MemberShare[];
  contributions: Contribution[];
  card: Card | null;
  storeLimits: StoreLimit[];
  authorizations: Authorization[];
  refunds: Refund[];
  storeOrders: StoreOrder[];
  address: ShippingAddress | null;
  fundedCents: number;
  totalCents: number;
}
