import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  authorizations,
  cards,
  contributions,
  groups,
  links,
  members,
  users,
  products,
  refunds,
  rules,
  slots,
  storeLimits,
  storeOrders,
  zones,
} from "@/lib/db/schema";
import type { GroupDraft, LedgerStore } from "@/lib/db/store";
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
  ShareLine,
  ShippingAddress,
  Slot,
  StoreLimit,
  StoreOrder,
  StoreOrderStatus,
  CheckoutLaneName,
  RefundReason,
  TrackingInfo,
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
  async mutate(groupId, fn) {
    const db = getDb();
    return db.transaction(async (tx) => {
      await tx.execute(sql`select ${groups.id} from ${groups} where ${groups.id} = ${groupId} for update`);
      const draft: GroupDraft = { state: await readGroup(groupId, tx) };
      const result = await fn(draft);
      if (draft.state) await writeGroup(tx, draft.state);
      return result;
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
  async listForUser(userId) {
    const db = getDb();
    const rows = await db
      .select()
      .from(groups)
      .innerJoin(members, eq(members.groupId, groups.id))
      .where(eq(members.userId, userId));
    return rows
      .map((row) => toGroup(row.groups))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },
};

async function readGroup(groupId: string, db: Database | Transaction = getDb()): Promise<GroupState | null> {
  // Independent reads run together: four round trips instead of thirteen against the remote database.
  const [[group], memberRows, zoneRows, ruleRows, contributionRows, cardRows, refundRows, orderRows] = await Promise.all([
    db.select().from(groups).where(eq(groups.id, groupId)).limit(1),
    db.select().from(members).where(eq(members.groupId, groupId)),
    db.select().from(zones).where(eq(zones.groupId, groupId)),
    db.select().from(rules).where(eq(rules.groupId, groupId)),
    db.select().from(contributions).where(eq(contributions.groupId, groupId)),
    db.select().from(cards).where(eq(cards.groupId, groupId)),
    db.select().from(refunds).where(eq(refunds.groupId, groupId)),
    db.select().from(storeOrders).where(eq(storeOrders.groupId, groupId)),
  ]);
  if (!group) return null;
  const zoneIds = zoneRows.map((zone) => zone.id);
  const card = cardRows[0] ?? null;
  const [slotRows, limitRows, authorizationRows] = await Promise.all([
    zoneIds.length === 0 ? Promise.resolve([]) : db.select().from(slots).where(inArray(slots.zoneId, zoneIds)),
    card ? db.select().from(storeLimits).where(eq(storeLimits.cardId, card.id)) : Promise.resolve([]),
    card ? db.select().from(authorizations).where(eq(authorizations.cardId, card.id)) : Promise.resolve([]),
  ]);
  const slotIds = slotRows.map((slot) => slot.id);
  const [productRows, linkRows] = await Promise.all([
    slotIds.length === 0 ? Promise.resolve([]) : db.select().from(products).where(inArray(products.slotId, slotIds)),
    slotIds.length === 0 ? Promise.resolve([]) : db.select().from(links).where(inArray(links.fromSlotId, slotIds)),
  ]);
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
    storeOrders: orderRows.map(toStoreOrder).sort((left, right) => left.store.localeCompare(right.store)),
    address: asAddress(group.addressJson),
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
      addressJson: state.address,
    })
    .onConflictDoUpdate({
      target: groups.id,
      set: {
        name: state.group.name,
        prompt: state.group.prompt,
        budgetCents: state.group.budgetCents,
        status: state.group.status,
        sharesJson: state.shares,
        addressJson: state.address,
      },
    });

  const existingZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.groupId, groupId));
  const zoneIds = existingZones.map((zone) => zone.id);
  const existingSlots = zoneIds.length === 0 ? [] : await tx.select({ id: slots.id }).from(slots).where(inArray(slots.zoneId, zoneIds));
  const slotIds = existingSlots.map((slot) => slot.id);
  const existingCards = await tx.select({ id: cards.id }).from(cards).where(eq(cards.groupId, groupId));
  const cardIds = existingCards.map((card) => card.id);

  if (cardIds.length > 0) {
    await tx.delete(authorizations).where(inArray(authorizations.cardId, cardIds));
    await tx.delete(storeLimits).where(inArray(storeLimits.cardId, cardIds));
  }
  await tx.delete(refunds).where(eq(refunds.groupId, groupId));
  await tx.delete(storeOrders).where(eq(storeOrders.groupId, groupId));
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
    await tx
      .insert(users)
      .values(
        state.members.map((member) => ({
          id: member.userId,
          firebaseUid: `demo:${member.userId}`,
          email: `${member.userId}@demo.setly.local`,
          name: member.name,
          createdAt: new Date(member.joinedAt),
        })),
      )
      .onConflictDoNothing();
    await tx.insert(members).values(
      state.members.map((member) => ({
        id: member.id,
        groupId: member.groupId,
        userId: member.userId,
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
  if (state.storeOrders.length > 0) {
    await tx.insert(storeOrders).values(
      state.storeOrders.map((order) => ({
        ...order,
        updatedAt: new Date(order.updatedAt),
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
  return {
    id: row.id,
    groupId: row.groupId,
    userId: row.userId,
    name: row.name,
    isOrganizer: row.isOrganizer,
    joinedAt: iso(row.joinedAt),
  };
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
  return {
    id: row.id,
    groupId: row.groupId,
    productId: row.productId,
    storeOrderId: row.storeOrderId,
    memberId: row.memberId,
    amountCents: row.amountCents,
    reason: asRefundReason(row.reason),
    createdAt: iso(row.createdAt),
  };
}

function toStoreOrder(row: typeof storeOrders.$inferSelect): StoreOrder {
  return {
    id: row.id,
    groupId: row.groupId,
    store: row.store,
    lane: asLane(row.lane),
    status: asStoreOrderStatus(row.status),
    subtotalCents: row.subtotalCents,
    capCents: row.capCents,
    quotedCents: row.quotedCents,
    externalId: row.externalId,
    attempt: row.attempt,
    error: row.error,
    tracking: asTracking(row.tracking),
    finalTotalCents: row.finalTotalCents,
    updatedAt: iso(row.updatedAt),
  };
}

function asRefundReason(value: string): RefundReason {
  if (value === "return" || value === "leftover_buffer" || value === "zinc_held" || value === "store_failed") return value;
  return "return";
}

function asLane(value: string): CheckoutLaneName {
  if (value === "protocol" || value === "zinc" || value === "guided") return value;
  return "guided";
}

function asStoreOrderStatus(value: string): StoreOrderStatus {
  if (
    value === "pending" ||
    value === "quoting" ||
    value === "needs_approval" ||
    value === "placing" ||
    value === "placed" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }
  return "pending";
}

function asTracking(value: unknown): TrackingInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.carrier !== "string" || typeof record.number !== "string") return [];
    return [{ carrier: record.carrier, number: record.number, url: typeof record.url === "string" ? record.url : null }];
  });
}

function asAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
  const address: ShippingAddress = {
    firstName: text("firstName"),
    lastName: text("lastName"),
    line1: text("line1"),
    line2: typeof record.line2 === "string" ? record.line2 : null,
    city: text("city"),
    state: text("state"),
    postalCode: text("postalCode"),
    phone: text("phone"),
  };
  return address.line1 && address.postalCode ? address : null;
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
    const lines = record.lines.flatMap((line): ShareLine[] => {
      if (!line || typeof line !== "object") return [];
      const entry = line as Record<string, unknown>;
      if (typeof entry.cents !== "number") return [];
      const slotId = typeof entry.slotId === "string" ? entry.slotId : null;
      const kind = entry.kind === "buffer" || entry.kind === "zinc_fee" ? entry.kind : "item";
      // Lines saved before buffers existed have no kind and are items, so they need a slot.
      if (kind === "item" && !slotId) return [];
      return [{ kind, slotId, store: typeof entry.store === "string" ? entry.store : null, cents: entry.cents }];
    });
    return [{ memberId: record.memberId, totalCents: record.totalCents, lines }];
  });
}
