import { describe, expect, it } from "vitest";
import { stampChangedSlots } from "@/lib/ai/stamp";
import type { MapData, Slot } from "@/lib/types";

function slot(overrides: Partial<Slot> & Pick<Slot, "id">): Slot {
  return {
    zoneId: "zone",
    need: "Sofa",
    quantityRule: "per_group",
    quantity: 1,
    budgetCents: 0,
    payType: "shared",
    ownerMemberId: null,
    chosenProductId: null,
    updatedBy: null,
    updatedAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

function map(slots: Slot[]): MapData {
  return { zones: [], slots, products: [], links: [], rules: [] };
}

describe("stampChangedSlots", () => {
  it("stamps new and changed slots and leaves untouched slots with their editor", () => {
    const previous = map([
      slot({ id: "kept", updatedBy: "mem_old" }),
      slot({ id: "swapped", chosenProductId: "p1", updatedBy: "mem_old" }),
    ]);
    const next = map([
      slot({ id: "kept", updatedBy: "mem_old" }),
      slot({ id: "swapped", chosenProductId: "p2", updatedBy: null }),
      slot({ id: "added" }),
    ]);

    const stamped = stampChangedSlots(previous, next, "mem_ani");

    expect(stamped.slots.find((item) => item.id === "kept")?.updatedBy).toBe("mem_old");
    expect(stamped.slots.find((item) => item.id === "swapped")?.updatedBy).toBe("mem_ani");
    expect(stamped.slots.find((item) => item.id === "added")?.updatedBy).toBe("mem_ani");
    expect(stamped.slots.find((item) => item.id === "swapped")?.updatedAt).not.toBe("2026-10-17T00:00:00.000Z");
  });
});
