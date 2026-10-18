import { describe, expect, it } from "vitest";
import { withCheckoutBadge } from "@/lib/checkout/badges";
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

describe("withCheckoutBadge", () => {
  it("marks protocol and Zinc stores 1-click and the rest Guided", () => {
    const product = { id: "p", slotId: "s", title: "Lamp", store: "Quillby Lighting", priceCents: 100, url: "", imageUrl: "", attributes: { source: "demo_store" } };
    expect(withCheckoutBadge(product).attributes).toMatchObject({ source: "demo_store", lane: "protocol", checkout: "1-click" });
    expect(withCheckoutBadge({ ...product, store: "Target" }).attributes).toMatchObject({ lane: "zinc", checkout: "1-click" });
    expect(withCheckoutBadge({ ...product, store: "IKEA" }).attributes).toMatchObject({ lane: "guided", checkout: "Guided" });
  });
});
