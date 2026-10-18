import fernwoodJson from "@/fixtures/demo-stores/fernwood-home.json";
import quillbyJson from "@/fixtures/demo-stores/quillby-lighting.json";
import tallpineJson from "@/fixtures/demo-stores/tallpine-outfitters.json";
import type { CatalogItem } from "@/lib/catalog/source";
import { categorize } from "@/lib/catalog/taxonomy";
import type { Product } from "@/lib/types";

/** A fictional store Setly hosts itself, so the protocol checkout lane has real seller endpoints to call. */
export interface DemoStore {
  slug: string;
  name: string;
  /** Sales tax in basis points (600 = 6%). */
  taxBasisPoints: number;
  /** Quotes surprise shipping above the group's buffer, to show the approval step. */
  shippingSurprise: boolean;
  items: CatalogItem[];
}

const STORES: DemoStore[] = [fernwoodJson, quillbyJson, tallpineJson].map((json) => {
  const { _note: _ignored, ...store } = json;
  return store as DemoStore;
});

export function demoStores(): DemoStore[] {
  return STORES;
}

export function demoStore(slug: string): DemoStore | null {
  return STORES.find((store) => store.slug === slug) ?? null;
}

export function demoStoreItems(): CatalogItem[] {
  return STORES.flatMap((store) => store.items);
}

/** Demo-store items in the query's category, most query words in the title first. */
export function demoStoreProducts(query: string): Product[] {
  const category = categorize(query);
  if (!category) return [];
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  return demoStoreItems()
    .filter((item) => item.category === category.label)
    .map((item, index) => ({ item, index, hits: words.filter((word) => item.title.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map(({ item }) => ({
      id: item.id,
      slotId: "",
      title: item.title,
      store: item.store,
      priceCents: item.priceCents,
      url: item.url,
      imageUrl: item.imageUrl,
      // Map product ids get the slot id prefixed, so the store's own id rides along for checkout.
      attributes: { source: "demo_store", sku: item.id, themes: item.themes.join(" "), ...(item.rating ? { rating: item.rating } : {}) },
    }));
}
