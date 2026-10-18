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

export interface MemberShare {
  memberId: string;
  totalCents: number;
  lines: { slotId: string; cents: number }[];
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

export interface Refund {
  id: string;
  groupId: string;
  productId: string;
  memberId: string;
  amountCents: number;
  createdAt: string;
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
  fundedCents: number;
  totalCents: number;
}
