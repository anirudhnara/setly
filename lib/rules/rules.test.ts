import { describe, expect, it } from "vitest";
import apartmentJson from "@/fixtures/apartment-map.json";
import campingJson from "@/fixtures/camping-map.json";
import groupStateJson from "@/fixtures/group-state.json";
import { checkRules, planTotalCents } from "@/lib/rules/check";
import type { MapData, Member, Product, Rule, Slot } from "@/lib/types";

const now = new Date("2026-10-17T18:00:00Z");

function member(id: string): Member {
  return { id, groupId: "g", name: id, isOrganizer: false, joinedAt: now.toISOString() };
}
const members = ["a", "b", "c", "d"].map(member);

function slot(id: string, need: string, overrides: Partial<Slot> = {}): Slot {
  return {
    id, zoneId: "z", need, quantityRule: "per_group", quantity: 1, budgetCents: 0, payType: "shared",
    ownerMemberId: null, chosenProductId: `p_${id}`, updatedBy: null, updatedAt: now.toISOString(), ...overrides,
  };
}

function product(slotId: string, priceCents: number, attributes: Product["attributes"] = {}, store = "Target"): Product {
  return { id: `p_${slotId}`, slotId, title: slotId, store, priceCents, url: "https://example.com", imageUrl: "", attributes };
}

function rule(type: Rule["type"], slotIds: string[], params: Record<string, unknown>): Rule {
  return { id: `r_${type}`, groupId: "g", type, slotIds, params, status: "not_checked", message: "" };
}

function run(map: Omit<MapData, "zones" | "links">, people: Member[] = members) {
  return checkRules({ zones: [], links: [], ...map }, people, { now });
}

describe("checkRules", () => {
  const sofa = slot("sofa", "Sofa");
  const mugs = slot("mugs", "Mugs", { payType: "per_person", quantityRule: "per_person" });

  it("marks a budget rule ok when the charged total is within maxCents", () => {
    const [result] = run({ slots: [sofa, mugs], products: [product("sofa", 50_000), product("mugs", 1_000)], rules: [rule("budget", [], { maxCents: 100_000 })] });
    expect(result.status).toBe("ok");
    expect(result.message).toContain("$540");
  });

  it("marks a budget rule broken when the charged total is over maxCents", () => {
    const [result] = run({ slots: [sofa, mugs], products: [product("sofa", 50_000), product("mugs", 1_000)], rules: [rule("budget", [], { maxCents: 50_000 })] });
    expect(result.status).toBe("broken");
    expect(result.message).toContain("over");
  });

  it("warns when the plan uses 95% or more of the budget", () => {
    const [result] = run({ slots: [sofa], products: [product("sofa", 96_000)], rules: [rule("budget", [], { maxCents: 100_000 })] });
    expect(result.status).toBe("warning");
  });

  it("does not charge already-owned slots or slots without a product", () => {
    const map: MapData = {
      zones: [], links: [], rules: [],
      slots: [sofa, slot("mat", "Doormat", { payType: "already_owned" }), slot("rug", "Rug", { chosenProductId: null })],
      products: [product("sofa", 10_000), product("mat", 2_000)],
    };
    expect(planTotalCents(map, 4)).toBe(10_000);
  });

  it("marks a quantity rule from the slot quantity and the member count", () => {
    const chairs = slot("chairs", "Chairs", { quantity: 3 });
    const results = run({
      slots: [mugs, chairs],
      products: [product("mugs", 999), product("chairs", 4_000)],
      rules: [rule("quantity", ["mugs"], { per: "member" }), { ...rule("quantity", ["chairs"], { per: "member" }), id: "r_chairs" }, { ...rule("quantity", ["chairs"], { expected: 3 }), id: "r_expected" }],
    });
    expect(results.map((item) => item.status)).toEqual(["ok", "broken", "ok"]);
    expect(results[1].message).toContain("3 for 4 people");
  });

  it("marks a compatibility rule broken when the named product attributes disagree", () => {
    const stove = slot("stove", "Camp stove");
    const fuel = slot("fuel", "Fuel canister");
    const [result] = run({
      slots: [stove, fuel],
      products: [product("stove", 7_999, { fuelType: "isobutane" }), product("fuel", 1_299, { fuelType: "propane" })],
      rules: [rule("compatibility", ["stove", "fuel"], { attribute: "fuelType" })],
    });
    expect(result.status).toBe("broken");
    const [fixed] = run({
      slots: [stove, fuel],
      products: [product("stove", 7_999, { fuelType: "isobutane" }), product("fuel", 795, { fuelType: "Isobutane" })],
      rules: [rule("compatibility", ["stove", "fuel"], { attribute: "fuelType" })],
    });
    expect(fixed.status).toBe("ok");
  });

  it("returns not_checked for a size rule when product size attributes are missing", () => {
    const [result] = run({ slots: [sofa], products: [product("sofa", 50_000, { widthIn: 84 })], rules: [rule("size", ["sofa"], { doorWidthIn: 32 })] });
    expect(result.status).toBe("not_checked");
  });

  it("marks a door size rule broken for a sofa that won't fit, and ok for one that will", () => {
    const sizeRule = rule("size", ["sofa"], { doorWidthIn: 32 });
    const [blocked] = run({ slots: [sofa], products: [product("sofa", 54_900, { widthIn: 84, depthIn: 36, heightIn: 34 })], rules: [sizeRule] });
    expect(blocked.status).toBe("broken");
    const [fits] = run({ slots: [sofa], products: [product("sofa", 44_900, { widthIn: 72, depthIn: 31, heightIn: 32 })], rules: [sizeRule] });
    expect(fits.status).toBe("ok");
  });

  it("returns not_checked for a timing rule when product date attributes are missing", () => {
    const [result] = run({ slots: [sofa], products: [product("sofa", 50_000)], rules: [rule("timing", ["sofa"], { neededBy: "2026-11-01" })] });
    expect(result.status).toBe("not_checked");
    const [late] = run({ slots: [sofa], products: [product("sofa", 50_000, { deliveryDays: 30 })], rules: [rule("timing", ["sofa"], { neededBy: "2026-11-01" })] });
    expect(late.status).toBe("broken");
    const [onTime] = run({ slots: [sofa], products: [product("sofa", 50_000, { deliveryDate: "2026-10-25" })], rules: [rule("timing", ["sofa"], { neededBy: "2026-11-01" })] });
    expect(onTime.status).toBe("ok");
  });

  it("marks required_or_banned broken when a required need is missing", () => {
    const [result] = run({ slots: [sofa], products: [product("sofa", 50_000)], rules: [rule("required_or_banned", [], { requiredNeeds: ["Trash bin"] })] });
    expect(result.status).toBe("broken");
    expect(result.message).toContain("Trash bin");
    const [plural] = run({ slots: [slot("pillows", "Throw pillows")], products: [product("pillows", 999)], rules: [rule("required_or_banned", [], { requiredNeeds: ["throw pillow"] })] });
    expect(plural.status).toBe("ok");
  });

  it("marks required_or_banned broken when a chosen product is from a banned store", () => {
    const [result] = run({ slots: [sofa], products: [product("sofa", 50_000, {}, "Amazon")], rules: [rule("required_or_banned", [], { bannedStores: ["amazon"] })] });
    expect(result.status).toBe("broken");
  });

  it("returns not_checked, not ok, for door and timing rules when nothing is picked yet", () => {
    const empty = slot("sofa", "Sofa", { chosenProductId: null });
    const results = run({ slots: [empty], products: [], rules: [rule("size", ["sofa"], { doorWidthIn: 32 }), rule("timing", ["sofa"], { neededBy: "2026-11-01" })] });
    expect(results.map((item) => item.status)).toEqual(["not_checked", "not_checked"]);
  });

  it("returns not_checked when a rule's slots were deleted", () => {
    const [result] = run({ slots: [], products: [], rules: [rule("compatibility", ["gone"], { attribute: "fuelType" })] });
    expect(result.status).toBe("not_checked");
  });

  it("uses memberCount when the group has no members yet", () => {
    const [result] = checkRules(
      { zones: [], links: [], slots: [mugs], products: [product("mugs", 1_000)], rules: [rule("budget", [], { maxCents: 5_000 })] },
      [],
      { memberCount: 6, now },
    );
    expect(result.status).toBe("broken");
  });
});

describe("fixtures", () => {
  // Stored statuses must match the checker, or screens that read fixtures will show stale rules.
  const cases: [string, MapData, Member[], number][] = [
    ["apartment", apartmentJson as unknown as MapData, [], 4],
    ["camping", campingJson as unknown as MapData, [], 6],
    ["group state", (groupStateJson as unknown as { map: MapData }).map, (groupStateJson as unknown as { members: Member[] }).members, 0],
  ];
  it.each(cases)("%s rule statuses match the checker", (_name, map, people, count) => {
    const checked = checkRules(map, people, { memberCount: count, now });
    expect(checked.map((item) => [item.id, item.status])).toEqual(map.rules.map((item) => [item.id, item.status]));
  });
});
