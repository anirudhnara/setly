import { getEnv } from "@/lib/env";
import type { Product } from "@/lib/types";
import { normalizePriceToCents } from "@/lib/search/normalize";

/**
 * eBay Browse API (free keys from developer.ebay.com). Fixed-price listings, new and used, for the catalog.
 * Listings have no product rating; seller feedback goes in attributes instead.
 */

const TIMEOUT_MS = 10_000;

interface EbayItemSummary {
  itemId?: unknown;
  title?: unknown;
  price?: { value?: unknown; currency?: unknown };
  itemWebUrl?: unknown;
  image?: { imageUrl?: unknown };
  condition?: unknown;
  seller?: { feedbackPercentage?: unknown; feedbackScore?: unknown };
  shippingOptions?: { shippingCost?: { value?: unknown } }[];
}

/** Exported for tests. Keeps US dollar listings with a title, price, and link. */
export function ebayToProducts(raw: EbayItemSummary[]): Product[] {
  const products: Product[] = [];
  for (const item of raw) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const url = typeof item.itemWebUrl === "string" ? item.itemWebUrl : "";
    const value = item.price?.value;
    const priceCents = typeof value === "string" || typeof value === "number" ? normalizePriceToCents(String(value)) : 0;
    if (!title || !url || priceCents <= 0 || item.price?.currency !== "USD" || typeof item.itemId !== "string") continue;
    const attributes: Record<string, string | number> = {};
    const condition = typeof item.condition === "string" ? item.condition : "";
    attributes.condition = /^new$/i.test(condition) ? "new" : "used";
    if (condition) attributes.listingCondition = condition;
    const feedback = Number(item.seller?.feedbackPercentage);
    if (Number.isFinite(feedback)) attributes.sellerFeedbackPercent = feedback;
    const shipping = item.shippingOptions?.[0]?.shippingCost?.value;
    if (shipping !== undefined && Number(shipping) === 0) attributes.delivery = "Free shipping";
    const imageUrl = typeof item.image?.imageUrl === "string" ? item.image.imageUrl : "";
    products.push({
      id: `ebay_${item.itemId.replace(/[^\w-]/g, "_")}`,
      slotId: "",
      title,
      store: "eBay",
      priceCents,
      url,
      imageUrl: imageUrl || `https://placehold.co/480x360?text=${encodeURIComponent(title.slice(0, 40))}`,
      attributes,
    });
  }
  return products;
}

async function accessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`eBay token request responded ${response.status}`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("access_token" in body) || typeof body.access_token !== "string") {
    throw new Error("eBay returned no access token");
  }
  return body.access_token;
}

let cachedToken: string | undefined;

/** Up to 100 fixed-price listings. `condition: "used"` limits to used and refurbished items. */
export async function searchEbay(query: string, options: { condition?: "used" } = {}): Promise<Product[]> {
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET } = getEnv();
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not set");
  cachedToken ??= await accessToken(EBAY_CLIENT_ID, EBAY_CLIENT_SECRET);
  const filters = ["buyingOptions:{FIXED_PRICE}", "priceCurrency:USD", ...(options.condition === "used" ? ["conditions:{USED}"] : [])];
  const params = new URLSearchParams({ q: query, limit: "100", filter: filters.join(",") });
  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${cachedToken}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`eBay responded ${response.status}`);
  const body: unknown = await response.json();
  const raw = typeof body === "object" && body !== null && "itemSummaries" in body && Array.isArray(body.itemSummaries) ? body.itemSummaries : [];
  return ebayToProducts(raw as EbayItemSummary[]);
}
