import { Landing } from "@/components/landing/landing";
import { cacheLife } from "next/cache";
import { loadCatalog, type CatalogItem } from "@/lib/catalog/source";
import { storedProducts } from "@/lib/search/find";
import "@/components/landing/landing.css";

const HERO_CATEGORIES = ["Sofa", "Floor lamp", "Rug", "Armchair", "Coffee table", "Throw blanket", "Plants", "Desk lamp", "Bookshelf"];

/** What the orbit shows, searched in the store catalog database. */
const HERO_QUERIES: Array<[label: string, query: string]> = [
  ["Sofa", "sofa"], ["Floor lamp", "floor lamp"], ["Rug", "area rug"], ["Armchair", "accent chair"], ["Coffee table", "coffee table"],
  ["Throw blanket", "throw blanket"], ["Plants", "plant"], ["Desk lamp", "desk lamp"], ["Bookshelf", "bookshelf"],
];

/**
 * One mid-priced, well-rated product per hero category for the orbit: real items from the store catalog
 * (catalog_items), not the bargain-bin extremes. Cached for an hour; without the database the placeholder
 * catalog fills in.
 */
async function showcase(): Promise<CatalogItem[]> {
  "use cache";
  cacheLife("hours");
  const fromStore = await Promise.all(
    HERO_QUERIES.map(async ([label, query]) => {
      const options = (await storedProducts(query)).sort((a, b) => a.priceCents - b.priceCents);
      const middle = options[Math.floor(options.length / 2)];
      return middle ? [{ id: middle.id, title: middle.title, store: middle.store, priceCents: middle.priceCents, url: middle.url, imageUrl: middle.imageUrl, category: label, room: "", themes: [], rating: null }] : [];
    }),
  ).then((lists) => lists.flat(), () => []);
  if (fromStore.length >= 6) return fromStore;
  const catalog = await loadCatalog();
  return HERO_CATEGORIES.flatMap((category) => {
    const options = catalog.filter((item) => item.category === category && (item.rating === null || item.rating >= 4)).sort((a, b) => a.priceCents - b.priceCents);
    const middle = options[Math.floor(options.length / 2)];
    return middle ? [middle] : [];
  });
}

export default async function LandingPage() {
  const items = await showcase();
  return (
    <div className="orbit landing-shell">
      <Landing showcase={items} />
    </div>
  );
}
