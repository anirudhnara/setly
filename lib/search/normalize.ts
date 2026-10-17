/** Turns a dollar string such as "$12.99" into integer cents. A number is already cents. */
export function normalizePriceToCents(value: string | number): number {
  if (typeof value === "number") return Math.round(value);
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  return Math.round(Number(match[0]) * 100);
}

export function normalizeStore(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
