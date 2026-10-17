import { eq } from "drizzle-orm";
import { loadApartmentMap, loadCampingMap, loadGroupState } from "@/lib/fixtures/sample";
import type { MapData, Product, Slot } from "@/lib/types";
import { databaseConfigured } from "@/lib/search/cache";
import { searchProducts } from "@/lib/search/serpapi";

/**
 * Options for a slot's shuffle stack. The chosen product comes first, then search results for the slot.
 *
 * A slot is found, in order, in: the registry of maps this server generated, the database (when
 * DATABASE_URL is set), then the starter fixtures. Option ids are `${slotId}_${sourceId}` so they're unique
 * per slot and the same on every call, which lets the slot PATCH route look an option up again with
 * `findSlotOption` before saving it.
 */
const MAX_OPTIONS = 8;

export interface SlotInfo {
  slotId: string;
  need: string;
  searchQuery: string;
  chosen: Product | null;
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
  const results = attachToSlot(await searchProducts(info.searchQuery), slotId);
  return mergeOptions(info.chosen, results);
}

/** Looks up one option by id, so a chosen option can be saved as a product row. */
export async function findSlotOption(slotId: string, productId: string): Promise<Product | null> {
  const options = await getSlotOptions(slotId);
  return options?.find((product) => product.id === productId) ?? null;
}

async function resolveSlot(slotId: string): Promise<SlotInfo | null> {
  return registry.get(slotId) ?? (await slotFromDatabase(slotId)) ?? slotFromFixtures(slotId);
}

async function slotFromDatabase(slotId: string): Promise<SlotInfo | null> {
  if (!databaseConfigured()) return null;
  try {
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const db = getDb();
    const [slot] = await db.select().from(schema.slots).where(eq(schema.slots.id, slotId)).limit(1);
    if (!slot) return null;
    let chosen: Product | null = null;
    if (slot.chosenProductId) {
      const [row] = await db.select().from(schema.products).where(eq(schema.products.id, slot.chosenProductId)).limit(1);
      chosen = row ?? null;
    }
    const savedQuery = chosen?.attributes.searchQuery;
    return { slotId, need: slot.need, searchQuery: typeof savedQuery === "string" && savedQuery ? savedQuery : slot.need, chosen };
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
    return { slotId, need: slot.need, searchQuery: slot.need, chosen };
  }
  return null;
}

