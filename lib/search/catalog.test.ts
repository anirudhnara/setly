import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/types";
import {
  catalogItemFromSecondhand,
  catalogItemsFromSearches,
  categorize,
  rankCatalogMatches,
  qualityScore,
  roleFor,
  shippingDaysMax,
  tagTitle,
  variantGroup,
} from "@/lib/search/catalog";

function product(id: string, title: string, attributes: Record<string, string | number> = {}): Product {
  return { id, slotId: "", title, store: "Target", priceCents: 2_999, url: `https://t.example/${id}`, imageUrl: "https://i.example", attributes };
}

describe("categorize", () => {
  it("prefers specific phrases over broad ones and the query over the title", () => {
    expect(categorize("warm light desk lamp", "Swing arm lamp")).toBe("lighting");
    expect(categorize("minimalist desk chair", "Mesh chair")).toBe("desk_chair");
    expect(categorize("cozy queen platform bed frame", "Upholstered bed")).toBe("bed_frame");
    expect(categorize("compact mini fridge", "3.1 cu ft")).toBe("mini_fridge");
    expect(categorize("small waste bin", "Step can")).toBe("trash_can");
    expect(categorize("cozy rug", "Cloud Lamp Rug")).toBe("decor");
    expect(categorize("gift ideas", "Gallery wall frames set")).toBe("frames");
    expect(categorize("6 person tent", "Dome tent")).toBe("outdoor");
    expect(categorize("baby monitor", "Video monitor")).toBe("baby");
    expect(categorize("gift ideas", "Mystery box")).toBe("other");
  });
});

describe("qualityScore", () => {
  it("weights stars by review count so a few perfect reviews don't win", () => {
    expect(qualityScore(4.6, 3_000)).toBeGreaterThan(qualityScore(5, 4));
    expect(qualityScore(4.2, 0)).toBe(4);
    expect(qualityScore(null, null)).toBe(3.5);
  });
});

describe("tags and roles", () => {
  it("finds colors, themes, and sizes, and marks bold items as anchors", () => {
    const tags = tagTitle("Mushroom Neon Lamp, Pink, 5x7 Compact");
    expect(tags).toEqual({ colors: ["pink"], themes: ["quirky"], sizes: ["5x7", "compact"] });
    expect(roleFor(tags)).toBe("anchor");
    expect(roleFor(tagTitle("Minimalist White Desk Lamp"))).toBe("neutral");
  });

  it("groups color and size variants of the same item", () => {
    expect(variantGroup("shelving", "Mainstays 5-Shelf Bookcase, Black Oak")).toBe(variantGroup("shelving", "Mainstays 5-Shelf Bookcase, White"));
    expect(variantGroup("shelving", "Mainstays 5-Shelf Bookcase")).not.toBe(variantGroup("shelving", "IKEA Billy Bookcase"));
  });

  it("reads the latest delivery day when the text gives one", () => {
    expect(shippingDaysMax("Delivery in 3-5 business days")).toBe(5);
    expect(shippingDaysMax("Get it tomorrow")).toBe(1);
    expect(shippingDaysMax("Free delivery")).toBeNull();
    expect(shippingDaysMax(null)).toBeNull();
  });
});

describe("catalogItemsFromSearches", () => {
  it("drops items under 3 stars, keeps unrated ones, and keeps the newest copy of a product", () => {
    const items = catalogItemsFromSearches([
      { query: "desk lamp", fetchedAt: new Date("2026-10-01"), products: [product("a", "Lamp", { rating: 4.5, reviews: 100 }), product("b", "Bad lamp", { rating: 2.4 })] },
      { query: "floor lamp", fetchedAt: new Date("2026-10-02"), products: [product("a", "Lamp", { rating: 4.7, reviews: 120 }), product("c", "Unrated lamp")] },
    ]);
    expect(items.map((item) => item.id).sort()).toEqual(["a", "c"]);
    expect(items.find((item) => item.id === "a")?.rating).toBe(4.7);
    expect(items.every((item) => item.category === "lighting" && item.condition === "new")).toBe(true);
  });
});

describe("secondhand items", () => {
  it("builds a used listing with the marketplace as the store", () => {
    const item = catalogItemFromSecondhand(
      { title: "IKEA Malm desk, white", category: "desk", priceCents: 4_000, url: "https://www.facebook.com/marketplace/item/1", source: "facebook_marketplace" },
      new Date("2026-10-17"),
    );
    expect(item).toMatchObject({ store: "Facebook Marketplace", condition: "used", source: "facebook_marketplace", rating: null });
    expect(item.id).toMatch(/^user_/);
  });

  it("rejects fractional cents and bad links", () => {
    const base = { title: "Desk", category: "desk", url: "https://ebay.com/itm/1", source: "ebay" } as const;
    expect(() => catalogItemFromSecondhand({ ...base, priceCents: 12.5 }, new Date())).toThrow();
    expect(() => catalogItemFromSecondhand({ ...base, priceCents: 100, url: "not a url" }, new Date())).toThrow();
  });
});

describe("rankCatalogMatches", () => {
  const lamp = (id: string, title: string, extra: Partial<Parameters<typeof catalogItemFromSecondhand>[0]> = {}) => {
    const item = catalogItemFromSecondhand(
      { title, category: "lighting", priceCents: 2_999, url: `https://shop.example/${id}`, source: "manual", store: "Target", condition: "new", ...extra },
      new Date("2026-10-17"),
    );
    return { ...item, id };
  };
  const lamps = [lamp("a", "Arc floor lamp"), lamp("b", "Tripod floor lamp"), lamp("c", "Globe floor lamps"), lamp("d", "Tall floor lamp"), lamp("e", "Mushroom desk lamp")];

  it("answers generic queries from the catalog, best match first, plural-tolerant", () => {
    const results = rankCatalogMatches("small floor lamp for dorm", lamps);
    expect(results?.map((item) => item.id)).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
    expect(results).toHaveLength(5);
    expect(results?.at(-1)?.id).toBe("e");
  });

  it("matches Gemini styles and color temperature, not just the title", () => {
    const tagged = lamps.map((item) => ({
      ...item,
      tags: { ...item.tags, styles: ["cozy"], color: { family: "cream", accent: "none", temperature: "warm", value: "light", saturation: "muted", confidence: "inferred", palette: "neutrals" } as const },
    }));
    expect(rankCatalogMatches("warm cozy lamp", tagged)).toHaveLength(5);
  });

  it("leaves specific or thin queries to a live search", () => {
    expect(rankCatalogMatches("dyson v15 detect vacuum", lamps)).toBeNull();
    expect(rankCatalogMatches("floor lamp", lamps.slice(0, 3))).toBeNull();
    expect(rankCatalogMatches("for the", lamps)).toBeNull();
    expect(rankCatalogMatches("floor lamp shade", lamps)).toBeNull();
  });

  it("skips used listings for map search", () => {
    const used = lamps.map((item) => ({ ...item, condition: "used" as const }));
    expect(rankCatalogMatches("floor lamp", used)).toBeNull();
  });
});
