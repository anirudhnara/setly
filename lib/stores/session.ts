import { bufferCents } from "@/lib/money/buffer";
import { shortHash } from "@/lib/search/normalize";
import type { DemoStore } from "@/lib/stores/catalog";

/**
 * Agentic Commerce Protocol-shaped checkout sessions for the demo stores. Pure and stateless: the session id
 * is the session itself (base64url JSON), and totals are recomputed on every read, so any server instance can
 * serve any request.
 */
export interface SessionAddress {
  name: string;
  line_one: string;
  line_two?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface SessionState {
  slug: string;
  items: { id: string; quantity: number }[];
  address: SessionAddress | null;
  createdAt: string;
}

export type SessionStatus = "not_ready_for_payment" | "ready_for_payment" | "completed" | "canceled";

export interface SessionTotal {
  type: "items_base_amount" | "subtotal" | "tax" | "fulfillment" | "total";
  display_text: string;
  amount: number;
}

export interface CheckoutSession {
  id: string;
  status: SessionStatus;
  currency: "usd";
  line_items: { id: string; item: { id: string; quantity: number }; title: string; base_amount: number; discount: number; subtotal: number; tax: number; total: number }[];
  fulfillment_address: SessionAddress | null;
  fulfillment_options: { type: "shipping"; id: string; title: string; subtotal: number; tax: number; total: number }[];
  fulfillment_option_id: string | null;
  totals: SessionTotal[];
  messages: { type: "info" | "error"; code?: string; content_type: "plain"; content: string }[];
  links: { type: "terms_of_use"; url: string }[];
  order?: { id: string; checkout_session_id: string; permalink_url: string };
}

export function encodeSession(state: SessionState): string {
  return `cs_${Buffer.from(JSON.stringify(state)).toString("base64url")}`;
}

export function decodeSession(id: string): SessionState | null {
  if (!id.startsWith("cs_")) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(id.slice(3), "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.slug !== "string" || typeof record.createdAt !== "string" || !Array.isArray(record.items)) return null;
    const items = record.items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.quantity !== "number" || !Number.isInteger(entry.quantity) || entry.quantity <= 0) return [];
      return [{ id: entry.id, quantity: entry.quantity }];
    });
    return { slug: record.slug, items, address: asAddress(record.address), createdAt: record.createdAt };
  } catch {
    return null;
  }
}

/** One shape for every address, so a session encodes the same way before and after a round trip. */
export function asAddress(value: unknown): SessionAddress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
  if (!text("line_one") || !text("postal_code")) return null;
  return {
    name: text("name"),
    line_one: text("line_one"),
    line_two: text("line_two") || null,
    city: text("city"),
    state: text("state"),
    postal_code: text("postal_code"),
    country: text("country") || "US",
  };
}

/** Prices a session from the store's catalog. Unknown item ids become an error message, never a price. */
export function priceSession(store: DemoStore, state: SessionState, status?: "completed" | "canceled"): CheckoutSession {
  const id = encodeSession(state);
  const messages: CheckoutSession["messages"] = [];
  const lineItems: CheckoutSession["line_items"] = [];
  for (const entry of state.items) {
    const item = store.items.find((candidate) => candidate.id === entry.id);
    if (!item) {
      messages.push({ type: "error", code: "invalid_item", content_type: "plain", content: `${entry.id} is not sold at ${store.name}.` });
      continue;
    }
    const base = item.priceCents * entry.quantity;
    const tax = Math.round((base * store.taxBasisPoints) / 10_000);
    lineItems.push({ id: `li_${item.id}`, item: entry, title: item.title, base_amount: base, discount: 0, subtotal: base, tax, total: base + tax });
  }
  const subtotal = lineItems.reduce((sum, line) => sum + line.subtotal, 0);
  const tax = lineItems.reduce((sum, line) => sum + line.tax, 0);
  // Quillby's "surprise": oversize shipping that lands $18 past the group's 10% buffer.
  const shipping = store.shippingSurprise && subtotal > 0 ? bufferCents(subtotal) + 1800 : 0;
  const options: CheckoutSession["fulfillment_options"] = state.address
    ? [{ type: "shipping", id: "standard", title: shipping ? "Oversize freight" : "Free standard shipping", subtotal: shipping, tax: 0, total: shipping }]
    : [];
  const ready = Boolean(state.address) && lineItems.length > 0 && !messages.some((message) => message.type === "error");
  if (!state.address) messages.push({ type: "info", content_type: "plain", content: "Add a shipping address to see delivery options." });
  const totals: SessionTotal[] = [
    { type: "items_base_amount", display_text: "Items", amount: subtotal },
    { type: "subtotal", display_text: "Subtotal", amount: subtotal },
    { type: "tax", display_text: "Tax", amount: tax },
    { type: "fulfillment", display_text: options[0]?.title ?? "Shipping", amount: state.address ? shipping : 0 },
    { type: "total", display_text: "Total", amount: subtotal + tax + (state.address ? shipping : 0) },
  ];
  return {
    id,
    status: status ?? (ready ? "ready_for_payment" : "not_ready_for_payment"),
    currency: "usd",
    line_items: lineItems,
    fulfillment_address: state.address,
    fulfillment_options: options,
    fulfillment_option_id: options[0]?.id ?? null,
    totals,
    messages,
    links: [{ type: "terms_of_use", url: `/api/stores/${store.slug}` }],
  };
}

export function sessionTotal(session: CheckoutSession) {
  return session.totals.find((total) => total.type === "total")?.amount ?? 0;
}

/** A stable order id for a completed session. */
export function orderIdFor(sessionId: string) {
  return `ord_${shortHash(sessionId)}`;
}
