import { describe, expect, it } from "vitest";
import { fixtureMapForPrompt } from "@/lib/ai/fixture-map";
import { normalizePriceToCents, normalizeStore } from "@/lib/search/normalize";
import { findSlotOption, getSlotOptions, mergeOptions } from "@/lib/search/options";
import { searchCatalog, toProducts } from "@/lib/search/serpapi";

describe("normalize", () => {
  it("turns prices into integer cents and store names into one spelling", () => {
    expect(normalizePriceToCents("$1,299.99")).toBe(129_999);
    expect(normalizeStore("Walmart - Seller Co")).toBe("Walmart");
    expect(normalizeStore("Amazon.com")).toBe("Amazon");
    expect(normalizeStore("  Best   Buy ")).toBe("Best Buy");
  });
});

describe("SerpApi results", () => {
  it("uses extracted_price as dollars, drops unusable and used results, and dedupes", () => {
    const products = toProducts([
      { title: "Navy sofa", source: "Wayfair", link: "https://w.example", extracted_price: 549.99, product_id: "123" },
      { title: "Navy sofa", source: "Wayfair", link: "https://w.example/2", extracted_price: 549.99 },
      { title: "No price", source: "Target", link: "https://t.example" },
      { title: "Used sofa", source: "eBay", link: "https://e.example", extracted_price: 100, second_hand_condition: "used" },
      { title: "Linen sofa", source: "Walmart - Seller", product_link: "https://g.example", price: "$1,099.00" },
    ]);
    expect(products.map((product) => [product.title, product.store, product.priceCents])).toEqual([
      ["Navy sofa", "Wayfair", 54_999],
      ["Linen sofa", "Walmart", 109_900],
    ]);
    expect(products[0].id).toBe("serp_123");
  });
});

describe("catalog search", () => {
  it("matches the closest need and returns nothing for unknown items", () => {
    expect(searchCatalog("navy 3 seat sofa")[0].title).toContain("sofa");
    expect(searchCatalog("coffee table").every((product) => !/maker|press/i.test(product.title))).toBe(true);
    expect(searchCatalog("isobutane fuel").some((product) => product.attributes.fuelType === "isobutane")).toBe(true);
    expect(searchCatalog("quantum flux capacitor")).toEqual([]);
  });
});

describe("slot options", () => {
  it("puts the chosen product first, without repeating it", async () => {
    const map = fixtureMapForPrompt("living room", { budgetCents: null, memberCount: 4, doorWidthIn: null, groupId: "" });
    const sofa = map.slots.find((slot) => slot.need === "Sofa")!;
    const options = await getSlotOptions(sofa.id);
    expect(options?.[0].id).toBe(sofa.chosenProductId);
    expect(options?.filter((product) => product.title === "Harlow 3-seat sofa")).toHaveLength(1);
    expect(options?.every((product) => product.slotId === sofa.id)).toBe(true);
    expect(options?.some((product) => Number(product.attributes.depthIn) <= 32)).toBe(true);
    const pick = options![1];
    expect(await findSlotOption(sofa.id, pick.id)).toEqual(pick);
  });

  it("finds starter fixture slots by id and returns null for unknown slots", async () => {
    expect((await getSlotOptions("slot_rug"))?.[0].id).toBe("prod_rug");
    expect((await getSlotOptions("slot_rug"))!.length).toBeGreaterThan(1);
    expect(await getSlotOptions("slot_nope")).toBeNull();
  });

  it("dedupes by store and title", () => {
    const base = { slotId: "s", url: "", imageUrl: "", attributes: {} };
    const merged = mergeOptions({ ...base, id: "a", title: "Lamp", store: "IKEA", priceCents: 1 }, [{ ...base, id: "b", title: "lamp", store: "ikea", priceCents: 1 }, { ...base, id: "c", title: "Lamp 2", store: "IKEA", priceCents: 2 }]);
    expect(merged.map((product) => product.id)).toEqual(["a", "c"]);
  });
});
