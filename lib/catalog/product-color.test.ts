import { describe, expect, it } from "vitest";
import { colorChoices, productColor, recolorPick } from "@/lib/catalog/product-color";
import type { Product } from "@/lib/types";

const product = (id: string, title: string, priceCents: number, attributes: Product["attributes"] = {}): Product => ({
  id, slotId: "s", title, store: "Target", priceCents, url: "", imageUrl: "", attributes,
});

describe("productColor", () => {
  it("prefers the catalog's tagged color, then color words in the title", () => {
    expect(productColor(product("a", "Velvet sofa, emerald", 100, { color: "navy" }))).toBe("navy");
    expect(productColor(product("b", "Harbor 3-Seat Boucle Sofa, Oat", 100))).toBe("cream");
    expect(productColor(product("c", "Alder Round Oak Coffee Table", 100))).toBe("wood");
    expect(productColor(product("d", "Pivot LED Desk Lamp", 100))).toBeNull();
  });
});

describe("recolorPick", () => {
  const current = product("gray", "Charcoal gray sofa", 50_000);
  const options = [
    product("navy", "Navy velvet sofa", 52_000),
    product("navy-pricey", "Navy leather sofa", 120_000),
    product("green", "Sage green sofa", 46_000),
    product("gray2", "Light gray sofa", 50_500),
    product("plain", "Modern sofa", 49_000),
  ];

  it("moves to a different color at a similar price", () => {
    const picked = new Set([0, 0.99].map((roll) => recolorPick(current, options, () => roll)?.id));
    expect(picked).toEqual(new Set(["navy", "green"]));
  });

  it("returns null when no other color is close in price, or the current color is unknown", () => {
    expect(recolorPick(current, [product("x", "Red sofa", 200_000)])).toBeNull();
    expect(recolorPick(product("m", "Ceramic mug", 999), [product("w", "White mug", 999)])).toBeNull();
  });

  it("lists each color once, the current one first, with its closest-priced option", () => {
    const choices = colorChoices(current, options);
    expect(choices.map((choice) => choice.color)).toEqual(["gray", "navy", "green"]);
    expect(choices.find((choice) => choice.color === "navy")?.product.id).toBe("navy");
    expect(choices[0]?.product.id).toBe("gray");
  });
});
