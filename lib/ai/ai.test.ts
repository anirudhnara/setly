import { describe, expect, it } from "vitest";
import { buildMap, normalizeSlot } from "@/lib/ai/build-map";
import { fixtureMapForPrompt } from "@/lib/ai/fixture-map";
import { generateMapFromPrompt, generateMapFromPaste, parseGenerated } from "@/lib/ai/gemini";
import { applyQuestionnaire, needMatches, parseBudgetCents, parseDoorWidthIn, parseMemberCount, parsePastedList, parseQuestionnaireItems } from "@/lib/ai/parse";
import { suggestSlots } from "@/lib/ai/suggestions";
import type { GeneratedMap } from "@/lib/ai/schemas";
import { planTotalCents } from "@/lib/rules/check";
import { searchCatalog } from "@/lib/search/serpapi";
import type { MapData, Product } from "@/lib/types";

function expectConsistent(map: MapData) {
  const slotIds = new Set(map.slots.map((slot) => slot.id));
  const zoneIds = new Set(map.zones.map((zone) => zone.id));
  const productIds = new Set(map.products.map((product) => product.id));
  expect(slotIds.size).toBe(map.slots.length);
  for (const slot of map.slots) {
    expect(zoneIds.has(slot.zoneId)).toBe(true);
    if (slot.chosenProductId) expect(productIds.has(slot.chosenProductId)).toBe(true);
    expect(Number.isInteger(slot.budgetCents)).toBe(true);
  }
  for (const product of map.products) {
    expect(slotIds.has(product.slotId)).toBe(true);
    expect(Number.isInteger(product.priceCents)).toBe(true);
  }
  for (const link of map.links) expect(slotIds.has(link.fromSlotId) && slotIds.has(link.toSlotId)).toBe(true);
  for (const rule of map.rules) {
    expect(rule.slotIds.every((id) => slotIds.has(id))).toBe(true);
    expect(rule.message.length).toBeGreaterThan(0);
  }
}

describe("prompt parsing", () => {
  it("reads budget, group size, and door width from questionnaire text", () => {
    const prompt = "Living room for a group of 3, cozy and navy, $1,500 total, door is 32 inches";
    expect(parseBudgetCents(prompt)).toBe(150_000);
    expect(parseMemberCount(prompt)).toBe(3);
    expect(parseDoorWidthIn(prompt)).toBe(32);
    expect(parseMemberCount("living room for 4 roommates, cozy, under $1,200")).toBe(4);
    expect(parseMemberCount("camping trip, six friends")).toBe(6);
    expect(parseBudgetCents("$400 per person for 3 roommates")).toBe(120_000);
    expect(parseDoorWidthIn('a 30" door')).toBe(30);
    expect(parseBudgetCents("no money talk")).toBeNull();
    expect(parseMemberCount("road trip for 2 weeks")).toBeNull();
  });

  it("turns a pasted list into zones and slots", () => {
    const generated = parsePastedList("Kitchen:\n- 2x Dining chairs\n- Microwave ($80)\n* Mugs each\n\nLiving room:\n1. Sofa - something navy\n2. Floor lamp\n- [ ] Doormat (already have)\n- Sofa");
    expect(generated.zones.map((zone) => zone.name)).toEqual(["Kitchen", "Living room"]);
    const slots = generated.zones.flatMap((zone) => zone.slots);
    expect(slots.map((slot) => slot.need)).toEqual(["Dining chairs", "Microwave", "Mugs", "Sofa", "Floor lamp", "Doormat"]);
    expect(slots[0].quantity).toBe(2);
    expect(slots[2].payType).toBe("per_person");
    expect(slots[5].payType).toBe("already_owned");
  });

  it("parses a single comma-separated line", () => {
    expect(parsePastedList("sofa, rug, floor lamp").zones[0].slots).toHaveLength(3);
  });
});

describe("model output", () => {
  it("accepts valid JSON, including a fenced block", () => {
    const json = JSON.stringify({ zones: [{ name: "Living", sortOrder: 0, slots: [{ need: "Sofa", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "sofa" }] }], links: [], rules: [] });
    expect(parseGenerated(json).zones).toHaveLength(1);
    expect(parseGenerated("```json\n" + json + "\n```").zones).toHaveLength(1);
  });

  it("rejects output with prices or bad rule types", () => {
    expect(() => parseGenerated("not json")).toThrow();
    expect(() => parseGenerated(JSON.stringify({ zones: [], links: [], rules: [] }))).toThrow();
    const badRule = { zones: [{ name: "A", sortOrder: 0, slots: [{ need: "Sofa", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "sofa" }] }], links: [], rules: [{ type: "vibes", needs: [], params: {} }] };
    expect(() => parseGenerated(JSON.stringify(badRule))).toThrow();
  });

  it("keeps per-person quantity consistent with the share math", () => {
    expect(normalizeSlot({ need: "Mugs", quantityRule: "per_group", quantity: 1, payType: "per_person", searchQuery: "mug" }, 4).quantityRule).toBe("per_person");
    expect(normalizeSlot({ need: "Towels", quantityRule: "per_person", quantity: 2, payType: "shared", searchQuery: "towel" }, 4)).toMatchObject({ quantityRule: "fixed", quantity: 8 });
  });
});

describe("buildMap", () => {
  const generated: GeneratedMap = {
    zones: [
      {
        name: "Living room", sortOrder: 0,
        slots: [
          { need: "Sofa", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "sofa", budgetWeight: 60 },
          { need: "Rug", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "rug", budgetWeight: 15 },
          { need: "sofa", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "duplicate", budgetWeight: 10 },
          { need: "Mugs", quantityRule: "per_person", quantity: 1, payType: "per_person", searchQuery: "mug", budgetWeight: 5 },
          { need: "Unicorn", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "zzzz unicorn", budgetWeight: 5 },
        ],
      },
    ],
    links: [{ fromNeed: "Rug", toNeed: "Sofa", label: "under the sofa" }, { fromNeed: "Rug", toNeed: "Ghost", label: "dropped" }],
    rules: [
      { type: "quantity", needs: ["Mugs"], params: { per: "member" } },
      { type: "compatibility", needs: ["Ghost"], params: { attribute: "x" } },
      { type: "budget", needs: [], params: {} },
    ],
  };
  const search = async (query: string): Promise<Product[]> => searchCatalog(query);

  it("builds a consistent map, drops unknown needs, and only uses searched prices", async () => {
    const map = await buildMap({ generated, budgetCents: 150_000, memberCount: 3, groupId: "grp_1", doorWidthIn: 32, search });
    expectConsistent(map);
    expect(map.slots.map((slot) => slot.need)).toEqual(["Sofa", "Rug", "Mugs", "Unicorn"]);
    expect(map.slots.find((slot) => slot.need === "Unicorn")?.chosenProductId).toBeNull();
    expect(map.links).toHaveLength(1);
    expect(map.rules.map((rule) => rule.type)).toEqual(["budget", "quantity", "size"]);
    expect(map.rules.every((rule) => rule.groupId === "grp_1")).toBe(true);
    const catalogPrices = new Set(["sofa", "rug", "mug"].flatMap((query) => searchCatalog(query).map((product) => product.priceCents)));
    for (const product of map.products) expect(catalogPrices.has(product.priceCents)).toBe(true);
    expect(planTotalCents(map, 3)).toBeLessThanOrEqual(150_000);
    const slotBudgets = map.slots.reduce((sum, slot) => sum + slot.budgetCents, 0);
    expect(slotBudgets).toBe(150_000);
  });

  it("steps down to cheaper options when the plan is over budget", async () => {
    const map = await buildMap({ generated, budgetCents: 50_000, memberCount: 3, groupId: "", search });
    expect(planTotalCents(map, 3)).toBeLessThanOrEqual(50_000);
  });

  it("survives a failing search", async () => {
    const map = await buildMap({ generated, budgetCents: null, memberCount: 3, groupId: "", search: async () => { throw new Error("down"); } });
    expectConsistent(map);
    expect(map.products).toHaveLength(0);
  });

  it("gives every generated map fresh ids", async () => {
    const [a, b] = await Promise.all([buildMap({ generated, budgetCents: null, memberCount: 2, groupId: "", search }), buildMap({ generated, budgetCents: null, memberCount: 2, groupId: "", search })]);
    expect(a.slots[0].id).not.toBe(b.slots[0].id);
  });
});

describe("fixtureMapForPrompt", () => {
  it("applies the questionnaire budget and door width to the starter map", () => {
    const map = fixtureMapForPrompt("living room, group of 3", { budgetCents: 150_000, memberCount: 3, doorWidthIn: 32, groupId: "grp_x" });
    expectConsistent(map);
    expect(map.rules.find((rule) => rule.type === "budget")?.params.maxCents).toBe(150_000);
    const door = map.rules.find((rule) => rule.params.doorWidthIn === 32);
    expect(door?.status).toBe("broken");
    expect(map.zones.every((zone) => zone.groupId === "grp_x")).toBe(true);
  });

  it("picks the camping map for trip prompts and never reuses ids", () => {
    const a = fixtureMapForPrompt("camping trip for 6", { budgetCents: null, memberCount: 6, doorWidthIn: null, groupId: "" });
    const b = fixtureMapForPrompt("camping trip for 6", { budgetCents: null, memberCount: 6, doorWidthIn: null, groupId: "" });
    expect(a.slots.some((slot) => slot.need === "Tent")).toBe(true);
    expect(a.slots[0].id).not.toBe(b.slots[0].id);
    expect(a.rules.find((rule) => rule.type === "compatibility")?.status).toBe("broken");
  });
});

describe("mock generation (MOCK_AI=1)", () => {
  it("builds a bedroom map from the sample catalog", async () => {
    const map = await generateMapFromPrompt("Bedroom for one, $900", undefined, "grp_b");
    expectConsistent(map);
    expect(map.slots.some((slot) => slot.need === "Mattress")).toBe(true);
    expect(map.products.length).toBeGreaterThan(3);
  });

  it("builds a paste map from the pasted lines, not a fixture", async () => {
    const map = await generateMapFromPaste("- Bookshelf\n- Trash bin\n- Microwave", "grp_p");
    expectConsistent(map);
    expect(map.slots.map((slot) => slot.need)).toEqual(["Bookshelf", "Trash bin", "Microwave"]);
    expect(map.zones[0].groupId).toBe("grp_p");
  });
});

describe("review fixes", () => {
  it("only treats a budget as per person when the words follow the amount", () => {
    expect(parseBudgetCents("$1,500 total, mugs each, 3 roommates")).toBe(150_000);
    expect(parseBudgetCents("$500/person, 3 roommates")).toBe(150_000);
  });

  it("ignores prose, intro lines, and totals in a pasted answer", () => {
    const answer = "Here's a cozy living room list for you:\n\n- **Sofa** ($600): navy velvet\n- Rug - washable\n- Floor lamp\n\nTotal: about $900. Let me know if you want swaps!";
    const generated = parsePastedList(answer);
    expect(generated.zones.flatMap((zone) => zone.slots.map((slot) => slot.need))).toEqual(["Sofa", "Rug", "Floor lamp"]);
    expect(generated.zones[0].name).toBe("Plan");
  });

  it("treats a 0 cent budget as no budget", async () => {
    const map = await generateMapFromPrompt("living room for 4 roommates", 0);
    expect(map.rules.find((rule) => rule.type === "budget")?.status).not.toBe("broken");
  });
});

describe("questionnaire items", () => {
  it("reads owned items and must-haves", () => {
    expect(parseQuestionnaireItems("Living room. Already have: a floor lamp and a rug. Must-haves: bookshelf, trash bin")).toEqual({
      owned: ["Floor lamp", "Rug"],
      mustHaves: ["Bookshelf", "Trash bin"],
    });
    expect(parseQuestionnaireItems("we have 3 roommates")).toEqual({ owned: [], mustHaves: [] });
    expect(needMatches("Floor lamp", "lamp")).toBe(true);
    expect(needMatches("Rugs", "rug")).toBe(true);
    expect(needMatches("Sofa", "Rug")).toBe(false);
  });

  it("marks owned slots free and adds missing must-haves on the starter map", async () => {
    const map = await generateMapFromPrompt("Living room for 4 roommates, $1,200. Already have: floor lamp. Must-haves: bookshelf", undefined, "g");
    expectConsistent(map);
    expect(map.slots.find((slot) => slot.need === "Floor lamp")?.payType).toBe("already_owned");
    expect(map.slots.find((slot) => slot.need === "Bookshelf")?.chosenProductId).not.toBeNull();
    const required = map.rules.filter((rule) => rule.type === "required_or_banned");
    expect(required.some((rule) => rule.message.includes("Bookshelf") && rule.status === "ok")).toBe(true);
  });

  it("applies the same items to model structure", () => {
    const generated: GeneratedMap = { zones: [{ name: "Room", sortOrder: 0, slots: [{ need: "Rug", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "rug" }] }], links: [], rules: [] };
    const applied = applyQuestionnaire(generated, { owned: ["rug"], mustHaves: ["Desk"] });
    expect(applied.zones[0].slots.map((slot) => [slot.need, slot.payType])).toEqual([["Rug", "already_owned"], ["Desk", "shared"]]);
    expect(applied.rules[0].params.requiredNeeds).toEqual(["Desk"]);
  });
});

describe("Side Kick suggestions", () => {
  it("suggests required and companion items that aren't on the map and fit the budget left", async () => {
    const map = fixtureMapForPrompt("living room", { budgetCents: 120_000, memberCount: 4, doorWidthIn: null, groupId: "" });
    map.rules.push({ id: "r", groupId: "", type: "required_or_banned", slotIds: [], params: { requiredNeeds: ["Trash bin"] }, status: "not_checked", message: "" });
    const suggestions = await suggestSlots(map, { budgetCents: 120_000, memberCount: 4, search: async (query) => searchCatalog(query) });
    expect(suggestions[0]).toMatchObject({ need: "Trash bin", reason: "Your plan requires it" });
    const onMap = new Set(map.slots.map((slot) => slot.need));
    expect(suggestions.every((suggestion) => !onMap.has(suggestion.need))).toBe(true);
    const left = 120_000 - planTotalCents(map, 4);
    expect(suggestions.filter((suggestion) => suggestion.reason !== "Your plan requires it").every((suggestion) => suggestion.product.priceCents <= left)).toBe(true);
    expect(suggestions.length).toBeLessThanOrEqual(6);
  });
});
