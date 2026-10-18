import { loadApartmentMap, loadCampingMap, loadGroupState } from "@/lib/fixtures/sample";
import type { MapData, Product, Slot } from "@/lib/types";
import { parseVibeLine, type VibeWeights } from "@/lib/catalog/vibes";
import { findProducts } from "@/lib/search/find";
import { searchProducts } from "@/lib/search/serpapi";

/**
 * Options for a slot's shuffle stack. The chosen product comes first, then search results for the slot.
 *
 * Nothing here depends on one server's memory, so any instance (or a restart) gives the same stack:
 * 1. Backend 1's ledger store (Postgres when DATABASE_URL is set) for saved slots.
 * 2. This instance's registry of maps it just generated (fast path, exact search query).
 * 3. The search query encoded in a generated slot id: `slot_<query>--<suffix>`.
 * 4. The starter fixtures (a generated copy keeps the fixture id before "__").
 * Search results are cached (Postgres when configured), so option ids `${slotId}_${sourceId}` stay the same
 * across calls, which lets the slot PATCH route look an option up again with `findSlotOption` before saving it.
 */
const MAX_OPTIONS = 8;

export interface SlotInfo {
  slotId: string;
  need: string;
  searchQuery: string;
  chosen: Product | null;
  /** The group's vibe, so alternatives are ordered the way the set was. */
  vibes?: VibeWeights;
  /** Sample-fixture slots keep sample alternatives: those carry the dimensions the door-fit demo checks. */
  sample?: boolean;
}

const store = globalThis as typeof globalThis & { __setlySlotRegistry?: Map<string, SlotInfo> };
// Route handlers can load separate module copies, so the registry lives on globalThis.
const registry = (store.__setlySlotRegistry ??= new Map<string, SlotInfo>());

/** Remember the search query and chosen product for each slot of a generated map. */
export function registerMapSlots(map: MapData, searchQueries: Map<string, string> = new Map()) {
  for (const slot of map.slots) {
    registry.set(slot.id, {
      slotId: slot.id,
      need: slot.need,
      searchQuery: searchQueries.get(slot.id) ?? slot.need,
      chosen: map.products.find((product) => product.id === slot.chosenProductId) ?? null,
    });
  }
}

/** Gives search results slot-scoped ids and the slot's id. */
export function attachToSlot(products: Product[], slotId: string): Product[] {
  return products.map((product) => ({ ...product, id: `${slotId}_${product.id}`, slotId }));
}

/** Chosen product first, then the rest without repeating the same store and title. */
export function mergeOptions(chosen: Product | null, results: Product[]): Product[] {
  const key = (product: Product) => `${product.store.toLowerCase()}|${product.title.toLowerCase()}`;
  const seen = new Set<string>();
  const merged: Product[] = [];
  for (const product of chosen ? [chosen, ...results] : results) {
    if (seen.has(key(product)) || seen.has(`id:${product.id}`)) continue;
    seen.add(key(product));
    seen.add(`id:${product.id}`);
    merged.push(product);
    if (merged.length >= MAX_OPTIONS) break;
  }
  return merged;
}

/** Options for a slot, or null when the slot isn't known anywhere. */
export async function getSlotOptions(slotId: string): Promise<Product[] | null> {
  const info = await resolveSlot(slotId);
  if (!info) return null;
  // Decided by the slot, never by instance memory, so every server instance builds the same stack.
  const sample = info.sample || slotId.includes("__");
  const found = sample ? await searchProducts(info.searchQuery) : await findProducts(info.searchQuery, info.vibes ?? {});
  const results = attachToSlot(found, slotId);
  return mergeOptions(info.chosen, results);
}

/** Looks up one option by id, so a chosen option can be saved as a product row. */
export async function findSlotOption(slotId: string, productId: string): Promise<Product | null> {
  const options = await getSlotOptions(slotId);
  return options?.find((product) => product.id === productId) ?? null;
}

async function resolveSlot(slotId: string): Promise<SlotInfo | null> {
  return (await slotFromLedger(slotId)) ?? registry.get(slotId) ?? slotFromId(slotId) ?? slotFromFixtures(slotId);
}

/** Generated slot ids carry their search query, so options survive restarts and other instances. */
export function generatedSlotId(searchQuery: string, unique: string) {
  const slug = searchQuery.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "item";
  return `slot_${slug}--${unique}`;
}

export function searchQueryFromSlotId(slotId: string): string | null {
  const match = slotId.match(/^slot_([a-z0-9_]+)--[a-z0-9]+$/);
  return match ? match[1].replace(/_/g, " ") : null;
}

function slotFromId(slotId: string): SlotInfo | null {
  const searchQuery = searchQueryFromSlotId(slotId);
  if (!searchQuery) return null;
  return { slotId, need: searchQuery, searchQuery, chosen: null };
}

/** Saved slots, through Backend 1's ledger store. The chosen product carries the search query that found it. */
async function slotFromLedger(slotId: string): Promise<SlotInfo | null> {
  try {
    const { getLedgerStore } = await import("@/lib/db/memory-store");
    const state = await (await getLedgerStore()).findBySlotId(slotId);
    const slot = state?.map.slots.find((item) => item.id === slotId);
    if (!state || !slot) return null;
    const chosen = state.map.products.find((product) => product.id === slot.chosenProductId) ?? null;
    const savedQuery = chosen?.attributes.searchQuery;
    const searchQuery = typeof savedQuery === "string" && savedQuery ? savedQuery : (searchQueryFromSlotId(slotId) ?? slot.need);
    return { slotId, need: slot.need, searchQuery, chosen, vibes: parseVibeLine(state.group.prompt) };
  } catch {
    return null;
  }
}

/** Starter fixture slots. A generated copy of a fixture slot keeps the fixture id before "__". */
function slotFromFixtures(slotId: string): SlotInfo | null {
  const baseId = slotId.split("__")[0];
  for (const map of [loadGroupState().map, loadApartmentMap(), loadCampingMap()]) {
    const slot: Slot | undefined = map.slots.find((item) => item.id === baseId);
    if (!slot) continue;
    const product = map.products.find((item) => item.id === slot.chosenProductId);
    const chosen = product ? { ...product, id: baseId === slotId ? product.id : `${slotId}_${product.id}`, slotId } : null;
    return { slotId, need: slot.need, searchQuery: slot.need, chosen, sample: true };
  }
  return null;
}

