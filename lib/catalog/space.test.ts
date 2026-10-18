import { describe, expect, it } from "vitest";
import { cleanSeed, rulesSeed } from "@/lib/ai/vibes";
import { fallbackIdeas } from "@/lib/ai/suggest";
import { INNER, OUTER, weightForDistance } from "@/lib/catalog/space";
import { parseVibeLine, sortByVibe, vibeLine, vibeScore } from "@/lib/catalog/vibes";
import { catalogProducts, findProducts } from "@/lib/search/find";

describe("vibe space", () => {
  it("maps distance from you to priority", () => {
    expect(weightForDistance(INNER)).toBe(1);
    expect(weightForDistance(OUTER)).toBe(0);
    expect(weightForDistance((INNER + OUTER) / 2)).toBeCloseTo(0.5);
  });

  it("keeps only known vibes from the model, clamped, without duplicates", () => {
    const vibes = cleanSeed([{ label: "minimal", weight: 2 }, { label: "Minimal", weight: 0.1 }, { label: "Cyberpunk", weight: 1 }, { label: "Wood", weight: -3, why: "Oak floors already" }]);
    expect(vibes.map((vibe) => [vibe.label, vibe.weight])).toEqual([["Minimal", 1], ["Wood", 0]]);
    expect(vibes[1].hint).toBe("Oak floors already");
  });

  it("seeds sensibly without Gemini: camping skips velvet, words in the request start closer", () => {
    const camping = rulesSeed("camping trip for 6 on a tight budget");
    expect(camping.some((vibe) => vibe.label === "Velvet & plush")).toBe(false);
    expect(camping.find((vibe) => vibe.label === "Budget-smart")?.weight).toBe(0.8);
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
    expect(results.every((product) => product.attributes.source === "catalog")).toBe(true);
    expect(results[0].title.toLowerCase()).toMatch(/white|oak/);
    expect(await catalogProducts("4 person dome tent")).toEqual([]);
  });

  it("orders catalog results by vibe", async () => {
    const minimal = await findProducts("sofa", { Minimal: 1, Cozy: 0 });
    const cozy = await findProducts("sofa", { Cozy: 1, Minimal: 0 });
    expect(minimal[0].id).not.toBe(cozy[0].id);
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
