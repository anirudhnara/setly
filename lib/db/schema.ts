import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { GroupStatus, MemberShare, PayType, QuantityRule, RuleStatus, RuleType } from "@/lib/types";

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  budgetCents: integer("budget_cents").notNull(),
  status: text("status").$type<GroupStatus>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  sharesJson: jsonb("shares_json").$type<MemberShare[]>().notNull().default(sql`'[]'::jsonb`),
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
  productId: text("product_id").notNull().references(() => products.id),
  memberId: text("member_id").notNull().references(() => members.id),
  amountCents: integer("amount_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Observed prices. The Timescale hypertable conversion lives in db/sql/price_points_hypertable.sql. */
export const pricePoints = pgTable(
  "price_points",
  {
    productId: text("product_id").notNull().references(() => products.id),
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
