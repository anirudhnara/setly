import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { CheckoutLaneName, GroupStatus, MemberShare, PayType, QuantityRule, RefundReason, RuleStatus, RuleType, ShippingAddress, StoreOrderStatus, TrackingInfo } from "@/lib/types";
import type { ColorProfile } from "@/lib/search/color";

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  budgetCents: integer("budget_cents").notNull(),
  status: text("status").$type<GroupStatus>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  sharesJson: jsonb("shares_json").$type<MemberShare[]>().notNull().default(sql`'[]'::jsonb`),
  addressJson: jsonb("address_json").$type<ShippingAddress>(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    firebaseUid: text("firebase_uid").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("users_firebase_uid").on(table.firebaseUid)],
);

export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull().references(() => groups.id),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    isOrganizer: boolean("is_organizer").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("members_group_user").on(table.groupId, table.userId)],
);

export const zones = pgTable("zones", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const slots = pgTable("slots", {
  id: text("id").primaryKey(),
  zoneId: text("zone_id").notNull().references(() => zones.id),
  need: text("need").notNull(),
  quantityRule: text("quantity_rule").$type<QuantityRule>().notNull(),
  quantity: integer("quantity").notNull(),
  budgetCents: integer("budget_cents").notNull(),
  payType: text("pay_type").$type<PayType>().notNull(),
  ownerMemberId: text("owner_member_id").references(() => members.id),
  chosenProductId: text("chosen_product_id"),
  updatedBy: text("updated_by").references(() => members.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  slotId: text("slot_id").notNull().references(() => slots.id),
  title: text("title").notNull(),
  store: text("store").notNull(),
  priceCents: integer("price_cents").notNull(),
  url: text("url").notNull(),
  imageUrl: text("image_url").notNull(),
  attributes: jsonb("attributes").$type<Record<string, string | number>>().notNull(),
});

export const links = pgTable("links", {
  id: text("id").primaryKey(),
  fromSlotId: text("from_slot_id").notNull().references(() => slots.id),
  toSlotId: text("to_slot_id").notNull().references(() => slots.id),
  label: text("label").notNull(),
});

export const rules = pgTable("rules", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  type: text("type").$type<RuleType>().notNull(),
  slotIds: jsonb("slot_ids").$type<string[]>().notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<RuleStatus>().notNull(),
  message: text("message").notNull(),
});

export const contributions = pgTable("contributions", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  memberId: text("member_id").notNull().references(() => members.id),
  amountCents: integer("amount_cents").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: text("status").$type<"pending" | "paid" | "refunded_partial">().notNull(),
});

export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  last4: text("last4").notNull(),
  limitCents: integer("limit_cents").notNull(),
  status: text("status").$type<"inactive" | "active" | "closed">().notNull(),
});

export const storeLimits = pgTable(
  "store_limits",
  {
    cardId: text("card_id").notNull().references(() => cards.id),
    store: text("store").notNull(),
    limitCents: integer("limit_cents").notNull(),
    spentCents: integer("spent_cents").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.store] })],
);

export const authorizations = pgTable("authorizations", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id),
  merchant: text("merchant").notNull(),
  amountCents: integer("amount_cents").notNull(),
  approved: boolean("approved").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const refunds = pgTable("refunds", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  productId: text("product_id").references(() => products.id),
  storeOrderId: text("store_order_id"),
  memberId: text("member_id").notNull().references(() => members.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").$type<RefundReason>().notNull().default("return"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** One store's part of checkout. See StoreOrder in lib/types.ts. */
export const storeOrders = pgTable("store_orders", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  store: text("store").notNull(),
  lane: text("lane").$type<CheckoutLaneName>().notNull(),
  status: text("status").$type<StoreOrderStatus>().notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  capCents: integer("cap_cents").notNull(),
  quotedCents: integer("quoted_cents"),
  externalId: text("external_id"),
  attempt: integer("attempt").notNull().default(0),
  error: text("error"),
  tracking: jsonb("tracking").$type<TrackingInfo[]>().notNull().default(sql`'[]'::jsonb`),
  finalTotalCents: integer("final_total_cents"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Observed prices. The Timescale hypertable conversion lives in db/sql/price_points_hypertable.sql. */
export const pricePoints = pgTable(
  "price_points",
  {
    productId: text("product_id").notNull(),
    priceCents: integer("price_cents").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.observedAt] })],
);

export const searchCache = pgTable("search_cache", {
  query: text("query").primaryKey(),
  resultsJson: jsonb("results_json").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

/**
 * Standing product catalog for dorm and apartment sets, so maps can be built without spending SerpApi quota.
 * Built from search results (scripts/seed-catalog.ts) plus secondhand listings people add themselves.
 * Near-duplicates are kept on purpose and share a `variant_group`, so a set can swap within a group.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    store: text("store").notNull(),
    priceCents: integer("price_cents").notNull(),
    url: text("url").notNull(),
    imageUrl: text("image_url").notNull(),
    condition: text("condition").$type<"new" | "used">().notNull(),
    source: text("source").$type<"search" | "bestbuy" | "ebay" | "facebook_marketplace" | "craigslist" | "manual" | "other">().notNull(),
    rating: real("rating"),
    reviewCount: integer("review_count"),
    /** Rating weighted by review count. Higher is better; used to rank within a category. */
    qualityScore: real("quality_score").notNull(),
    delivery: text("delivery"),
    shippingDaysMax: integer("shipping_days_max"),
    variantGroup: text("variant_group").notNull(),
    /** "anchor" items set a look (themed or colorful); "neutral" items fit into many sets. */
    role: text("role").$type<"anchor" | "neutral">().notNull(),
    /** Keyword tags from the title; `color` and `styles` are added by Gemini (scripts/tag-catalog.ts). */
    tags: jsonb("tags").$type<{ colors: string[]; themes: string[]; sizes: string[]; color?: ColorProfile; styles?: string[] }>().notNull(),
    /** 1 to 5 each, plus popularity from 0 to 1. */
    scores: jsonb("scores").$type<{ usability: number; practicality: number; health: number; popularity: number }>().notNull(),
    attributes: jsonb("attributes").$type<Record<string, string | number>>().notNull(),
    searchQuery: text("search_query"),
    addedBy: text("added_by"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("catalog_items_category_idx").on(table.category, table.qualityScore),
    index("catalog_items_variant_group_idx").on(table.variantGroup),
  ],
);
