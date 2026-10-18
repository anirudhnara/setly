import { describe, expect, it } from "vitest";
import { bestBuyToProducts } from "@/lib/search/bestbuy";
import { catalogItemsFromCsv, parseCsv } from "@/lib/search/catalog-import";
import { catalogItemFromProduct } from "@/lib/search/catalog";
import { ebayToProducts } from "@/lib/search/ebay";
import { toProducts } from "@/lib/search/serpapi";

describe("SerpApi catalog harvest", () => {
  it("keeps every result and marks used listings when asked, without changing the map search default", () => {
    const raw = Array.from({ length: 12 }, (_, index) => ({ title: `Lamp ${index}`, source: "Target", link: `https://t.example/${index}`, extracted_price: 20 }));
    raw.push({ title: "Used lamp", source: "eBay", link: "https://e.example", extracted_price: 9, second_hand_condition: "used" } as (typeof raw)[number]);
    expect(toProducts(raw)).toHaveLength(8);
    const all = toProducts(raw, { limit: Infinity, keepUsed: true });
    expect(all).toHaveLength(13);
    const used = catalogItemFromProduct(all[12], "floor lamp", new Date());
    expect(used?.condition).toBe("used");
  });
});

describe("Best Buy", () => {
  it("turns API products into products with ratings, in cents", () => {
    const products = bestBuyToProducts([
      { sku: 123, name: "Logitech MX Keys", salePrice: 99.99, url: "https://bestbuy.com/123", image: "https://img/1", customerReviewAverage: 4.7, customerReviewCount: 2_100, freeShipping: true },
      { sku: 124, name: "No price" },
      { sku: 125, name: "Open box mouse", salePrice: 19.5, url: "https://bestbuy.com/125", condition: "Refurbished" },
    ]);
    expect(products.map((product) => [product.id, product.store, product.priceCents])).toEqual([
      ["bby_123", "Best Buy", 9_999],
      ["bby_125", "Best Buy", 1_950],
    ]);
    expect(products[0].attributes).toEqual({ rating: 4.7, reviews: 2_100, delivery: "Free shipping" });
    expect(products[1].attributes.condition).toBe("used");
  });
});

describe("eBay", () => {
  it("keeps USD listings and records condition and seller feedback", () => {
    const products = ebayToProducts([
      { itemId: "v1|1|0", title: "IKEA Micke desk", price: { value: "45.00", currency: "USD" }, itemWebUrl: "https://ebay.com/itm/1", condition: "Used", seller: { feedbackPercentage: "99.2" } },
      { itemId: "v1|2|0", title: "Desk", price: { value: "40.00", currency: "GBP" }, itemWebUrl: "https://ebay.co.uk/itm/2" },
    ]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: "ebay_v1_1_0", store: "eBay", priceCents: 4_500 });
    expect(products[0].attributes).toMatchObject({ condition: "used", sellerFeedbackPercent: 99.2 });
  });
});

describe("CSV import", () => {
  it("parses quoted fields", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("imports good rows, reports bad ones by line, and needs a store for manual picks", () => {
    const csv = [
      "title,category,price,url,store,source",
      'IKEA FADO lamp,lighting,$29.99,https://www.ikea.com/fado,IKEA,',
      "Used Malm desk,desk,40,https://www.facebook.com/marketplace/item/9,,facebook_marketplace",
      "No store,lighting,10,https://x.example,,",
      "Bad price,lighting,free,https://x.example/2,IKEA,",
    ].join("\n");
    const { items, errors } = catalogItemsFromCsv(csv, new Date("2026-10-17"));
    expect(items.map((item) => [item.title, item.store, item.priceCents, item.condition, item.source])).toEqual([
      ["IKEA FADO lamp", "IKEA", 2_999, "new", "manual"],
      ["Used Malm desk", "Facebook Marketplace", 4_000, "used", "facebook_marketplace"],
    ]);
    expect(errors.map((error) => error.line)).toEqual([4, 5]);
    expect(errors[0].message).toContain("store");
  });
});
