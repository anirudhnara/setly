import { nanoid } from "nanoid";
import { loadApartmentMap, loadCampingMap, loadGroupState } from "@/lib/fixtures/sample";
import type { Authorization, Card, MapData, Refund, StoreLimit } from "@/lib/types";
import type { DemoCheckoutResult, Issuer, StoreLimitInput } from "@/lib/payments/issuer";

interface MemoryCard {
  card: Card;
  limits: Map<string, StoreLimit>;
  authorizations: Authorization[];
}

const cards = new Map<string, MemoryCard>();
const groupCards = new Map<string, string>();

function matchStore(merchant: string, stores: Iterable<string>) {
  const haystack = merchant.toLowerCase();
  return [...stores]
    .filter((store) => haystack.includes(store.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
}

function chargedCents(map: MapData, memberCount: number) {
  const totals = new Map<string, number>();
  for (const slot of map.slots) {
    if (slot.payType === "already_owned" || !slot.chosenProductId) continue;
    const product = map.products.find((item) => item.id === slot.chosenProductId);
    if (!product) continue;
    const amount = slot.payType === "per_person" ? product.priceCents * slot.quantity * memberCount : product.priceCents * slot.quantity;
    totals.set(product.store, (totals.get(product.store) ?? 0) + amount);
  }
  return [...totals.entries()].map(([store, limitCents]) => ({ store, limitCents }));
}

export const mockIssuer: Issuer = {
  async createCard(groupId, limits) {
    const limitCents = limits.reduce((sum, limit) => sum + limit.limitCents, 0);
    const card: Card = {
      id: `card_${nanoid(8)}`,
      groupId,
      last4: "4242",
      limitCents,
      status: limitCents > 0 ? "active" : "inactive",
    };
    const storeLimits = new Map<string, StoreLimit>();
    for (const limit of limits) {
      storeLimits.set(limit.store, { cardId: card.id, store: limit.store, limitCents: limit.limitCents, spentCents: 0 });
    }
    cards.set(card.id, { card, limits: storeLimits, authorizations: [] });
    groupCards.set(groupId, card.id);
    return card;
  },

  async authorize(cardId, merchant, amountCents) {
    const record = cards.get(cardId);
    const createdAt = new Date().toISOString();
    if (!record || record.card.status !== "active") {
      return decline(cardId, merchant, amountCents, "Declined: card was not found or is not active.", createdAt);
    }
    const store = matchStore(merchant, record.limits.keys());
    if (!store) {
      const authorization = decline(cardId, merchant, amountCents, "Declined: merchant is not a store on this plan.", createdAt);
      record.authorizations.push(authorization);
      return authorization;
    }
    const limit = record.limits.get(store);
    const remaining = (limit?.limitCents ?? 0) - (limit?.spentCents ?? 0);
    if (!limit || amountCents > remaining) {
      const authorization = decline(cardId, merchant, amountCents, "Declined: amount exceeds the remaining limit for this store.", createdAt);
      record.authorizations.push(authorization);
      return authorization;
    }
    limit.spentCents += amountCents;
    const authorization: Authorization = {
      id: `auth_${nanoid(8)}`,
      cardId,
      merchant,
      amountCents,
      approved: true,
      reason: "Approved: merchant is a plan store and the amount fits the remaining store limit.",
      createdAt,
    };
    record.authorizations.push(authorization);
    return authorization;
  },

  async runDemoCheckout(groupId) {
    const camping = groupId === "grp_camping";
    const map = camping ? loadCampingMap() : loadApartmentMap();
    const memberCount = camping ? 6 : loadGroupState().members.length;
    const limits: StoreLimitInput[] = chargedCents(map, memberCount);
    const existingId = groupCards.get(groupId);
    const card = existingId && cards.get(existingId) ? cards.get(existingId)!.card : await this.createCard(groupId, limits);
    const authorizations: Authorization[] = [];
    for (const limit of limits) {
      authorizations.push(await this.authorize(card.id, limit.store, limit.limitCents));
    }
    const result: DemoCheckoutResult = { card, authorizations };
    return result;
  },

  async refundItem(productId) {
    // TODO(Backend 1 (Money)): call computeRefunds once that function is implemented.
    const state = loadGroupState();
    const product = state.map.products.find((item) => item.id === productId) ?? loadCampingMap().products.find((item) => item.id === productId);
    if (!product) return [];
    const paid = new Set(state.contributions.filter((item) => item.status === "paid").map((item) => item.memberId));
    const createdAt = new Date().toISOString();
    const refunds: Refund[] = [];
    for (const share of state.shares) {
      const cents = share.lines.find((line) => line.slotId === product.slotId)?.cents ?? 0;
      if (cents <= 0 || !paid.has(share.memberId)) continue;
      refunds.push({
        id: `ref_${nanoid(8)}`,
        groupId: state.group.id,
        productId: product.id,
        memberId: share.memberId,
        amountCents: cents,
        createdAt,
      });
    }
    return refunds;
  },
};

function decline(cardId: string, merchant: string, amountCents: number, reason: string, createdAt: string): Authorization {
  return { id: `auth_${nanoid(8)}`, cardId, merchant, amountCents, approved: false, reason, createdAt };
}
