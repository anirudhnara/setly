import { eq } from "drizzle-orm";
import type { Product } from "@/lib/types";
import { getEnv } from "@/lib/env";
import { normalizeQuery } from "@/lib/search/normalize";

/**
 * Every search is cached, including failures, because the SerpApi quota is small.
 * Process memory first, then the `search_cache` table when DATABASE_URL is set, so every instance shares it.
 *
 * - Results: kept until replaced.
 * - "empty": SerpApi answered with nothing usable. Kept, so the query isn't repeated.
 * - "error": timeout or network failure. Retried after 10 minutes.
 * - "quota": out of searches or a rejected key. Retried after 6 hours.
 * A failed entry has no products; the caller serves the sample catalog instead.
 */
export type CacheFailure = "empty" | "error" | "quota";

export interface CacheEntry {
  results: Product[];
  fetchedAt: string;
  failure: CacheFailure | null;
}

const RETRY_AFTER_MS: Record<CacheFailure, number | null> = {
  empty: null,
  error: 10 * 60 * 1000,
  quota: 6 * 60 * 60 * 1000,
};

const store = globalThis as typeof globalThis & { __setlySearchCache?: Map<string, CacheEntry> };
// Route handlers can load separate module copies, so the memory cache lives on globalThis.
const memory = (store.__setlySearchCache ??= new Map<string, CacheEntry>());

export function databaseConfigured() {
  try {
    return Boolean(getEnv().DATABASE_URL);
  } catch {
    return false;
  }
}

/** A failure entry past its retry window counts as a miss. */
export function isFresh(entry: CacheEntry, now = Date.now()) {
  if (!entry.failure) return true;
  const retryAfter = RETRY_AFTER_MS[entry.failure];
  return retryAfter === null || now - new Date(entry.fetchedAt).getTime() < retryAfter;
}

export async function getCachedSearch(query: string): Promise<CacheEntry | null> {
  const key = normalizeQuery(query);
  const hit = memory.get(key);
  if (hit && isFresh(hit)) return hit;
  if (!databaseConfigured()) return null;
  try {
    const { getDb } = await import("@/lib/db/client");
    const { searchCache } = await import("@/lib/db/schema");
    const rows = await getDb().select().from(searchCache).where(eq(searchCache.query, key)).limit(1);
    const row = rows[0];
    if (!row) return null;
    const entry = fromJson(row.resultsJson, row.fetchedAt.toISOString());
    if (!entry || !isFresh(entry)) return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function setCachedSearch(query: string, results: Product[], failure: CacheFailure | null = null) {
  const key = normalizeQuery(query);
  const fetchedAt = new Date();
  memory.set(key, { results, fetchedAt: fetchedAt.toISOString(), failure });
  if (!databaseConfigured()) return;
  try {
    const { getDb } = await import("@/lib/db/client");
    const { searchCache } = await import("@/lib/db/schema");
    const resultsJson = { products: results, failure };
    await getDb()
      .insert(searchCache)
      .values({ query: key, resultsJson, fetchedAt })
      .onConflictDoUpdate({ target: searchCache.query, set: { resultsJson, fetchedAt } });
  } catch {
    // A cache write failure must never fail a search.
  }
}

/** Reads both row shapes: a plain product array (older rows) and `{ products, failure }`. */
function fromJson(value: unknown, fetchedAt: string): CacheEntry | null {
  if (Array.isArray(value)) return { results: value as Product[], fetchedAt, failure: null };
  if (typeof value !== "object" || value === null) return null;
  const record = value as { products?: unknown; failure?: unknown };
  const failure = record.failure === "empty" || record.failure === "error" || record.failure === "quota" ? record.failure : null;
  return { results: Array.isArray(record.products) ? (record.products as Product[]) : [], fetchedAt, failure };
}
