/** Turns a dollar string such as "$12.99" into integer cents. A number is already cents. */
export function normalizePriceToCents(value: string | number): number {
  if (typeof value === "number") return Math.round(value);
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  return Math.round(Number(match[0]) * 100);
}

/** Turns a dollar amount such as 12.99 (SerpApi `extracted_price`) into integer cents. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * One spelling per store so card store limits match merchant names.
 * "Walmart - Seller Co" becomes "Walmart", "Amazon.com" becomes "Amazon".
 */
export function normalizeStore(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\.com$/i, "");
}

/** Cache key for a search query. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Short stable hash (FNV-1a, base 36) for building deterministic ids. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
