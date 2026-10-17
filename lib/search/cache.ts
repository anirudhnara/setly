import type { Product } from "@/lib/types";

interface CacheEntry {
  results: Product[];
  fetchedAt: string;
}

const memory = new Map<string, CacheEntry>();

export function getCachedSearch(query: string): Product[] | null {
  return memory.get(query.trim().toLowerCase())?.results ?? null;
}

export function setCachedSearch(query: string, results: Product[]) {
  memory.set(query.trim().toLowerCase(), { results, fetchedAt: new Date().toISOString() });
}
