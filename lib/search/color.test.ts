import { describe, expect, it } from "vitest";
import { alignTags, roleFromTags } from "@/lib/ai/catalog-tags";
import { colorsWork, harmony, paletteFor, paletteScore } from "@/lib/search/color";

describe("color harmony", () => {
  it("relates families on the color wheel", () => {
    expect(harmony("navy", "beige")).toBe("neutral");
    expect(harmony("green", "green")).toBe("monochrome");
    expect(harmony("blue", "teal")).toBe("analogous");
    expect(harmony("blue", "orange")).toBe("complementary");
    expect(harmony("red", "green")).toBe("complementary");
    expect(harmony("gold", "silver")).toBe("clash");
    expect(harmony("gold", "navy")).toBe("neutral");
    expect(harmony("multicolor", "pink")).toBe("busy");
    expect(harmony("yellow", "purple")).toBe("complementary");
    expect(harmony("red", "yellow")).toBe("triadic");
    expect(colorsWork("orange", "pink")).toBe(false);
  });

  it("scores a set by the share of color pairs that work", () => {
    expect(paletteScore(["beige", "navy", "orange"])).toBe(1);
    expect(paletteScore(["orange", "pink"])).toBe(0);
    expect(paletteScore(["white"])).toBe(1);
  });

  it("groups colors into broad palettes", () => {
    expect(paletteFor("pink", "pastel", "light")).toBe("pastels");
    expect(paletteFor("green", "vivid", "dark")).toBe("jewel_tones");
    expect(paletteFor("green", "muted", "medium")).toBe("earth_tones");
    expect(paletteFor("wood", "muted", "medium")).toBe("earth_tones");
    expect(paletteFor("gold", "vivid", "medium")).toBe("metallics");
  });
});

describe("Gemini catalog tags", () => {
  const entry = { family: "blue", accent: "blue", temperature: "cool", value: "dark", saturation: "vivid", confidence: "stated", styles: ["glam", "glam"] } as const;

  it("lines entries up by index and drops unknown or repeated ones", () => {
    const aligned = alignTags([{ i: 1, ...entry, styles: [...entry.styles] }, { i: 5, ...entry, styles: [] }, { i: 1, ...entry, family: "red", styles: [] }], 2);
    expect(aligned[0]).toBeNull();
    expect(aligned[1]?.color).toMatchObject({ family: "blue", accent: "none", palette: "jewel_tones" });
    expect(aligned[1]?.styles).toEqual(["glam"]);
  });

  it("makes bold styles or bold colors anchors", () => {
    const [tags] = alignTags([{ i: 0, ...entry, styles: ["minimalist"] }], 1);
    expect(tags && roleFromTags(tags)).toBe("anchor");
    const [calm] = alignTags([{ i: 0, ...entry, family: "white", saturation: "muted", styles: ["minimalist"] }], 1);
    expect(calm && roleFromTags(calm)).toBe("neutral");
  });
});
