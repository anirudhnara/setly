/** Instructions for map generation. The model must not invent prices. */

export const MAP_SYSTEM_PROMPT = `You plan a shared purchase as zones, slots, links, and rules.
Return structure only. Do not include prices, stores, or product URLs.
Each slot needs a searchQuery that a shopping search can run later. Prices come from that search, never from you.`;

export function buildMapPrompt(prompt: string, budgetCents?: number) {
  const budget = budgetCents === undefined ? "No budget was given." : `Budget ceiling: ${budgetCents} cents.`;
  return `${MAP_SYSTEM_PROMPT}\n\nGroup prompt: ${prompt}\n${budget}`;
}

export function buildPastePrompt(text: string) {
  return `${MAP_SYSTEM_PROMPT}\n\nTurn this pasted list into the same structure:\n${text}`;
}
