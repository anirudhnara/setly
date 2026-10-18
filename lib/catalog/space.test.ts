import { describe, expect, it } from "vitest";
import { fallbackIdeas } from "@/lib/ai/suggest";
import { INNER, OUTER, weightForDistance } from "@/lib/catalog/space";
import { parseVibeLine, sortByVibe, vibeLine, vibeScore } from "@/lib/catalog/vibes";
import { catalogProducts, findProducts, pickStoredProducts, rankStoredItems, tagWords } from "@/lib/search/find";
import type { CatalogItem as StoredItem } from "@/lib/search/catalog";

describe("vibe space", () => {
  it("maps distance from you to priority", () => {
    expect(weightForDistance(INNER)).toBe(1);
    expect(weightForDistance(OUTER)).toBe(0);
    expect(weightForDistance((INNER + OUTER) / 2)).toBeCloseTo(0.5);
  });
});

describe("vibe line", () => {
  it("round-trips through the saved prompt", () => {
    const line = vibeLine({ Minimal: 0.9, Wood: 0.82, Cozy: 0.5, "Bold color": 0.05, Metal: 0.3 });
    expect(line).toBe("Vibe: Minimal 90%, Wood 82%, Cozy 50%. Avoid: Bold color.");
    expect(parseVibeLine(`Living room for 3. Budget $900. ${line} Split across the group.`)).toEqual({ Minimal: 0.9, Wood: 0.82, Cozy: 0.5, "Bold color": 0 });
  });

  it("ranks products toward what was pulled close and away from what was pushed off", () => {
    const items = [
      { title: "Bright red velvet sofa", priceCents: 50_000 },
      { title: "Minimal white oak sofa", priceCents: 60_000 },
      { title: "Grey sofa", priceCents: 40_000 },
    ];
    const ranked = sortByVibe(items, { Minimal: 0.95, Wood: 0.9, "Bold color": 0 });
    expect(ranked[0].title).toBe("Minimal white oak sofa");
    expect(ranked[2].title).toBe("Bright red velvet sofa");
    expect(vibeScore("anything", { "Budget-smart": 1 }, 0)).toBeGreaterThan(vibeScore("anything", { "Budget-smart": 1 }, 1));
  });
});

describe("catalog-first search", () => {
  it("serves catalog items for known categories, query words first", async () => {
    const results = await catalogProducts("white oak coffee table");
    expect(results.length).toBeGreaterThan(2);
    expect(results.every((product) => product.attributes.source === "catalog" || product.attributes.source === "demo_store")).toBe(true);
    expect(results[0].title.toLowerCase()).toMatch(/white|oak/);
    expect(await catalogProducts("4 person dome tent")).toEqual([]);
  });

  it("leads with the demo stores so a plan has protocol-lane stores", async () => {
    expect((await catalogProducts("cozy sofa"))[0]?.store).toBe("Fernwood Home");
    expect((await catalogProducts("floor lamp"))[0]?.store).toBe("Quillby Lighting");
    expect((await catalogProducts("camp table"))[0]?.store).toBe("Tallpine Outfitters");
    const sofas = await catalogProducts("sofa");
    expect(sofas.some((product) => product.store !== "Fernwood Home")).toBe(true);
  });

  it("nudges catalog results toward the vibe without overriding the best match", async () => {
    const minimal = await findProducts("sofa", { Minimal: 1, Cozy: 0 });
    const cozy = await findProducts("sofa", { Cozy: 1, Minimal: 0 });
    expect(minimal.map((item) => item.id)).not.toEqual(cozy.map((item) => item.id));
    const sherpa = (list: typeof cozy) => list.findIndex((item) => /sherpa/i.test(item.title));
    expect(sherpa(cozy)).toBeLessThan(sherpa(minimal));
  });

  it("proposes branch ideas the set doesn't have yet when Gemini is off", () => {
    const ideas = fallbackIdeas("Living room", ["Sofa", "Rug", "Floor lamp"], ["Minimal", "Budget-smart"]);
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.some((idea) => idea.need === "Sofa")).toBe(false);
    expect(ideas[0].searchQuery.startsWith("minimal ")).toBe(true);
  });
});

describe("vibe labels from the model", () => {
  it("accepts a copied group suffix and 'and' for '&'", async () => {
    const { vibeFor } = await import("@/lib/catalog/vibes");
    expect(vibeFor("Cozy (Style)")?.label).toBe("Cozy");
    expect(vibeFor("black and white")?.label).toBe("Black & white");
    expect(vibeFor("Cyberpunk")).toBeNull();
  });
});

describe("store catalog ranking", () => {
  const item = (id: string, title: string, priceCents: number, qualityScore: number, tags: Partial<StoredItem["tags"]> = {}): StoredItem => ({
    id, title, priceCents, qualityScore, category: "seating", store: "Target", url: `https://example.com/${id}`, imageUrl: "", condition: "new", source: "search",
    rating: 4.5, reviewCount: 100, delivery: null, shippingDaysMax: null, variantGroup: id, role: "neutral",
    tags: { colors: [], themes: [], sizes: [], ...tags }, scores: { usability: 4, practicality: 4, health: 3, popularity: 0.5 }, attributes: {}, searchQuery: null, addedBy: null, fetchedAt: new Date(0),
  });

  it("keeps the thing asked for, skips add-ons named after it, and leaves room for cheaper picks", () => {
    const items = [
      item("cover", "KARLSTAD Sofa Cover Natural Linen", 9000, 4.9),
      item("legs", "Velvet Sofa with Oak Legs", 60000, 4.4),
      item("chair", "Accent Chair", 15000, 4.8),
      ...Array.from({ length: 8 }, (_, index) => item(`sofa${index}`, `Linen Sofa ${index}`, 90000 - index * 10000, 4.6 - index * 0.01)),
    ];
    const ranked = pickStoredProducts("warm linen sofa", [...items, item("plans", "DIY Modern Sofa Plans", 380, 4.9), item("mini", "Linen Sofa Miniature", 586, 4.9)]).map((entry) => entry.id);
    expect(ranked).not.toContain("cover");
    expect(ranked).not.toContain("chair");
    expect(ranked).not.toContain("plans");
    expect(ranked).not.toContain("mini");
    expect(ranked).toHaveLength(8);
    // "with oak legs" is a sofa, not an add-on.
    expect(rankStoredItems("sofa", items.slice(0, 2)).map((entry) => entry.id)).toEqual(["legs"]);
    // The cheapest matching sofa makes the list even though five pricier ones rank above it.
    expect(ranked).toContain("sofa7");
    expect(rankStoredItems("sofa cover", items).map((entry) => entry.id)).toContain("cover");
  });

  it("turns Gemini color and style tags into words the vibe matchers know", () => {
    const words = tagWords({ colors: [], themes: [], sizes: [], styles: ["mid_century", "minimalist"], color: { value: "medium", accent: "none", family: "wood", palette: "earth_tones", confidence: "stated", saturation: "muted", temperature: "warm" } } as StoredItem["tags"]);
    expect(words).toMatch(/mid-century/);
    expect(words).toMatch(/minimal/);
    expect(words).toMatch(/earthy/);
    expect(sortByVibe([{ title: "Plain sofa", priceCents: 1, themes: "" }, { title: "Plain sofa", priceCents: 1, themes: words }], { Earthy: 1, Vintage: 0.9 }, (entry) => entry.themes)[0].themes).toBe(words);
  });
});


describe("live search relevance", () => {
  const product = (id: string, title: string) => ({ id, slotId: "", title, store: "Target", priceCents: 2000, url: `https://example.com/${id}`, imageUrl: "", attributes: {} });

  it("keeps the thing asked for, not lookalikes or add-ons", async () => {
    const { relevantProducts } = await import("@/lib/search/find");
    const pillows = [product("t1", "Throw Pillow Cover 18x18"), product("t2", "Velvet Throw Pillow"), product("b1", "Standard Bed Pillow 2 Pack"), product("b2", "Down Alternative Bed Pillow"), product("b3", "Cooling Bed Pillows Set of 2")];
    expect(relevantProducts("bed pillow", pillows).map((item) => item.id)).toEqual(["b1", "b2", "b3"]);
    const organizers = [product("bag", "Cotton Gusseted Coat Bag"), product("o1", "Hanging Closet Organizer 6 Shelves"), product("o2", "Closet Organizer System")];
    expect(relevantProducts("hanging closet organizer", organizers).map((item) => item.id)).toEqual(["o1", "o2"]);
  });
});
