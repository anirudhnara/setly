import { describe, expect, it } from "vitest";
import { absorbAnswer, emptyBrief, mergeFacts, parseLooseBudget } from "@/components/console/brief";
import { buildMap, productKey } from "@/lib/ai/build-map";
import { labelsToIds } from "@/lib/ai/rank";
import { applyFeedback, diffMaps, nextBudget } from "@/lib/ai/refine";
import type { GeneratedMap } from "@/lib/ai/schemas";
import { branchesFromPrompt, starterStructure, structureFromMap, styleWord, withStyle } from "@/lib/ai/structure";
import { repairGeneratedMap, generatedMapSchema } from "@/lib/ai/schemas";
import { searchCatalog } from "@/lib/search/serpapi";
import type { Product } from "@/lib/types";

const generated: GeneratedMap = {
  zones: [
    {
      name: "Living room",
      sortOrder: 0,
      slots: [
        { need: "Sofa", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "sofa", budgetWeight: 60 },
        { need: "Rug", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "rug", budgetWeight: 15 },
        { need: "Floor lamp", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "floor lamp", budgetWeight: 10 },
      ],
    },
  ],
  links: [],
  rules: [],
};
const search = async (query: string): Promise<Product[]> => searchCatalog(query);

describe("rule-based refine", () => {
  it("adds, removes, and restyles from plain feedback", () => {
    const { generated: next } = applyFeedback(generated, "No rug, add a planter and a side table. Make it more minimal.");
    const needs = next.zones.flatMap((zone) => zone.slots.map((slot) => slot.need));
    expect(needs).not.toContain("Rug");
    expect(needs).toEqual(expect.arrayContaining(["Sofa", "Floor lamp", "Planter", "Side table"]));
    expect(next.zones[0].slots.find((slot) => slot.need === "Sofa")?.searchQuery).toBe("minimal sofa");
  });

  it("collects items to swap without removing them", () => {
    const { generated: next, swapNeeds } = applyFeedback(generated, "swap the lamp");
    expect(swapNeeds).toEqual(["lamp"]);
    expect(next.zones[0].slots).toHaveLength(3);
  });

  it("never empties the set", () => {
    const { generated: next } = applyFeedback(generated, "remove sofa, rug and floor lamp");
    expect(next.zones[0].slots.length).toBeGreaterThan(0);
  });

  it("sets the budget in code: a stated amount wins, cheaper and nicer nudge it", () => {
    expect(nextBudget("keep it under $900", 120_000, 110_000)).toBe(90_000);
    expect(nextBudget("make it cheaper", 120_000, 100_000)).toBe(80_000);
    expect(nextBudget("upgrade the sofa, splurge a bit", 100_000, 90_000)).toBe(125_000);
    expect(nextBudget("add a plant", 100_000, 90_000)).toBe(100_000);
  });

  it("reports what changed by need", () => {
    return Promise.all([
      buildMap({ generated, budgetCents: null, memberCount: 2, groupId: "g", search }),
      buildMap({ generated: applyFeedback(generated, "no rug, add a planter").generated, budgetCents: null, memberCount: 2, groupId: "g", search }),
    ]).then(([before, after]) => {
      const changes = diffMaps(before, after);
      expect(changes.added).toEqual(["Planter"]);
      expect(changes.removed).toEqual(["Rug"]);
      expect(changes.changed).toEqual([]);
    });
  });
});

describe("buildMap taste hooks", () => {
  it("keeps a loved product, avoids a passed-on one, and follows the ranking", async () => {
    const first = await buildMap({ generated, budgetCents: null, memberCount: 2, groupId: "g", search });
    const sofaSlot = first.slots.find((slot) => slot.need === "Sofa")!;
    const rugSlot = first.slots.find((slot) => slot.need === "Rug")!;
    const lovedSofa = first.products.find((product) => product.id === sofaSlot.chosenProductId)!;
    const passedRug = first.products.find((product) => product.id === rugSlot.chosenProductId)!;

    let searches = 0;
    const counting = async (query: string) => {
      searches += 1;
      return search(query);
    };
    const lampOptions = searchCatalog("floor lamp");
    const next = await buildMap({
      generated,
      budgetCents: null,
      memberCount: 2,
      groupId: "g",
      search: counting,
      keep: new Map([["sofa", lovedSofa]]),
      avoid: new Map([["rug", [productKey(passedRug)]]]),
      rank: async (slots) => {
        const lamp = slots.find((slot) => slot.need === "Floor lamp")!;
        const last = lamp.options[lamp.options.length - 1];
        return new Map([[lamp.slotId, ["made-up-id", last.id]]]);
      },
    });
    const pick = (need: string) => {
      const slot = next.slots.find((item) => item.need === need)!;
      return next.products.find((product) => product.id === slot.chosenProductId)!;
    };
    expect(pick("Sofa").title).toBe(lovedSofa.title);
    expect(pick("Sofa").id.startsWith(next.slots.find((slot) => slot.need === "Sofa")!.id)).toBe(true);
    expect(pick("Rug").title).not.toBe(passedRug.title);
    expect(pick("Floor lamp").title).toBe(lampOptions[lampOptions.length - 1].title);
    expect(searches).toBe(2);
  });

  it("drops ranking labels the model made up", () => {
    const options = searchCatalog("rug").map((product) => ({ ...product, id: `x_${product.id}` }));
    const order = labelsToIds({ picks: [{ slot: "s0", order: ["o1", "o99", "banana", "o0"] }, { slot: "s7", order: ["o0"] }] }, [{ slotId: "slot_rug", need: "Rug", options }]);
    expect(order.get("slot_rug")).toEqual([options[1].id, options[0].id]);
    expect(order.size).toBe(1);
  });
});

describe("starter structure", () => {
  it("styles furniture searches but not appliances", () => {
    expect(styleWord("Living room, cozy vibes")).toBe("cozy");
    const styled = withStyle(starterStructure("living room and kitchen for 4"), "minimal");
    const query = (need: string) => styled.zones.flatMap((zone) => zone.slots).find((slot) => slot.need === need)?.searchQuery;
    expect(query("Sofa")).toMatch(/^minimal /);
    expect(query("Microwave")).not.toMatch(/minimal/);
  });

  it("grows several branches from what the brief mentions, not one room", () => {
    const dorm = branchesFromPrompt("I am shopping for a dorm. I need to do bed and bathroom and storage and closet things, 3 roommates. Budget $1200. Vibe: Minimal 84%, Cool tones 70%.");
    expect(dorm.zones.map((zone) => zone.name)).toEqual(expect.arrayContaining(["Sleep", "Bath", "Storage"]));
    expect(dorm.zones.length).toBeGreaterThanOrEqual(3);
    const sheets = dorm.zones.flatMap((zone) => zone.slots).find((slot) => slot.need === "Sheet set");
    expect(sheets).toMatchObject({ payType: "per_person", quantity: 3 });
    // A thin brief is topped up with the scene's usual branches.
    expect(branchesFromPrompt("dorm").zones.length).toBeGreaterThanOrEqual(3);
    // The vibe line alone doesn't add branches ("Cool tones" isn't a request for decor).
    expect(branchesFromPrompt("kitchen. Vibe: Cool tones 70%.").zones.map((zone) => zone.name)).not.toContain("Decor");
  });

  it("repairs small model slips instead of rejecting a good plan", () => {
    const raw = {
      zones: [
        { name: "Sleep", sortOrder: 0, slots: [{ need: "Lamp", quantityRule: "per_group", quantity: 1, payType: "already_owned", searchQuery: "", budgetWeight: 0 }, { need: "Sheets", quantityRule: "per_person", quantity: 3, payType: "per_person", searchQuery: "twin xl sheets", budgetWeight: 8 }] },
        { name: "Empty", sortOrder: 1, slots: [] },
      ],
      links: [{ fromNeed: "Sheets", toNeed: "Lamp", label: "x".repeat(200) }],
      rules: [{ type: "vibes", needs: [], params: {} }, { type: "budget", needs: [], params: {} }],
    };
    expect(generatedMapSchema.safeParse(raw).success).toBe(false);
    const fixed = generatedMapSchema.parse(repairGeneratedMap(raw));
    expect(fixed.zones).toHaveLength(1);
    expect(fixed.zones[0].slots[0]).toMatchObject({ searchQuery: "Lamp", budgetWeight: 1 });
    expect(fixed.links[0].label).toHaveLength(80);
    expect(fixed.rules.map((rule) => rule.type)).toEqual(["budget"]);
  });

  it("round-trips a built map back to searchable structure", async () => {
    const map = await buildMap({ generated, budgetCents: 100_000, memberCount: 2, groupId: "g", search });
    const structure = structureFromMap(map);
    expect(structure.zones[0].slots.map((slot) => slot.searchQuery)).toEqual(["sofa", "rug", "floor lamp"]);
  });
});

describe("chat brief", () => {
  it("doesn't read a headcount as dollars", () => {
    expect(parseLooseBudget("4 roommates")).toBeNull();
    expect(parseLooseBudget("1.5k")).toBe(150_000);
    const brief = absorbAnswer(emptyBrief(), "4 roommates", "How many people?");
    expect(brief.people).toBe(4);
    expect(brief.budgetCents).toBeNull();
  });

  it("matches a bare number to the question it answers", () => {
    const scene = absorbAnswer(emptyBrief(), "Living room for our apartment", "");
    expect(absorbAnswer(scene, "4", "How many people are in on this?").people).toBe(4);
    expect(absorbAnswer(scene, "1200", "What's the total budget?").budgetCents).toBe(120_000);
  });

  it("lets model facts fill gaps without overwriting what code parsed", () => {
    const parsed = absorbAnswer(emptyBrief(), "Living room for 4 roommates, $1,200", "");
    const merged = mergeFacts(parsed, { people: 6, style: "warm", owned: ["Rug"] });
    expect(merged.people).toBe(4);
    expect(merged.vibe).toBe("warm");
    expect(merged.owned).toBe("Rug");
    expect(merged.budgetCents).toBe(120_000);
  });
});

describe("search quality", () => {
  it("drops digital mockups unless the query asks for them", async () => {
    const { withoutJunk } = await import("@/lib/search/serpapi");
    const real = { id: "a", slotId: "", title: "Stoneware mug, 14 oz", store: "Target", priceCents: 899, url: "https://x", imageUrl: "", attributes: {} };
    const junk = { ...real, id: "b", title: "Accent Mug Mockup Handle Mug Model Mock-Up", store: "Etsy", priceCents: 199 };
    expect(withoutJunk([junk, real], "mug")).toEqual([real]);
    expect(withoutJunk([junk, real], "mug mockup")).toHaveLength(2);
    expect(withoutJunk([junk], "mug")).toEqual([junk]);
    const sofa = (title: string, priceCents: number) => ({ ...real, id: title, title, priceCents });
    const sofas = [sofa("3 seat sofa", 49_900), sofa("Loveseat sofa", 39_900), sofa("Sectional sofa", 89_900), sofa("Sofa leg set", 1_299), sofa("DIY outdoor sofa plans", 380)];
    expect(withoutJunk(sofas, "sofa").map((item) => item.title)).toEqual(["3 seat sofa", "Loveseat sofa", "Sectional sofa"]);
  });
});
