import { z } from "zod";
import { getIssuer } from "@/lib/payments";
import { demoStore, type DemoStore } from "@/lib/stores/catalog";
import { asAddress, decodeSession, encodeSession, orderIdFor, priceSession, sessionTotal, type CheckoutSession, type SessionState } from "@/lib/stores/session";

/**
 * The demo stores' seller side. Route handlers in app/api/stores wrap these, and the protocol checkout lane
 * calls them in-process, so checkout never depends on the app fetching its own URL.
 * Seller endpoints: no Firebase auth. Payment is the Setly card id, checked through the Issuer.
 */
export type StoreResult = { status: number; body: CheckoutSession | { error: string; messages?: CheckoutSession["messages"] } };

const addressSchema = z.object({
  name: z.string().min(1).max(120),
  line_one: z.string().min(1).max(60),
  line_two: z.string().max(60).nullable().optional(),
  city: z.string().min(1).max(60),
  state: z.string().min(2).max(2),
  postal_code: z.string().regex(/^\d{5}(-\d{4})?$/),
  country: z.string().length(2).default("US"),
});
const itemsSchema = z.array(z.object({ id: z.string().min(1), quantity: z.number().int().positive().max(99) })).min(1).max(50);

export const createSessionSchema = z.object({ items: itemsSchema, fulfillment_address: addressSchema.optional() });
export const updateSessionSchema = z.object({ items: itemsSchema.optional(), fulfillment_address: addressSchema.optional() });
export const completeSessionSchema = z.object({ payment_data: z.object({ token: z.string().min(1), provider: z.string().default("setly") }) });

function load(slug: string, sessionId?: string): { store: DemoStore; state: SessionState | null } | StoreResult {
  const store = demoStore(slug);
  if (!store) return { status: 404, body: { error: "Store not found" } };
  if (sessionId === undefined) return { store, state: null };
  const state = decodeSession(sessionId);
  if (!state || state.slug !== slug) return { status: 404, body: { error: "Checkout session not found" } };
  return { store, state };
}

const isResult = (value: unknown): value is StoreResult => Boolean(value && typeof value === "object" && "status" in value && "body" in value);

export function createSession(slug: string, input: z.infer<typeof createSessionSchema>, now = new Date()): StoreResult {
  const loaded = load(slug);
  if (isResult(loaded)) return loaded;
  const state: SessionState = { slug, items: input.items, address: asAddress(input.fulfillment_address), createdAt: now.toISOString() };
  return { status: 201, body: priceSession(loaded.store, state) };
}

export function getSession(slug: string, sessionId: string): StoreResult {
  const loaded = load(slug, sessionId);
  if (isResult(loaded)) return loaded;
  return { status: 200, body: priceSession(loaded.store, loaded.state as SessionState) };
}

/** Sessions are immutable values, so an update returns a session with a new id. */
export function updateSession(slug: string, sessionId: string, input: z.infer<typeof updateSessionSchema>): StoreResult {
  const loaded = load(slug, sessionId);
  if (isResult(loaded)) return loaded;
  const current = loaded.state as SessionState;
  const next: SessionState = { ...current, items: input.items ?? current.items, address: input.fulfillment_address ? asAddress(input.fulfillment_address) : current.address };
  return { status: 200, body: priceSession(loaded.store, next) };
}

export function cancelSession(slug: string, sessionId: string): StoreResult {
  const loaded = load(slug, sessionId);
  if (isResult(loaded)) return loaded;
  return { status: 200, body: priceSession(loaded.store, loaded.state as SessionState, "canceled") };
}

/** Charges the session total to the Setly card. A decline returns 402 with the issuer's logged reason. */
export async function completeSession(slug: string, sessionId: string, input: z.infer<typeof completeSessionSchema>): Promise<StoreResult> {
  const loaded = load(slug, sessionId);
  if (isResult(loaded)) return loaded;
  const session = priceSession(loaded.store, loaded.state as SessionState);
  if (session.status !== "ready_for_payment") {
    return { status: 400, body: { error: "Checkout session is not ready for payment", messages: session.messages } };
  }
  const total = sessionTotal(session);
  const authorization = await getIssuer().authorize(input.payment_data.token, loaded.store.name, total);
  if (!authorization.approved) {
    return {
      status: 402,
      body: { error: authorization.reason, messages: [{ type: "error", code: "payment_declined", content_type: "plain", content: authorization.reason }] },
    };
  }
  const orderId = orderIdFor(sessionId);
  return {
    status: 200,
    body: {
      ...priceSession(loaded.store, loaded.state as SessionState, "completed"),
      id: encodeSession(loaded.state as SessionState),
      order: { id: orderId, checkout_session_id: sessionId, permalink_url: `/api/stores/${slug}` },
    },
  };
}
