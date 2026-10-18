import zincRetailersJson from "@/fixtures/zinc-retailers.json";
import type { CheckoutLaneName, StoreRegistryEntry } from "@/lib/types";

/**
 * Which checkout lane buys from each store, decided by store name (catalog URLs are placeholders today).
 * - protocol: the fictional demo stores hosted in this app under /api/stores/<slug>.
 * - zinc: real retailers Zinc lists as verified or active.
 * - guided: everything else; a member buys it with the group card.
 */
export const DEMO_STORES = [
  { slug: "fernwood-home", name: "Fernwood Home" },
  { slug: "quillby-lighting", name: "Quillby Lighting" },
  { slug: "tallpine-outfitters", name: "Tallpine Outfitters" },
] as const;

const ZINC_SUPPORT = new Set(["verified", "active"]);

/** Lowercase letters and digits only, without a leading "the": "The Home Depot" and "home depot" match. */
export function storeKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\.com$/, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

export const STORE_REGISTRY: StoreRegistryEntry[] = [
  ...DEMO_STORES.map((store) => ({ name: store.name, lane: "protocol" as const, baseUrl: `/api/stores/${store.slug}` })),
  ...zincRetailersJson.retailers
    .filter((retailer) => ZINC_SUPPORT.has(retailer.support))
    .map((retailer) => ({ name: retailer.display_name, lane: "zinc" as const, baseUrl: `https://${retailer.base_url}` })),
];

const byKey = new Map(STORE_REGISTRY.map((entry) => [storeKey(entry.name), entry]));

export function registryEntry(store: string): StoreRegistryEntry | null {
  return byKey.get(storeKey(store)) ?? null;
}

export function laneForStore(store: string): CheckoutLaneName {
  return registryEntry(store)?.lane ?? "guided";
}

/** The demo store's slug, or null for any other store. */
export function demoStoreSlug(store: string): string | null {
  const key = storeKey(store);
  return DEMO_STORES.find((entry) => storeKey(entry.name) === key)?.slug ?? null;
}
