import catalogJson from "@/fixtures/space-catalog.json";

/**
 * The item catalog behind the 3D space. Today it's a placeholder built from real cached searches
 * (scripts/build-space-catalog.ts). When the pre-loaded store database is ready, replace `loadCatalog` with a read
 * from it and map each row with `toCatalogItem`. Everything else (space building, Gemini tuning, building a set)
 * only depends on this shape. Prices are integer cents and come from the data, never from the model.
 */
export interface CatalogItem {
  id: string;
  title: string;
  store: string;
  priceCents: number;
  url: string;
  imageUrl: string;
  /** What the item is ("Sofa"). One of lib/catalog/taxonomy CATEGORIES when possible. */
  category: string;
  /** Where it goes ("Living room"). */
  room: string;
  /** How it feels ("Cozy", "Minimal"). */
  themes: string[];
  rating: number | null;
}

/** The shape we expect from the pre-loaded database. Extra columns are ignored. */
export interface ExternalItemRow {
  id: string | number;
  name: string;
  store: string;
  price: number | string;
  link: string;
  image?: string | null;
  category?: string | null;
  room?: string | null;
  tags?: string[] | string | null;
  rating?: number | null;
}

let cache: CatalogItem[] | null = null;

export async function loadCatalog(): Promise<CatalogItem[]> {
  cache ??= (catalogJson as unknown as { items: CatalogItem[] }).items;
  return cache;
}

export async function findItems(ids: string[]): Promise<CatalogItem[]> {
  const wanted = new Set(ids);
  return (await loadCatalog()).filter((item) => wanted.has(item.id));
}

/** Maps one pre-loaded database row. Dollar prices become integer cents here, once. */
export function toCatalogItem(row: ExternalItemRow, tag: (text: string) => { category: string; room: string; themes: string[] }): CatalogItem | null {
  const dollars = typeof row.price === "number" ? row.price : Number(String(row.price).replace(/[^0-9.]/g, ""));
  if (!row.name || !row.link || !Number.isFinite(dollars) || dollars <= 0) return null;
  const tags = Array.isArray(row.tags) ? row.tags.join(" ") : (row.tags ?? "");
  const tagged = tag(`${row.category ?? ""} ${row.name} ${tags}`);
  return {
    id: `db_${row.id}`,
    title: row.name,
    store: row.store,
    priceCents: Math.round(dollars * 100),
    url: row.link,
    imageUrl: row.image ?? "",
    category: row.category ?? tagged.category,
    room: row.room ?? tagged.room,
    themes: tagged.themes,
    rating: row.rating ?? null,
  };
}
