import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  authorizations,
  cards,
  contributions,
  groups,
  links,
  members,
  pricePoints,
  products,
  refunds,
  rules,
  slots,
  storeLimits,
  zones,
} from "@/lib/db/schema";
import type { LedgerStore } from "@/lib/db/store";
import type {
  Authorization,
  Card,
  Contribution,
  Group,
  GroupStatus,
  Link,
  MapData,
  Member,
  MemberShare,
  PayType,
  Product,
  QuantityRule,
  Refund,
  Rule,
  RuleStatus,
  RuleType,
  Slot,
  StoreLimit,
  Zone,
  GroupState,
} from "@/lib/types";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const drizzleLedger: LedgerStore = {
  get: (groupId) => readGroup(groupId),
  async put(state) {
    const db = getDb();
    await db.transaction(async (tx) => {
      await writeGroup(tx, state);
    });
  },
  async findByCardId(cardId) {
    const db = getDb();
    const [card] = await db.select({ groupId: cards.groupId }).from(cards).where(eq(cards.id, cardId)).limit(1);
    return card ? readGroup(card.groupId) : null;
  },
  async findByPaymentIntentId(paymentIntentId) {
    const db = getDb();
    const [row] = await db
      .select({ groupId: contributions.groupId })
      .from(contributions)
      .where(eq(contributions.stripePaymentIntentId, paymentIntentId))
      .limit(1);
    return row ? readGroup(row.groupId) : null;
  },
  async findBySlotId(slotId) {
    const db = getDb();
    const [slot] = await db.select({ zoneId: slots.zoneId }).from(slots).where(eq(slots.id, slotId)).limit(1);
    if (!slot) return null;
    const [zone] = await db.select({ groupId: zones.groupId }).from(zones).where(eq(zones.id, slot.zoneId)).limit(1);
    return zone ? readGroup(zone.groupId) : null;
  },
  async findByZoneId(zoneId) {
    const db = getDb();
    const [zone] = await db.select({ groupId: zones.groupId }).from(zones).where(eq(zones.id, zoneId)).limit(1);
    return zone ? readGroup(zone.groupId) : null;
  },
  async findByProductId(productId) {
    const db = getDb();
    const [product] = await db.select({ slotId: products.slotId }).from(products).where(eq(products.id, productId)).limit(1);
    if (!product) return null;
    return drizzleLedger.findBySlotId(product.slotId);
  },
};

async function readGroup(groupId: string): Promise<GroupState | null> {
  const db = getDb();
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return null;
  const memberRows = await db.select().from(members).where(eq(members.groupId, groupId));
  const zoneRows = await db.select().from(zones).where(eq(zones.groupId, groupId));
  const zoneIds = zoneRows.map((zone) => zone.id);
  const slotRows = zoneIds.length === 0 ? [] : await db.select().from(slots).where(inArray(slots.zoneId, zoneIds));
  const slotIds = slotRows.map((slot) => slot.id);
  const productRows = slotIds.length === 0 ? [] : await db.select().from(products).where(inArray(products.slotId, slotIds));
  const linkRows = slotIds.length === 0 ? [] : await db.select().from(links).where(inArray(links.fromSlotId, slotIds));
  const ruleRows = await db.select().from(rules).where(eq(rules.groupId, groupId));
  const contributionRows = await db.select().from(contributions).where(eq(contributions.groupId, groupId));
  const cardRows = await db.select().from(cards).where(eq(cards.groupId, groupId));
  const card = cardRows[0] ?? null;
  const limitRows = card ? await db.select().from(storeLimits).where(eq(storeLimits.cardId, card.id)) : [];
  const authorizationRows = card ? await db.select().from(authorizations).where(eq(authorizations.cardId, card.id)) : [];
  const refundRows = await db.select().from(refunds).where(eq(refunds.groupId, groupId));
  const map: MapData = {
    zones: zoneRows.map(toZone).sort((left, right) => left.sortOrder - right.sortOrder),
    slots: slotRows.map(toSlot),
    products: productRows.map(toProduct),
    links: linkRows.map(toLink),
    rules: ruleRows.map(toRule),
  };
  const state: GroupState = {
    group: toGroup(group),
    members: memberRows.map(toMember).sort((left, right) => left.joinedAt.localeCompare(right.joinedAt)),
    map,
    shares: asShares(group.sharesJson),
    contributions: contributionRows.map(toContribution),
    card: card ? toCard(card) : null,
    storeLimits: limitRows.map(toStoreLimit),
    authorizations: authorizationRows.map(toAuthorization),
    refunds: refundRows.map(toRefund),
    fundedCents: 0,
    totalCents: 0,
  };
  return state;
}

async function writeGroup(tx: Transaction, state: GroupState) {
  const groupId = state.group.id;
  await tx
    .insert(groups)
    .values({
      id: state.group.id,
      name: state.group.name,
      prompt: state.group.prompt,
      budgetCents: state.group.budgetCents,
      status: state.group.status,
      createdAt: new Date(state.group.createdAt),
      sharesJson: state.shares,
    })
    .onConflictDoUpdate({
      target: groups.id,
      set: {
        name: state.group.name,
        prompt: state.group.prompt,
        budgetCents: state.group.budgetCents,
        status: state.group.status,
        sharesJson: state.shares,
      },
    });

  const existingZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.groupId, groupId));
  const zoneIds = existingZones.map((zone) => zone.id);
  const existingSlots = zoneIds.length === 0 ? [] : await tx.select({ id: slots.id }).from(slots).where(inArray(slots.zoneId, zoneIds));
  const slotIds = existingSlots.map((slot) => slot.id);
  const existingProducts = slotIds.length === 0 ? [] : await tx.select({ id: products.id }).from(products).where(inArray(products.slotId, slotIds));
  const productIds = existingProducts.map((product) => product.id);
  const existingCards = await tx.select({ id: cards.id }).from(cards).where(eq(cards.groupId, groupId));
  const cardIds = existingCards.map((card) => card.id);

  if (productIds.length > 0) await tx.delete(pricePoints).where(inArray(pricePoints.productId, productIds));
  if (cardIds.length > 0) {
    await tx.delete(authorizations).where(inArray(authorizations.cardId, cardIds));
    await tx.delete(storeLimits).where(inArray(storeLimits.cardId, cardIds));
  }
  await tx.delete(refunds).where(eq(refunds.groupId, groupId));
  await tx.delete(cards).where(eq(cards.groupId, groupId));
  await tx.delete(contributions).where(eq(contributions.groupId, groupId));
  if (slotIds.length > 0) {
    await tx.delete(links).where(inArray(links.fromSlotId, slotIds));
    await tx.delete(links).where(inArray(links.toSlotId, slotIds));
    await tx.delete(products).where(inArray(products.slotId, slotIds));
    await tx.delete(slots).where(inArray(slots.id, slotIds));
  }
  await tx.delete(rules).where(eq(rules.groupId, groupId));
  if (zoneIds.length > 0) await tx.delete(zones).where(inArray(zones.id, zoneIds));
  await tx.delete(members).where(eq(members.groupId, groupId));

  if (state.members.length > 0) {
    await tx.insert(members).values(
      state.members.map((member) => ({
        id: member.id,
        groupId: member.groupId,
        name: member.name,
        isOrganizer: member.isOrganizer,
        joinedAt: new Date(member.joinedAt),
      })),
    );
  }
  if (state.map.zones.length > 0) {
    await tx.insert(zones).values(
      state.map.zones.map((zone) => ({
        id: zone.id,
        groupId: zone.groupId,
        name: zone.name,
        sortOrder: zone.sortOrder,
      })),
    );
  }
  if (state.map.slots.length > 0) {
    await tx.insert(slots).values(
      state.map.slots.map((slot) => ({
        id: slot.id,
        zoneId: slot.zoneId,
        need: slot.need,
        quantityRule: slot.quantityRule,
        quantity: slot.quantity,
        budgetCents: slot.budgetCents,
        payType: slot.payType,
        ownerMemberId: slot.ownerMemberId,
        chosenProductId: slot.chosenProductId,
        updatedBy: slot.updatedBy,
        updatedAt: new Date(slot.updatedAt),
      })),
    );
  }
  if (state.map.products.length > 0) {
    await tx.insert(products).values(
      state.map.products.map((product) => ({
        id: product.id,
        slotId: product.slotId,
        title: product.title,
        store: product.store,
        priceCents: product.priceCents,
        url: product.url,
        imageUrl: product.imageUrl,
        attributes: product.attributes,
      })),
    );
  }
  if (state.map.links.length > 0) {
    await tx.insert(links).values(state.map.links);
  }
  if (state.map.rules.length > 0) {
    await tx.insert(rules).values(
      state.map.rules.map((rule) => ({
        id: rule.id,
        groupId: rule.groupId,
        type: rule.type,
        slotIds: rule.slotIds,
        params: rule.params,
        status: rule.status,
        message: rule.message,
      })),
    );
  }
  if (state.contributions.length > 0) {
    await tx.insert(contributions).values(state.contributions);
  }
  if (state.card) {
    await tx.insert(cards).values(state.card);
  }
  if (state.storeLimits.length > 0) {
    await tx.insert(storeLimits).values(state.storeLimits);
  }
  if (state.authorizations.length > 0) {
    await tx.insert(authorizations).values(
      state.authorizations.map((authorization) => ({
        ...authorization,
        createdAt: new Date(authorization.createdAt),
      })),
    );
  }
  if (state.refunds.length > 0) {
    await tx.insert(refunds).values(
      state.refunds.map((refund) => ({
        ...refund,
        createdAt: new Date(refund.createdAt),
      })),
    );
  }
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toGroup(row: typeof groups.$inferSelect): Group {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    budgetCents: row.budgetCents,
    status: asGroupStatus(row.status),
    createdAt: iso(row.createdAt),
  };
}

function toMember(row: typeof members.$inferSelect): Member {
  return { id: row.id, groupId: row.groupId, name: row.name, isOrganizer: row.isOrganizer, joinedAt: iso(row.joinedAt) };
}

function toZone(row: typeof zones.$inferSelect): Zone {
  return { id: row.id, groupId: row.groupId, name: row.name, sortOrder: row.sortOrder };
}

function toSlot(row: typeof slots.$inferSelect): Slot {
  return {
    id: row.id,
    zoneId: row.zoneId,
    need: row.need,
    quantityRule: asQuantityRule(row.quantityRule),
    quantity: row.quantity,
    budgetCents: row.budgetCents,
    payType: asPayType(row.payType),
    ownerMemberId: row.ownerMemberId,
    chosenProductId: row.chosenProductId,
    updatedBy: row.updatedBy,
    updatedAt: iso(row.updatedAt),
  };
}

function toProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    slotId: row.slotId,
    title: row.title,
    store: row.store,
    priceCents: row.priceCents,
    url: row.url,
    imageUrl: row.imageUrl,
    attributes: asAttributes(row.attributes),
  };
}

function toLink(row: typeof links.$inferSelect): Link {
  return { id: row.id, fromSlotId: row.fromSlotId, toSlotId: row.toSlotId, label: row.label };
}

function toRule(row: typeof rules.$inferSelect): Rule {
  return {
    id: row.id,
    groupId: row.groupId,
    type: asRuleType(row.type),
    slotIds: asStrings(row.slotIds),
    params: asRecord(row.params),
    status: asRuleStatus(row.status),
    message: row.message,
  };
}

function toContribution(row: typeof contributions.$inferSelect): Contribution {
  return {
    id: row.id,
    groupId: row.groupId,
    memberId: row.memberId,
    amountCents: row.amountCents,
    stripePaymentIntentId: row.stripePaymentIntentId,
    status: asContributionStatus(row.status),
  };
}

function toCard(row: typeof cards.$inferSelect): Card {
  return { id: row.id, groupId: row.groupId, last4: row.last4, limitCents: row.limitCents, status: asCardStatus(row.status) };
}

function toStoreLimit(row: typeof storeLimits.$inferSelect): StoreLimit {
  return { cardId: row.cardId, store: row.store, limitCents: row.limitCents, spentCents: row.spentCents };
}

function toAuthorization(row: typeof authorizations.$inferSelect): Authorization {
  return {
    id: row.id,
    cardId: row.cardId,
    merchant: row.merchant,
    amountCents: row.amountCents,
    approved: row.approved,
    reason: row.reason,
    createdAt: iso(row.createdAt),
  };
}

function toRefund(row: typeof refunds.$inferSelect): Refund {
  return { id: row.id, groupId: row.groupId, productId: row.productId, memberId: row.memberId, amountCents: row.amountCents, createdAt: iso(row.createdAt) };
}

function asGroupStatus(value: string): GroupStatus {
  if (value === "editing" || value === "funding" || value === "active" || value === "purchased" || value === "settled") return value;
  return "editing";
}

function asQuantityRule(value: string): QuantityRule {
  if (value === "per_group" || value === "per_person" || value === "fixed") return value;
  return "per_group";
}

function asPayType(value: string): PayType {
  if (value === "shared" || value === "per_person" || value === "already_owned") return value;
  return "shared";
}

function asRuleType(value: string): RuleType {
  if (value === "budget" || value === "quantity" || value === "compatibility" || value === "size" || value === "timing" || value === "required_or_banned") return value;
  return "budget";
}

function asRuleStatus(value: string): RuleStatus {
  if (value === "ok" || value === "warning" || value === "broken" || value === "not_checked") return value;
  return "not_checked";
}

function asContributionStatus(value: string): Contribution["status"] {
  if (value === "pending" || value === "paid" || value === "refunded_partial") return value;
  return "pending";
}

function asCardStatus(value: string): Card["status"] {
  if (value === "inactive" || value === "active" || value === "closed") return value;
  return "inactive";
}

function asAttributes(value: unknown): Record<string, string | number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asShares(value: unknown): MemberShare[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.memberId !== "string" || typeof record.totalCents !== "number" || !Array.isArray(record.lines)) return [];
    const lines = record.lines.flatMap((line) => {
      if (!line || typeof line !== "object") return [];
      const entry = line as Record<string, unknown>;
      if (typeof entry.slotId !== "string" || typeof entry.cents !== "number") return [];
      return [{ slotId: entry.slotId, cents: entry.cents }];
    });
    return [{ memberId: record.memberId, totalCents: record.totalCents, lines }];
  });
}
