import { eq } from "drizzle-orm";
import type { Product } from "@/lib/types";
import { getEnv } from "@/lib/env";
import { normalizeQuery } from "@/lib/search/normalize";

interface CacheEntry {
  results: Product[];
  fetchedAt: string;
}

/** Process memory first, then the `search_cache` table when DATABASE_URL is set. The SerpApi quota is small. */
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

export function getMemoryCachedSearch(query: string): Product[] | null {
  return memory.get(normalizeQuery(query))?.results ?? null;
}

export async function getCachedSearch(query: string): Promise<Product[] | null> {
  const key = normalizeQuery(query);
  const hit = memory.get(key);
  if (hit) return hit.results;
  if (!databaseConfigured()) return null;
  try {
    const { getDb } = await import("@/lib/db/client");
    const { searchCache } = await import("@/lib/db/schema");
    const rows = await getDb().select().from(searchCache).where(eq(searchCache.query, key)).limit(1);
    const row = rows[0];
    if (!row || !Array.isArray(row.resultsJson)) return null;
    const results = row.resultsJson as Product[];
    memory.set(key, { results, fetchedAt: row.fetchedAt.toISOString() });
    return results;
  } catch {
    return null;
  }
}

export async function setCachedSearch(query: string, results: Product[]) {
  const key = normalizeQuery(query);
  const fetchedAt = new Date();
  memory.set(key, { results, fetchedAt: fetchedAt.toISOString() });
  if (!databaseConfigured()) return;
  try {
    const { getDb } = await import("@/lib/db/client");
    const { searchCache } = await import("@/lib/db/schema");
    await getDb()
      .insert(searchCache)
      .values({ query: key, resultsJson: results, fetchedAt })
      .onConflictDoUpdate({ target: searchCache.query, set: { resultsJson: results, fetchedAt } });
  } catch {
    // A cache write failure must never fail a search.
  }
}
