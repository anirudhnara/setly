import { describe, expect, it } from "vitest";
import { fallbackIdeas, pickAffordable, priceContext } from "@/lib/ai/suggest";
import type { MapData, Product, Slot } from "@/lib/types";

function product(id: string, title: string, priceCents: number): Product {
  return { id, slotId: "", title, store: "Target", priceCents, url: "", imageUrl: "", attributes: {} };
}

function slot(id: string, chosenProductId: string): Slot {
  return { id, zoneId: "z", need: id, quantityRule: "per_group", quantity: 1, budgetCents: 0, payType: "shared", ownerMemberId: null, chosenProductId, updatedBy: null, updatedAt: "" };
}

const map = (prices: number[]): MapData => ({
  zones: [],
  slots: prices.map((_, index) => slot(`s${index}`, `p${index}`)),
  products: prices.map((cents, index) => ({ ...product(`p${index}`, "Item", cents), slotId: `s${index}` })),
  links: [],
  rules: [],
});

describe("fallbackIdeas", () => {
  it("suggests bathroom things for a bathroom, never sofas", () => {
    const ideas = fallbackIdeas("Bathroom", ["Bath towels"], []);
    expect(ideas.map((idea) => idea.need)).toEqual(["Bath mat", "Shower curtain", "Shower caddy", "Bathroom trash can", "Bathroom mirror"]);
    expect(ideas.some((idea) => /sofa|armchair|coffee table/i.test(idea.need))).toBe(false);
  });

  it("knows kitchens and dorms, and keeps living rooms to living-room things", () => {
    expect(fallbackIdeas("Kitchen", [], [])[0]?.need).toBe("Cookware set");
    expect(fallbackIdeas("Dorm room", [], []).map((idea) => idea.need)).toContain("Mini fridge");
    expect(fallbackIdeas("Living room", ["Sofa"], ["Cozy"]).every((idea) => idea.need !== "Microwave")).toBe(true);
  });
});

describe("priceContext", () => {
  it("caps ideas at what's left of the budget", () => {
    expect(priceContext(map([50_000, 20_000]), 100_000).capCents).toBe(30_000);
  });

  it("falls back to a typical item price once the budget is used up", () => {
    expect(priceContext(map([90_000, 5_000, 3_000]), 90_000).capCents).toBe(5_000);
  });
});

describe("pickAffordable", () => {
  const towels = [
    product("lux", "Turkish cotton bath towel set", 18_900),
    product("mid", "Quick-dry bath towel set, 6 piece", 3_400),
    product("cheap", "Bath towel 2 pack", 1_200),
    product("sofa", "Velvet sofa with bath towel holder", 89_900),
  ];

  it("never picks something above the cap, and lands mid-range rather than at the top", () => {
    const pick = pickAffordable("bath towel set", towels, { capCents: 20_000 });
    expect(pick?.id).toBe("mid");
    expect(pickAffordable("bath towel set", towels, { capCents: 1_000 })).toBeNull();
  });

  it("drops products that aren't the thing asked for", () => {
    const pick = pickAffordable("bath mat", [product("rug", "Sherpa sofa", 2_000), product("mat", "Memory foam bath mat", 1_800)], { capCents: 5_000 });
    expect(pick?.id).toBe("mat");
  });
});
