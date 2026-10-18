import { getEnv } from "@/lib/env";
import type { Product } from "@/lib/types";
import { dollarsToCents } from "@/lib/search/normalize";

/**
 * Best Buy Products API (free key from developer.bestbuy.com). Real prices, ratings, and review counts
 * for computers and electronics without spending SerpApi quota. Used only to build the catalog.
 */

const TIMEOUT_MS = 10_000;
const FIELDS = "sku,name,salePrice,url,image,customerReviewAverage,customerReviewCount,condition,color,freeShipping";

interface BestBuyProduct {
  sku?: unknown;
  name?: unknown;
  salePrice?: unknown;
  url?: unknown;
  image?: unknown;
  customerReviewAverage?: unknown;
  customerReviewCount?: unknown;
  condition?: unknown;
  color?: unknown;
  freeShipping?: unknown;
}

/** Exported for tests. Drops products without a name, price, or link. */
export function bestBuyToProducts(raw: BestBuyProduct[]): Product[] {
  const products: Product[] = [];
  for (const item of raw) {
    const title = typeof item.name === "string" ? item.name.trim() : "";
    const url = typeof item.url === "string" ? item.url : "";
    const price = typeof item.salePrice === "number" ? item.salePrice : 0;
    if (!title || !url || price <= 0 || (typeof item.sku !== "number" && typeof item.sku !== "string")) continue;
    const attributes: Record<string, string | number> = {};
    if (typeof item.customerReviewAverage === "number") attributes.rating = item.customerReviewAverage;
    if (typeof item.customerReviewCount === "number") attributes.reviews = item.customerReviewCount;
    if (typeof item.color === "string" && item.color) attributes.color = item.color;
    if (item.freeShipping === true) attributes.delivery = "Free shipping";
    if (typeof item.condition === "string" && !/^new$/i.test(item.condition)) attributes.condition = "used";
    products.push({
      id: `bby_${item.sku}`,
      slotId: "",
      title,
      store: "Best Buy",
      priceCents: dollarsToCents(price),
      url,
      imageUrl: typeof item.image === "string" && item.image ? item.image : `https://placehold.co/480x360?text=${encodeURIComponent(title.slice(0, 40))}`,
      attributes,
    });
  }
  return products;
}

/** Up to 100 products matching every word of the query. */
export async function searchBestBuy(query: string): Promise<Product[]> {
  const apiKey = getEnv().BESTBUY_API_KEY;
  if (!apiKey) throw new Error("BESTBUY_API_KEY is not set");
  const terms = query.trim().split(/\s+/).map((word) => `search=${encodeURIComponent(word.replace(/[^\w-]/g, ""))}`).join("&");
  const params = new URLSearchParams({ apiKey, format: "json", show: FIELDS, pageSize: "100", sort: "customerReviewCount.dsc" });
  const response = await fetch(`https://api.bestbuy.com/v1/products(${terms})?${params.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Best Buy responded ${response.status}`);
  const body: unknown = await response.json();
  const raw = typeof body === "object" && body !== null && "products" in body && Array.isArray(body.products) ? body.products : [];
  return bestBuyToProducts(raw as BestBuyProduct[]);
}
