import { nanoid } from "nanoid";
import { getLane } from "@/lib/checkout/lanes";
import { storeItems, type LaneOrder, type LaneUpdate } from "@/lib/checkout/lane";
import { laneForStore } from "@/lib/checkout/registry";
import { authorizeCharge, editGroup, getGroupState, LedgerError } from "@/lib/db/ledger";
import { capCents, storeSubtotals } from "@/lib/money/buffer";
import { contributionsByStore, leftoverRefunds } from "@/lib/money/leftover";
import type { GroupState, Refund, ShippingAddress, StoreOrder, StoreOrderStatus } from "@/lib/types";

/**
 * Drives each store's order through its lane:
 *   quoting → (quote ≤ cap) pending → place → placing → placed | failed | canceled
 *   quoting → (quote > cap) needs_approval → approve → pending … | decline → canceled
 * Lanes never run inside the ledger lock: read the group, call the lane, then write the result in a short
 * mutation that first checks the order hasn't moved on. Vercel has no background jobs, so the polled group
 * GET calls `advanceCheckout` to move placing orders forward.
 */
const TERMINAL = new Set<StoreOrderStatus>(["placed", "failed", "canceled"]);
const POLL_MS = 1_000;
/** A quoting or pending order untouched this long lost its request (a timeout or a frozen function): run it again. */
const STALE_MS = 10_000;
const lastPoll = new Map<string, number>();

export function isTerminal(order: StoreOrder) {
  return TERMINAL.has(order.status);
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function laneOrder(state: GroupState, order: StoreOrder, now: Date): LaneOrder {
  if (!state.address) throw new LedgerError("Add a shipping address first", 409);
  return {
    order,
    items: storeItems(state.map, state.members, order.store),
    address: state.address,
    cardId: state.card?.id ?? null,
    authorizations: state.authorizations,
    now,
  };
}

type OrderWrite = { read: StoreOrder; patch: Partial<StoreOrder> };

/**
 * Writes lane results for several orders in one locked write (a remote database costs seconds per write),
 * skipping any order whose status or attempt changed since it was read. Returns the updated state.
 */
async function writeOrders(groupId: string, writes: OrderWrite[], now: Date) {
  return editGroup(groupId, (state) => {
    let applied = 0;
    for (const { read, patch } of writes) {
      const order = state.storeOrders.find((item) => item.id === read.id);
      if (!order || order.status !== read.status || order.attempt !== read.attempt) continue;
      Object.assign(order, patch, { updatedAt: now.toISOString() });
      applied += 1;
    }
    return { state: structuredClone(state), applied };
  });
}

function fromLane(update: LaneUpdate): Partial<StoreOrder> {
  const patch: Partial<StoreOrder> = { status: update.status };
  if (update.externalId !== undefined) patch.externalId = update.externalId;
  if (update.quotedCents !== undefined) patch.quotedCents = update.quotedCents;
  if (update.finalTotalCents !== undefined) patch.finalTotalCents = update.finalTotalCents;
  if (update.error !== undefined) patch.error = update.error;
  if (update.tracking !== undefined) patch.tracking = update.tracking;
  return patch;
}

const message = (error: unknown) => (error instanceof Error ? error.message : "Checkout failed");

/** Runs a lane call for each order in parallel; a throw becomes a failed order. */
async function laneWrites(orders: StoreOrder[], call: (order: StoreOrder) => Promise<Partial<StoreOrder>>): Promise<OrderWrite[]> {
  return Promise.all(
    orders.map(async (read) => {
      try {
        return { read, patch: await call(read) };
      } catch (error) {
        return { read, patch: { status: "failed" as const, error: message(error) } };
      }
    }),
  );
}

/** Quotes, then places, the given orders as far as they can go now: one write per phase, not per store. */
async function runOrders(groupId: string, orderIds: string[], now: Date) {
  const wanted = new Set(orderIds);
  let state = await getGroupState(groupId);
  if (!state) return;

  const quoting = state.storeOrders.filter((order) => wanted.has(order.id) && order.status === "quoting");
  if (quoting.length > 0) {
    const current = state;
    const writes = await laneWrites(quoting, async (order) => {
      const quote = await getLane(order.lane).quote(laneOrder(current, order, now));
      const over = quote.quotedCents > order.capCents;
      return {
        quotedCents: quote.quotedCents,
        externalId: quote.externalId,
        status: over ? "needs_approval" : "pending",
        error: over ? `${order.store} quoted ${dollars(quote.quotedCents)}, ${dollars(quote.quotedCents - order.capCents)} over the ${dollars(order.capCents)} cap` : null,
      };
    });
    state = (await writeOrders(groupId, writes, now)).state;
  }

  const pending = state.storeOrders.filter((order) => wanted.has(order.id) && order.status === "pending");
  if (pending.length > 0) {
    const current = state;
    const writes = await laneWrites(pending, async (order) => fromLane(await getLane(order.lane).place(laneOrder(current, order, now))));
    await writeOrders(groupId, writes, now);
  }
}

/** Creates a store order per store, then quotes and places them all in parallel. Organizer only. */
export async function startCheckout(groupId: string, userId: string, address: ShippingAddress, now = new Date()) {
  const created = await editGroup(groupId, (state) => {
    const member = state.members.find((item) => item.userId === userId);
    if (!member) throw new LedgerError("You are not in this group", 403);
    if (!member.isOrganizer) throw new LedgerError("Only the organizer can check out", 403);
    if (state.storeOrders.length > 0) return [];
    if (state.group.status !== "active" || !state.card) throw new LedgerError("Group is not fully funded", 409);
    state.address = address;
    state.storeOrders = storeSubtotals(state.map, state.members).map(({ store, subtotalCents }) => ({
      id: `so_${nanoid(8)}`,
      groupId,
      store,
      lane: laneForStore(store),
      status: "quoting",
      subtotalCents,
      capCents: capCents(subtotalCents),
      quotedCents: null,
      externalId: null,
      attempt: 0,
      error: null,
      tracking: [],
      finalTotalCents: null,
      updatedAt: now.toISOString(),
    }));
    return state.storeOrders.map((order) => order.id);
  });
  if (created.length > 0) await runOrders(groupId, created, now);
  return requireState(groupId);
}

/**
 * Moves orders forward: polls placing orders and re-runs stalled ones. Called from the polled group GET with
 * the state it already read, at most once a second per group per server. Returns the state to send.
 */
export async function advanceCheckout(state: GroupState, now = new Date()): Promise<GroupState> {
  const groupId = state.group.id;
  const due = state.storeOrders.filter((order) => {
    const age = now.getTime() - Date.parse(order.updatedAt);
    if (order.status === "placing") return age >= POLL_MS;
    return (order.status === "quoting" || order.status === "pending") && age >= STALE_MS;
  });
  if (due.length === 0) return state;
  if (now.getTime() - (lastPoll.get(groupId) ?? 0) < POLL_MS) return state;
  lastPoll.set(groupId, now.getTime());

  const placing = due.filter((order) => order.status === "placing");
  const stalled = due.filter((order) => order.status !== "placing");

  let changed = false;
  if (placing.length > 0) {
    // Polling is read-only, so two servers polling at once is harmless; only an order that moved is written.
    const writes = await laneWrites(placing, async (order) => fromLane(await getLane(order.lane).status(laneOrder(state, order, now))));
    const moved = writes.filter(({ read, patch }) => {
      if (patch.status !== read.status) return true;
      if (patch.finalTotalCents !== undefined && patch.finalTotalCents !== read.finalTotalCents) return true;
      return patch.tracking !== undefined && patch.tracking.length !== read.tracking.length;
    });
    if (moved.length > 0) changed = (await writeOrders(groupId, moved, now)).applied > 0;
  }
  if (stalled.length > 0) {
    // Touch them first so another poll doesn't run them twice.
    const touched = await writeOrders(groupId, stalled.map((read) => ({ read, patch: {} })), now);
    if (touched.applied > 0) await runOrders(groupId, stalled.map((order) => order.id), now);
    changed = true;
  }
  return changed ? requireState(groupId) : state;
}

/** The most this order may grow by: the buffer the other stores haven't used. Earlier raises already spent theirs. */
function spareBuffer(state: GroupState, except: StoreOrder) {
  return state.storeOrders
    .filter((order) => order.id !== except.id)
    .reduce((sum, order) => {
      const original = capCents(order.subtotalCents);
      if (order.status === "failed" || order.status === "canceled") return sum + original;
      // Only a protocol quote is a real total; Zinc and guided may use their whole cap until they finish.
      const spend = order.finalTotalCents ?? (order.lane === "protocol" ? (order.quotedCents ?? original) : order.capCents);
      return sum + Math.max(0, original - spend);
    }, 0);
}

/** Approves or declines an over-cap quote. Approving raises the cap from spare buffer and places the order. */
export async function approveCheckout(groupId: string, userId: string, storeOrderId: string, approve: boolean, now = new Date()) {
  const ready = await editGroup(groupId, (state) => {
    if (!state.members.some((member) => member.userId === userId)) throw new LedgerError("You are not in this group", 403);
    const order = state.storeOrders.find((item) => item.id === storeOrderId);
    if (!order) throw new LedgerError("Store order not found", 404);
    if (order.status !== "needs_approval") throw new LedgerError(`${order.store} doesn't need approval`, 409);
    order.updatedAt = now.toISOString();
    if (!approve) {
      order.status = "canceled";
      order.error = "The group declined the higher total";
      return false;
    }
    const spare = spareBuffer(state, order);
    // Zinc's max_price_exceeded can come back without a total: then offer everything the plan has left.
    const quoted = order.quotedCents ?? capCents(order.subtotalCents) + spare;
    const need = quoted - capCents(order.subtotalCents);
    if (need > spare) {
      order.status = "canceled";
      order.error = `Needs ${dollars(need)} more than its buffer; only ${dollars(spare)} is left across the plan`;
      return false;
    }
    const raise = quoted - order.capCents;
    order.capCents = quoted;
    order.attempt += 1;
    order.status = "pending";
    order.error = null;
    if (order.lane === "zinc") order.externalId = null;
    // Protocol and guided stores charge the card, so its limit for that store grows too.
    const limit = state.storeLimits.find((item) => item.store === order.store);
    if (limit && raise > 0) {
      limit.limitCents += raise;
      if (state.card) state.card.limitCents += raise;
    }
    return true;
  });
  if (ready) await runOrders(groupId, [storeOrderId], now);
  return requireState(groupId);
}

/**
 * A member bought a guided store's part with the group card. With the mock issuer there is no real store to
 * charge the card, so this makes that one charge: the store's quoted subtotal, at that store, through the same
 * authorization rules a real charge goes through. Then the order is checked right away instead of on the next poll.
 */
export async function recordGuidedPurchase(groupId: string, userId: string, storeOrderId: string, now = new Date()) {
  if ((process.env.ISSUER ?? "mock") === "stripe") throw new LedgerError("Buy it on the store's site with the group card; the charge shows up here", 409);
  const state = await requireState(groupId);
  if (!state.members.some((member) => member.userId === userId)) throw new LedgerError("You are not in this group", 403);
  const order = state.storeOrders.find((item) => item.id === storeOrderId);
  if (!order) throw new LedgerError("Store order not found", 404);
  if (order.lane !== "guided" || order.status !== "placing") throw new LedgerError(`${order.store} isn't waiting for a buyer`, 409);
  if (!state.card) throw new LedgerError("The group card isn't active", 409);
  const authorization = await authorizeCharge(state.card.id, order.store, order.quotedCents ?? order.subtotalCents);
  if (!authorization.approved) throw new LedgerError(authorization.reason, 402);
  const after = await requireState(groupId);
  const read = after.storeOrders.find((item) => item.id === storeOrderId);
  if (read?.status === "placing") {
    const update = await getLane("guided").status(laneOrder(after, read, now));
    await writeOrders(groupId, [{ read, patch: fromLane(update) }], now);
  }
  return requireState(groupId);
}

/**
 * Once every order is finished, refunds what checkout didn't spend and marks the group purchased.
 * Guided orders nobody bought are canceled first, and their card limit is closed. Settling again is a no-op.
 */
export async function settleCheckout(groupId: string, userId: string, now = new Date()): Promise<{ state: GroupState; refunds: Refund[] }> {
  const refunds = await editGroup(groupId, (state) => {
    if (!state.members.some((member) => member.userId === userId)) throw new LedgerError("You are not in this group", 403);
    if (state.storeOrders.length === 0) throw new LedgerError("Checkout hasn't started", 409);
    if (state.group.status === "purchased" || state.group.status === "settled") return [];
    for (const order of state.storeOrders) {
      if (order.lane !== "guided" || order.status !== "placing") continue;
      order.status = "canceled";
      order.error = `Nobody bought from ${order.store}`;
      order.updatedAt = now.toISOString();
      const limit = state.storeLimits.find((item) => item.store === order.store);
      if (limit) limit.limitCents = limit.spentCents;
    }
    const open = state.storeOrders.find((order) => !isTerminal(order));
    if (open) throw new LedgerError(`${open.store} is still ${open.status.replace("_", " ")}`, 409);
    const known = new Set(state.refunds.map((refund) => refund.id));
    const created = leftoverRefunds(state.storeOrders, contributionsByStore(state.shares, state.contributions), now.toISOString()).filter(
      (refund) => !known.has(refund.id),
    );
    state.refunds.push(...created);
    for (const refund of created) {
      const contribution = state.contributions.find((item) => item.memberId === refund.memberId && item.status === "paid");
      if (contribution) contribution.status = "refunded_partial";
    }
    state.group.status = "purchased";
    return created;
  });
  return { state: await requireState(groupId), refunds };
}

async function requireState(groupId: string) {
  const state = await getGroupState(groupId);
  if (!state) throw new LedgerError("Group not found", 404);
  return state;
}

export function resetCheckoutPollsForTests() {
  lastPoll.clear();
}
