/** Shared domain contract for the map, group, money, and API layers. */

export type GroupStatus = "editing" | "funding" | "active" | "purchased" | "settled";
export type QuantityRule = "per_group" | "per_person" | "fixed";
export type PayType = "shared" | "per_person" | "already_owned";
export type RuleType = "budget" | "quantity" | "compatibility" | "size" | "timing" | "required_or_banned";
export type RuleStatus = "ok" | "warning" | "broken" | "not_checked";
export type ContributionStatus = "pending" | "paid" | "failed" | "refunded";
export type CardStatus = "pending" | "active" | "suspended" | "closed";

export interface Group {
  id: string;
  name: string;
  prompt: string;
  budgetCents: number;
  status: GroupStatus;
  createdAt: string;
  organizerMemberId: string;
}

export interface Member {
  id: string;
  groupId: string;
  name: string;
  isOrganizer: boolean;
  joinedAt: string;
}

export interface Zone {
  id: string;
  groupId: string;
  name: string;
  sortOrder: number;
  slots: Slot[];
}

export interface Slot {
  id: string;
  zoneId: string;
  need: string;
  quantityRule: QuantityRule;
  quantity: number;
  budgetCents: number | null;
  payType: PayType;
  ownerMemberId: string | null;
  chosenProductId: string | null;
  updatedBy: string | null;
  updatedAt: string;
  products: Product[];
}

export interface Product {
  id: string;
  slotId: string;
  title: string;
  store: string;
  priceCents: number;
  url: string;
  imageUrl: string | null;
  attributes: Record<string, string | number | boolean | null>;
}

export interface SlotLink {
  id: string;
  fromSlotId: string;
  toSlotId: string;
  label: string;
}

export interface Rule {
  id: string;
  groupId: string;
  type: RuleType;
  slotIds: string[];
  params: Record<string, unknown>;
  status: RuleStatus;
  message: string;
}

export interface Contribution {
  id: string;
  groupId: string;
  memberId: string;
  amountCents: number;
  paymentIntentId: string | null;
  status: ContributionStatus;
}

export interface StoreLimit {
  store: string;
  limitCents: number;
  spentCents: number;
}

export interface PlanCard {
  id: string;
  groupId: string;
  stripeCardId: string | null;
  last4: string | null;
  limitCents: number;
  status: CardStatus;
  storeLimits: StoreLimit[];
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

export interface Refund {
  id: string;
  groupId: string;
  productId: string;
  memberId: string;
  amountCents: number;
  stripeRefundId: string | null;
  status: "pending" | "succeeded" | "failed";
  createdAt: string;
}

export interface GroupState {
  group: Group;
  members: Member[];
  zones: Zone[];
  links: SlotLink[];
  rules: Rule[];
  contributions: Contribution[];
  card: PlanCard | null;
  authorizations: Authorization[];
  refunds: Refund[];
}

/** Input/output contract shared by map generation providers and API routes. */
export interface GeneratedMap {
  zones: Array<{ id: string; name: string; sortOrder: number; slots: GeneratedSlot[] }>;
  links: SlotLink[];
  rules: Rule[];
}

export interface GeneratedSlot {
  id: string;
  need: string;
  quantityRule: QuantityRule;
  quantity: number;
  budgetCents: number | null;
  payType: PayType;
  products: Product[];
  chosenProductId: string | null;
}
