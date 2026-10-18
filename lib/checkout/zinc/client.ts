import { z } from "zod";
import { zincOrderSchema, zincRetailerCheckSchema, ZincRequestError, type ZincOrder, type ZincOrderRequest } from "@/lib/checkout/zinc/types";

/** Zinc v2 REST client. The key is passed in and never logged. */
const BASE_URL = "https://api.zinc.com";
const TIMEOUT_MS = 8_000;

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit & { key?: string } = {}): Promise<T> {
  const { key, ...rest } = init;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...rest.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = json && typeof json === "object" && "message" in json && typeof json.message === "string" ? json.message : `Zinc returned ${response.status}`;
    throw new ZincRequestError(message, response.status);
  }
  return schema.parse(json);
}

export function createZincOrder(key: string, body: ZincOrderRequest): Promise<ZincOrder> {
  return call("/orders", zincOrderSchema, { method: "POST", body: JSON.stringify(body), key });
}

export function getZincOrder(key: string, id: string): Promise<ZincOrder> {
  return call(`/orders/${encodeURIComponent(id)}`, zincOrderSchema, { key });
}

export async function cancelZincOrder(key: string, id: string): Promise<void> {
  await call(`/orders/${encodeURIComponent(id)}/cancel`, z.unknown(), { method: "POST", key });
}

/** No auth needed. */
export function checkZincRetailer(url: string) {
  return call(`/retailers/check?url=${encodeURIComponent(url)}&country=US`, zincRetailerCheckSchema);
}
