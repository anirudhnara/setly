import { describe, expect, it } from "vitest";
import { demoStoreSlug, laneForStore } from "@/lib/checkout/registry";

describe("laneForStore", () => {
  it("sends the demo stores through the protocol lane", () => {
    expect(laneForStore("Fernwood Home")).toBe("protocol");
    expect(laneForStore("quillby lighting")).toBe("protocol");
    expect(demoStoreSlug("Tallpine Outfitters")).toBe("tallpine-outfitters");
  });

  it("sends verified or active Zinc retailers through Zinc, matched by name", () => {
    expect(laneForStore("Target")).toBe("zinc");
    expect(laneForStore("Walmart")).toBe("zinc");
    expect(laneForStore("Lowes")).toBe("zinc");
    expect(laneForStore("Home Depot")).toBe("zinc");
    expect(laneForStore("Best Buy")).toBe("zinc");
  });

  it("guides everything else, including retailers Zinc has only observed", () => {
    expect(laneForStore("IKEA")).toBe("guided");
    expect(laneForStore("west elm")).toBe("guided");
    expect(laneForStore("Wayfair")).toBe("guided");
    expect(demoStoreSlug("Target")).toBeNull();
  });
});
