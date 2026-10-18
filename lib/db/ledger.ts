import { AsyncLocalStorage } from "node:async_hooks";
import { nanoid } from "nanoid";
import { getLedgerStore, memoryLedger, useMemoryLedgerForTests } from "@/lib/db/memory-store";
import { LedgerError, type GroupDraft } from "@/lib/db/store";
import { resetUsersForTests } from "@/lib/db/users";
import { loadGroupState } from "@/lib/fixtures/sample";
import { computeRefunds } from "@/lib/money/refunds";
import { computeShares } from "@/lib/money/shares";
import { decideAuthorization } from "@/lib/payments/decide";
import type { DemoCheckoutResult, StoreLimitInput } from "@/lib/payments/issuer";
import { storeLimitInputs } from "@/lib/payments/limits";
import { laneForStore } from "@/lib/checkout/registry";
import { checkRules } from "@/lib/rules/check";
import type { Authorization, Contribution, GroupState, MapData, Member, Product, Refund, Slot, User } from "@/lib/types";

type Actor = Pick<User, "id" | "name">;

export { LedgerError, useMemoryLedgerForTests };

const offPlanMerchant = "GiftCardz";

const openMutation = new AsyncLocalStorage<{ groupId: string; draft: GroupDraft }>();

export async function getGroupState(groupId: string) {
  const state = await (await getLedgerStore()).get(groupId);
  return state ? refreshTotals(state) : null;
}

export async function saveMap(groupId: string, map: MapData) {
  return editGroup(groupId, async (state) => {
    requireEditing(state);
    state.map = {
      ...map,
      zones: map.zones.map((zone) => ({ ...zone, groupId })),
      rules: map.rules.map((rule) => ({ ...rule, groupId })),
    };
    recomputeShares(state);
    return state;
  });
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
    storeOrders: [],
    address: null,
    fundedCents: 0,
    totalCents: 0,
  };
  return (await getLedgerStore()).mutate(groupId, async (draft) => {
    draft.state = state;
    return state;
  });
}

export async function joinGroup(groupId: string, user: Actor, displayName?: string) {
  return editGroup(groupId, async (state) => {
    const trimmed = displayName?.trim();
    const existing = state.members.find((member) => member.userId === user.id);
    if (existing) {
      if (trimmed && existing.name !== trimmed) existing.name = trimmed;
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
    return { member, state };
  });
}

export async function lockGroup(groupId: string, userId: string) {
  return editGroup(groupId, async (state) => {
    if (state.group.status !== "editing") throw new LedgerError("Map is already locked", 409);
    const member = state.members.find((item) => item.userId === userId);
    if (!member) throw new LedgerError("You are not in this group", 403);
    if (!member.isOrganizer) throw new LedgerError("Only the organizer can lock the map", 403);
    recomputeShares(state);
    const blocking = state.map.rules.find(
      (rule) => (rule.type === "budget" || rule.type === "required_or_banned") && rule.status === "broken",
    );
    if (blocking) throw new LedgerError(blocking.message, 409);
    state.group.status = "funding";
    await issueCardIfFunded(state);
    return state;
  });
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
  const located = await (await getLedgerStore()).findByZoneId(input.zoneId);
  if (!located) throw new LedgerError("Zone not found", 404);
  return editGroup(located.group.id, async (state) => {
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
    return slot;
  });
}

export async function updateSlot(slotId: string, patch: Partial<Omit<Slot, "id" | "zoneId">>) {
  const located = await (await getLedgerStore()).findBySlotId(slotId);
  if (!located) throw new LedgerError("Slot not found", 404);
  const chosenId = patch.chosenProductId;
  // A swapped-in option isn't saved yet: look it up before the lock, so no search runs inside it.
  let swapped: Product | null = null;
  if (chosenId && !located.map.products.some((product) => product.id === chosenId)) {
    const { findSlotOption } = await import("@/lib/search/options");
    swapped = await findSlotOption(slotId, chosenId);
    if (!swapped) throw new LedgerError("That option is not available for this slot", 400);
  }
  return editGroup(located.group.id, async (state) => {
    requireEditing(state);
    const slot = state.map.slots.find((item) => item.id === slotId);
    if (!slot) throw new LedgerError("Slot not found", 404);
    if (swapped && !state.map.products.some((product) => product.id === swapped.id)) {
      state.map.products = [...state.map.products.filter((product) => product.slotId !== slotId), { ...swapped, slotId }];
    }
    Object.assign(slot, patch, { id: slotId, zoneId: slot.zoneId, updatedAt: new Date().toISOString() });
    recomputeShares(state);
    return slot;
  });
}

export async function deleteSlot(slotId: string) {
  const located = await (await getLedgerStore()).findBySlotId(slotId);
  if (!located) throw new LedgerError("Slot not found", 404);
  await editGroup(located.group.id, async (state) => {
    requireEditing(state);
    state.map.slots = state.map.slots.filter((slot) => slot.id !== slotId);
    state.map.products = state.map.products.filter((product) => product.slotId !== slotId);
    state.map.links = state.map.links.filter((link) => link.fromSlotId !== slotId && link.toSlotId !== slotId);
    recomputeShares(state);
  });
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
  return editGroup(input.groupId, async (state) => {
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
    if (input.status !== "paid") return { contribution, state, created: true };
    await issueCardIfFunded(state);
    const saved = state.contributions.find((item) => item.id === contribution.id) ?? contribution;
    return { contribution: saved, state, created: true };
  });
}

export async function ensureFundedCard(groupId: string) {
  return editGroup(groupId, async (state) => {
    await issueCardIfFunded(state);
    return state;
  });
}

export async function markPaidByPaymentIntent(paymentIntentId: string) {
  const located = await (await getLedgerStore()).findByPaymentIntentId(paymentIntentId);
  if (!located) return null;
  return editGroup(located.group.id, async (state) => {
    const contribution = state.contributions.find((item) => item.stripePaymentIntentId === paymentIntentId);
    if (!contribution) return null;
    if (contribution.status === "pending") contribution.status = "paid";
    refreshTotals(state);
    await issueCardIfFunded(state);
    return refreshTotals(state);
  });
}

/** Marks a contribution paid when its Stripe Checkout Session completes, replacing the temporary session reference with the PaymentIntent used for refunds. */
export async function markPaidByCheckoutSession(input: {
  sessionId: string;
  paymentIntentId: string;
  groupId: string;
  memberId: string;
  amountCents: number;
}) {
  const located = await (await getLedgerStore()).findByPaymentIntentId(input.sessionId);
  if (!located || located.group.id !== input.groupId) return null;
  return editGroup(input.groupId, async (state) => {
    const contribution = state.contributions.find((item) => item.stripePaymentIntentId === input.sessionId);
    if (!contribution || contribution.memberId !== input.memberId || contribution.amountCents !== input.amountCents) return null;
    if (contribution.status === "pending") {
      contribution.status = "paid";
      contribution.stripePaymentIntentId = input.paymentIntentId;
    }
    refreshTotals(state);
    await issueCardIfFunded(state);
    return refreshTotals(state);
  });
}

/** Replaces an expired Checkout Session reference while preserving the member's existing pending contribution. */
export async function replacePendingCheckoutSession(input: {
  groupId: string;
  memberId: string;
  amountCents: number;
  previousReference: string;
  sessionId: string;
}) {
  return editGroup(input.groupId, (state) => {
    const contribution = state.contributions.find((item) => item.memberId === input.memberId);
    if (!contribution || contribution.status !== "pending" || contribution.amountCents !== input.amountCents) {
      throw new LedgerError("This contribution is no longer awaiting payment", 409);
    }
    if (contribution.stripePaymentIntentId !== input.previousReference && contribution.stripePaymentIntentId !== input.sessionId) {
      throw new LedgerError("A newer checkout is already open", 409);
    }
    contribution.stripePaymentIntentId = input.sessionId;
    return { contribution, state: refreshTotals(state), created: true };
  });
}

export async function authorizeCharge(cardId: string, merchant: string, amountCents: number): Promise<Authorization> {
  const open = openMutation.getStore();
  if (open?.draft.state?.card?.id === cardId) return applyAuthorization(open.draft.state, cardId, merchant, amountCents);
  const located = await (await getLedgerStore()).findByCardId(cardId);
  if (!located) return applyAuthorization(null, cardId, merchant, amountCents);
  return editGroup(located.group.id, (state) => applyAuthorization(state, cardId, merchant, amountCents));
}

export async function runCheckout(groupId: string): Promise<DemoCheckoutResult> {
  return editGroup(groupId, async (state) => {
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
    state.group.status = "purchased";
    if (!state.card) throw new LedgerError("Group is not fully funded", 409);
    return { card: state.card, authorizations };
  });
}

export async function returnItem(groupId: string, productId: string) {
  return editGroup(groupId, async (state) => {
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
    return { refunds, created: true, contributions: state.contributions };
  });
}

export async function returnItemByProductId(productId: string): Promise<Refund[]> {
  const located = await (await getLedgerStore()).findByProductId(productId);
  if (!located) return [];
  const result = await returnItem(located.group.id, productId);
  return result.refunds;
}

export async function seedDemoGroup() {
  const state = structuredClone(loadGroupState());
  refreshTotals(state);
  await (await getLedgerStore()).mutate(state.group.id, async (draft) => {
    draft.state = state;
  });
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

async function issueCardIfFunded(state: GroupState) {
  refreshTotals(state);
  if (state.group.status !== "funding" || state.fundedCents !== state.totalCents || state.card) return;
  const limits: StoreLimitInput[] = storeLimitInputs(state.map, state.members, laneForStore);
  const { getIssuer } = await import("@/lib/payments");
  const issuer = getIssuer();
  let card;
  try {
    card = await issuer.createCard(state.group.id, limits);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Card issuer failed";
    console.error(message);
    const { mockIssuer } = await import("@/lib/payments/mock-issuer");
    if (issuer === mockIssuer) throw error;
    card = await mockIssuer.createCard(state.group.id, limits);
  }
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
  state.shares = computeShares(state.map, state.members, laneForStore);
  refreshTotals(state);
  state.map.rules = checkRules(state.map, state.members);
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

function applyAuthorization(state: GroupState | null, cardId: string, merchant: string, amountCents: number): Authorization {
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
  return authorization;
}

/** Runs `fn` on the group inside its lock (reusing an open one). Keep `fn` short: no lanes or network inside. */
export async function editGroup<T>(groupId: string, fn: (state: GroupState) => Promise<T> | T): Promise<T> {
  const open = openMutation.getStore();
  if (open?.groupId === groupId) {
    if (!open.draft.state) throw new LedgerError("Group not found", 404);
    return fn(open.draft.state);
  }
  return (await getLedgerStore()).mutate(groupId, async (draft) => {
    if (!draft.state) throw new LedgerError("Group not found", 404);
    return openMutation.run({ groupId, draft }, () => fn(draft.state as GroupState));
  });
}

async function requireGroup(groupId: string) {
  const state = await getGroupState(groupId);
  if (!state) throw new LedgerError("Group not found", 404);
  return state;
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
  // A test helper that happens to start with "use", not a React hook.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useMemoryLedgerForTests();
  memoryLedger.reset(true);
  resetUsersForTests();
}
