import { nanoid } from "nanoid";
import { getLedgerStore, memoryLedger, useMemoryLedgerForTests } from "@/lib/db/memory-store";
import { LedgerError } from "@/lib/db/store";
import { resetUsersForTests } from "@/lib/db/users";
import { loadGroupState } from "@/lib/fixtures/sample";
import { computeRefunds } from "@/lib/money/refunds";
import { computeShares } from "@/lib/money/shares";
import { decideAuthorization } from "@/lib/payments/decide";
import type { DemoCheckoutResult, StoreLimitInput } from "@/lib/payments/issuer";
import { storeLimitInputs } from "@/lib/payments/limits";
import type { Authorization, Contribution, GroupState, MapData, Member, Refund, Slot, User } from "@/lib/types";

type Actor = Pick<User, "id" | "name">;

export { LedgerError, useMemoryLedgerForTests };

const offPlanMerchant = "GiftCardz";

export async function getGroupState(groupId: string) {
  const state = await (await getLedgerStore()).get(groupId);
  return state ? refreshTotals(state) : null;
}

export async function saveMap(groupId: string, map: MapData) {
  const state = await requireGroup(groupId);
  requireEditing(state);
  state.map = map;
  recomputeShares(state);
  await save(state);
  return state;
}

export async function createGroup(input: { name: string; prompt: string; budgetCents: number }, user: Actor) {
  const now = new Date().toISOString();
  const groupId = `grp_${nanoid(8)}`;
  const state: GroupState = {
    group: {
      id: groupId,
      name: input.name,
      prompt: input.prompt,
      budgetCents: input.budgetCents,
      status: "editing",
      createdAt: now,
    },
    members: [
      {
        id: `mem_${nanoid(8)}`,
        groupId,
        userId: user.id,
        name: user.name,
        isOrganizer: true,
        joinedAt: now,
      },
    ],
    map: { zones: [], slots: [], products: [], links: [], rules: [] },
    shares: [],
    contributions: [],
    card: null,
    storeLimits: [],
    authorizations: [],
    refunds: [],
    fundedCents: 0,
    totalCents: 0,
  };
  await save(state);
  return state;
}

export async function joinGroup(groupId: string, user: Actor, displayName?: string) {
  const state = await requireGroup(groupId);
  const trimmed = displayName?.trim();
  const existing = state.members.find((member) => member.userId === user.id);
  if (existing) {
    if (trimmed && existing.name !== trimmed) {
      existing.name = trimmed;
      await save(state);
    }
    return { member: existing, state };
  }
  requireEditing(state);
  const member: Member = {
    id: `mem_${nanoid(8)}`,
    groupId,
    userId: user.id,
    name: trimmed ? trimmed : user.name,
    isOrganizer: state.members.length === 0,
    joinedAt: new Date().toISOString(),
  };
  state.members.push(member);
  recomputeShares(state);
  await save(state);
  return { member, state };
}

export async function lockGroup(groupId: string, userId: string) {
  const state = await requireGroup(groupId);
  if (state.group.status !== "editing") throw new LedgerError("Map is already locked", 409);
  const member = state.members.find((item) => item.userId === userId);
  if (!member) throw new LedgerError("You are not in this group", 403);
  if (!member.isOrganizer) throw new LedgerError("Only the organizer can lock the map", 403);
  state.shares = computeShares(state.map, state.members);
  state.group.status = "funding";
  refreshTotals(state);
  await issueCardIfFunded(state);
  await save(state);
  return state;
}

export async function createSlot(input: {
  zoneId: string;
  need: string;
  quantityRule: Slot["quantityRule"];
  quantity: number;
  budgetCents: number;
  payType: Slot["payType"];
  ownerMemberId?: string | null;
}) {
  const state = await (await getLedgerStore()).findByZoneId(input.zoneId);
  if (!state) throw new LedgerError("Zone not found", 404);
  requireEditing(state);
  const slot: Slot = {
    id: `slot_${nanoid(8)}`,
    zoneId: input.zoneId,
    need: input.need,
    quantityRule: input.quantityRule,
    quantity: input.quantity,
    budgetCents: input.budgetCents,
    payType: input.payType,
    ownerMemberId: input.ownerMemberId ?? null,
    chosenProductId: null,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
  };
  state.map.slots.push(slot);
  recomputeShares(state);
  await save(state);
  return slot;
}

export async function updateSlot(slotId: string, patch: Partial<Omit<Slot, "id" | "zoneId">>) {
  const state = await (await getLedgerStore()).findBySlotId(slotId);
  if (!state) throw new LedgerError("Slot not found", 404);
  requireEditing(state);
  const slot = state.map.slots.find((item) => item.id === slotId);
  if (!slot) throw new LedgerError("Slot not found", 404);
  Object.assign(slot, patch, { id: slotId, zoneId: slot.zoneId, updatedAt: new Date().toISOString() });
  recomputeShares(state);
  await save(state);
  return slot;
}

export async function deleteSlot(slotId: string) {
  const state = await (await getLedgerStore()).findBySlotId(slotId);
  if (!state) throw new LedgerError("Slot not found", 404);
  requireEditing(state);
  state.map.slots = state.map.slots.filter((slot) => slot.id !== slotId);
  state.map.products = state.map.products.filter((product) => product.slotId !== slotId);
  state.map.links = state.map.links.filter((link) => link.fromSlotId !== slotId && link.toSlotId !== slotId);
  recomputeShares(state);
  await save(state);
}

export async function quoteShare(groupId: string, memberId: string) {
  const state = await requireGroup(groupId);
  const share = state.shares.find((item) => item.memberId === memberId);
  if (!state.members.some((member) => member.id === memberId)) throw new LedgerError("Member not found", 404);
  if (state.group.status === "editing") throw new LedgerError("Lock the map before paying", 409);
  if (state.group.status !== "funding" && state.group.status !== "active") {
    throw new LedgerError("This group is no longer accepting payments", 409);
  }
  const existing = state.contributions.find((contribution) => contribution.memberId === memberId) ?? null;
  if (!existing && state.group.status !== "funding") throw new LedgerError("This group is no longer accepting payments", 409);
  return { state, expectedCents: share?.totalCents ?? 0, existing };
}

export async function recordContribution(input: {
  groupId: string;
  memberId: string;
  amountCents: number;
  status: "pending" | "paid";
  stripePaymentIntentId: string | null;
}) {
  const state = await requireGroup(input.groupId);
  const existing = state.contributions.find((contribution) => contribution.memberId === input.memberId);
  if (existing && (existing.status !== "pending" || existing.stripePaymentIntentId)) {
    return { contribution: existing, state: refreshTotals(state), created: false };
  }
  const expected = state.shares.find((share) => share.memberId === input.memberId)?.totalCents ?? 0;
  if (input.amountCents !== expected) throw new LedgerError(`Share is ${expected} cents`, 400);
  const contribution: Contribution = existing ?? {
    id: `con_${nanoid(8)}`,
    groupId: input.groupId,
    memberId: input.memberId,
    amountCents: input.amountCents,
    stripePaymentIntentId: input.stripePaymentIntentId,
    status: input.status,
  };
  contribution.amountCents = input.amountCents;
  contribution.status = input.status;
  contribution.stripePaymentIntentId = input.stripePaymentIntentId;
  if (!existing) state.contributions.push(contribution);
  refreshTotals(state);
  await save(state);
  if (input.status !== "paid") return { contribution, state, created: true };
  const funded = await ensureFundedCard(input.groupId);
  const saved = funded.contributions.find((item) => item.id === contribution.id) ?? contribution;
  return { contribution: saved, state: funded, created: true };
}

export async function ensureFundedCard(groupId: string) {
  const state = await requireGroup(groupId);
  await issueCardIfFunded(state);
  await save(state);
  return state;
}

export async function markPaidByPaymentIntent(paymentIntentId: string) {
  const state = await (await getLedgerStore()).findByPaymentIntentId(paymentIntentId);
  if (!state) return null;
  const contribution = state.contributions.find((item) => item.stripePaymentIntentId === paymentIntentId);
  if (!contribution) return null;
  if (contribution.status === "pending") contribution.status = "paid";
  refreshTotals(state);
  await issueCardIfFunded(state);
  await save(state);
  return refreshTotals(state);
}

export async function authorizeCharge(cardId: string, merchant: string, amountCents: number): Promise<Authorization> {
  const state = await (await getLedgerStore()).findByCardId(cardId);
  const decision = decideAuthorization({
    card: state?.card ?? null,
    storeLimits: state?.storeLimits ?? [],
    merchant,
    amountCents,
  });
  const authorization: Authorization = {
    id: `auth_${nanoid(8)}`,
    cardId,
    merchant,
    amountCents,
    approved: decision.approved,
    reason: decision.reason,
    createdAt: new Date().toISOString(),
  };
  if (!state) return authorization;
  if (decision.approved && decision.store) {
    const limit = state.storeLimits.find((item) => item.store === decision.store);
    if (limit) limit.spentCents += amountCents;
  }
  state.authorizations.push(authorization);
  await save(state);
  return authorization;
}

export async function runCheckout(groupId: string): Promise<DemoCheckoutResult> {
  const state = await requireGroup(groupId);
  if (!state.card) throw new LedgerError("Group is not fully funded", 409);
  if (state.group.status === "purchased" || state.group.status === "settled") {
    return { card: state.card, authorizations: state.authorizations };
  }
  if (state.group.status !== "active") throw new LedgerError("Group is not fully funded", 409);
  const authorizations: Authorization[] = [];
  for (const limit of state.storeLimits) {
    authorizations.push(await authorizeCharge(state.card.id, limit.store, limit.limitCents));
  }
  authorizations.push(await authorizeCharge(state.card.id, offPlanMerchant, 100));
  const next = await requireGroup(groupId);
  next.group.status = "purchased";
  await save(next);
  if (!next.card) throw new LedgerError("Group is not fully funded", 409);
  return { card: next.card, authorizations };
}

export async function returnItem(groupId: string, productId: string) {
  const state = await requireGroup(groupId);
  const existing = state.refunds.filter((refund) => refund.productId === productId);
  if (existing.length > 0) return { refunds: existing, created: false, contributions: state.contributions };
  if (state.group.status !== "purchased" && state.group.status !== "settled") {
    throw new LedgerError("Checkout has not run", 409);
  }
  if (!state.map.products.some((product) => product.id === productId)) throw new LedgerError("Product not found", 404);
  const refunds = computeRefunds(productId, state.contributions, state.shares, state.map.products);
  state.refunds.push(...refunds);
  for (const refund of refunds) {
    const contribution = state.contributions.find((item) => item.memberId === refund.memberId && item.status === "paid");
    if (contribution) contribution.status = "refunded_partial";
  }
  if (state.group.status === "purchased") state.group.status = "settled";
  refreshTotals(state);
  await save(state);
  return { refunds, created: true, contributions: state.contributions };
}

export async function returnItemByProductId(productId: string): Promise<Refund[]> {
  const state = await (await getLedgerStore()).findByProductId(productId);
  if (!state) return [];
  const result = await returnItem(state.group.id, productId);
  return result.refunds;
}

export async function seedDemoGroup() {
  const state = structuredClone(loadGroupState());
  refreshTotals(state);
  await save(state);
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

async function issueCardIfFunded(state: GroupState) {
  refreshTotals(state);
  if (state.group.status !== "funding" || state.fundedCents !== state.totalCents || state.card) return;
  const limits: StoreLimitInput[] = storeLimitInputs(state.map, state.members);
  const { getIssuer } = await import("@/lib/payments");
  const card = await getIssuer().createCard(state.group.id, limits);
  state.card = card;
  state.storeLimits = limits.map((limit) => ({
    cardId: card.id,
    store: limit.store,
    limitCents: limit.limitCents,
    spentCents: 0,
  }));
  state.group.status = "active";
}

function recomputeShares(state: GroupState) {
  state.shares = computeShares(state.map, state.members);
  refreshTotals(state);
}

function refreshTotals(state: GroupState) {
  state.totalCents = state.shares.reduce((sum, share) => sum + share.totalCents, 0);
  state.fundedCents = state.contributions
    .filter((contribution) => contribution.status === "paid" || contribution.status === "refunded_partial")
    .reduce((sum, contribution) => sum + contribution.amountCents, 0);
  return state;
}

function requireEditing(state: GroupState) {
  if (state.group.status !== "editing") throw new LedgerError("Map is locked", 409);
}

async function requireGroup(groupId: string) {
  const state = await getGroupState(groupId);
  if (!state) throw new LedgerError("Group not found", 404);
  return state;
}

async function save(state: GroupState) {
  refreshTotals(state);
  await (await getLedgerStore()).put(state);
}

export async function listGroupsForUser(userId: string) {
  return (await getLedgerStore()).listForUser(userId);
}

export async function requireMember(groupId: string, userId: string) {
  const state = await requireGroup(groupId);
  const member = state.members.find((item) => item.userId === userId);
  if (!member) throw new LedgerError("You are not in this group", 403);
  return { state, member };
}

export async function requireZoneMember(zoneId: string, userId: string) {
  const state = await (await getLedgerStore()).findByZoneId(zoneId);
  if (!state) throw new LedgerError("Zone not found", 404);
  const member = state.members.find((item) => item.userId === userId);
  if (!member) throw new LedgerError("You are not in this group", 403);
  return { state, member };
}

export async function requireSlotMember(slotId: string, userId: string) {
  const state = await (await getLedgerStore()).findBySlotId(slotId);
  if (!state) throw new LedgerError("Slot not found", 404);
  const member = state.members.find((item) => item.userId === userId);
  if (!member) throw new LedgerError("You are not in this group", 403);
  return { state, member };
}

export function resetLedgerForTests() {
  useMemoryLedgerForTests();
  memoryLedger.reset(true);
  resetUsersForTests();
}
