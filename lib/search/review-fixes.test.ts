import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMap } from "@/lib/ai/build-map";
import { fixtureMapForPrompt } from "@/lib/ai/fixture-map";
import { parseBudgetCents, parseDoorWidthIn, parseMemberCount, parseQuestionnaireItems } from "@/lib/ai/parse";
import { questionnairePrompt } from "@/lib/ai/questionnaire";
import type { GeneratedMap } from "@/lib/ai/schemas";
import { checkRules, planTotalCents } from "@/lib/rules/check";
import { getCachedSearch, isFresh, setCachedSearch } from "@/lib/search/cache";
import { getSlotOptions, searchQueryFromSlotId } from "@/lib/search/options";
import { searchCatalog, searchProducts } from "@/lib/search/serpapi";
import type { Product } from "@/lib/types";

/** Forget everything this "instance" remembers, as a restart or a second Vercel instance would. */
function newInstance() {
  const memory = globalThis as typeof globalThis & { __setlySlotRegistry?: Map<string, unknown>; __setlySearchCache?: Map<string, unknown> };
  memory.__setlySlotRegistry?.clear();
  memory.__setlySearchCache?.clear();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("door-fit demo", () => {
  it("starts broken on the Harlow sofa and turns ok after swapping to a sofa that fits", async () => {
    const map = fixtureMapForPrompt("Living room for a group of 3, $1,500 total, door is 32 inches", { budgetCents: 150_000, memberCount: 3, doorWidthIn: 32, groupId: "" });
    const door = () => map.rules.find((rule) => rule.params.doorWidthIn === 32)!;
    expect(door().status).toBe("broken");
    const sofa = map.slots.find((slot) => slot.need === "Sofa")!;
    const fits = (await getSlotOptions(sofa.id))!.find((product) => Number(product.attributes.depthIn) <= 32)!;
    map.products.push(fits);
    sofa.chosenProductId = fits.id;
    map.rules = checkRules(map, [], { memberCount: 3 });
    expect(door().status).toBe("ok");
    expect(door().message).toContain("Coffee table");
  });

  it("judges each item on its own when one is missing dimensions", () => {
    const map = fixtureMapForPrompt("living room, door is 32 inches", { budgetCents: null, memberCount: 3, doorWidthIn: 32, groupId: "" });
    const table = map.products.find((product) => product.title === "Round oak coffee table")!;
    table.attributes = { material: "oak" };
    const sofa = map.products.find((product) => product.title === "Harlow 3-seat sofa")!;
    sofa.attributes = { ...sofa.attributes, depthIn: 30 };
    const door = checkRules(map, [], { memberCount: 3 }).find((rule) => rule.params.doorWidthIn === 32)!;
    expect(door.status).toBe("warning");
    expect(door.message).toMatch(/Sofa fits.*missing for Coffee table/);
  });
});

describe("shuffle stack without instance memory", () => {
  const generated: GeneratedMap = {
    zones: [{ name: "Living room", sortOrder: 0, slots: [{ need: "Sofa", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "navy 3 seat sofa", budgetWeight: 10 }] }],
    links: [],
    rules: [],
  };

  it("rebuilds the same options for a generated slot after a restart", async () => {
    const map = await buildMap({ generated, budgetCents: 100_000, memberCount: 3, groupId: "", search: async (query) => searchCatalog(query) });
    const slotId = map.slots[0].id;
    expect(searchQueryFromSlotId(slotId)).toBe("navy 3 seat sofa");
    const before = await getSlotOptions(slotId);
    newInstance();
    const after = await getSlotOptions(slotId);
    expect(after).not.toBeNull();
    expect(after!.map((product) => product.id)).toEqual(expect.arrayContaining(before!.slice(1).map((product) => product.id)));
  });

  it("resolves saved slots through the ledger store", async () => {
    newInstance();
    const options = await getSlotOptions("slot_rug");
    expect(options?.[0].id).toBe("prod_rug");
  });
});

describe("search cache", () => {
  it("caches failed SerpApi searches and serves the catalog without calling again", async () => {
    vi.stubEnv("MOCK_AI", "0");
    vi.stubEnv("SERPAPI_LIVE", "1");
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubEnv("SERPAPI_KEY", "test");
    vi.stubEnv("DATABASE_URL", "");
    newInstance();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    const first = await searchProducts("floor lamp");
    const second = await searchProducts("floor lamp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(searchCatalog("floor lamp"));
    expect(second).toEqual(first);
    expect((await getCachedSearch("floor lamp"))?.failure).toBe("error");
  });

  it("marks quota errors and empty results so they aren't retried soon", async () => {
    vi.stubEnv("MOCK_AI", "0");
    vi.stubEnv("SERPAPI_LIVE", "1");
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubEnv("SERPAPI_KEY", "test");
    vi.stubEnv("DATABASE_URL", "");
    newInstance();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "Your account has run out of searches." }), { status: 429 }));
    await searchProducts("rug");
    expect((await getCachedSearch("rug"))?.failure).toBe("quota");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ shopping_results: [] }), { status: 200 }));
    await searchProducts("quantum couch");
    expect((await getCachedSearch("quantum couch"))?.failure).toBe("empty");
  });

  it("retries a timed-out search after 10 minutes but keeps empty results", async () => {
    await setCachedSearch("x", [], "error");
    const entry = (await getCachedSearch("x"))!;
    expect(isFresh(entry, Date.now() + 11 * 60 * 1000)).toBe(false);
    expect(isFresh({ ...entry, failure: "empty" }, Date.now() + 365 * 24 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("integer product picking", () => {
  it("never picks a product whose full charge is over the slot budget when one fits", async () => {
    // Budget 2,999 cents for 3 mugs: 999 × 3 = 2,997 fits; 1,000 × 3 = 3,000 is 1 cent over.
    const products: Product[] = [
      { id: "a", slotId: "", title: "A", store: "IKEA", priceCents: 1_000, url: "u", imageUrl: "", attributes: {} },
      { id: "b", slotId: "", title: "B", store: "IKEA", priceCents: 999, url: "u", imageUrl: "", attributes: {} },
    ];
    const generated: GeneratedMap = {
      zones: [{ name: "Kitchen", sortOrder: 0, slots: [{ need: "Mugs", quantityRule: "per_person", quantity: 1, payType: "per_person", searchQuery: "mug", budgetWeight: 1 }] }],
      links: [],
      rules: [],
    };
    const map = await buildMap({ generated, budgetCents: 2_999, memberCount: 3, groupId: "", search: async () => products });
    expect(planTotalCents(map, 3)).toBe(2_997);
  });
});

describe("questionnaire prompt", () => {
  it("round-trips every answer the parsers read", () => {
    const prompt = questionnairePrompt({
      space: "Living room",
      people: 3,
      names: ["Ani", "Jules", "Sam"],
      budgetCents: 150_000,
      styles: ["cozy", "navy"],
      doorWidthIn: 32,
      alreadyOwned: ["floor lamp", "rug"],
      mustHaves: ["bookshelf"],
    });
    expect(parseBudgetCents(prompt)).toBe(150_000);
    expect(parseMemberCount(prompt)).toBe(3);
    expect(parseDoorWidthIn(prompt)).toBe(32);
    expect(parseQuestionnaireItems(prompt)).toEqual({ owned: ["Floor lamp", "Rug"], mustHaves: ["Bookshelf"] });
  });

  it("round-trips a per-person budget and odd cents", () => {
    const prompt = questionnairePrompt({ space: "Trip", people: 6, budgetCents: 15_050, budgetIsPerPerson: true });
    expect(parseBudgetCents(prompt)).toBe(90_300);
  });

  it("reads looser phrasings too", () => {
    expect(parseMemberCount("people: 5")).toBe(5);
    expect(parseDoorWidthIn("door width of 30, small room")).toBe(30);
    expect(parseBudgetCents("around 1200 dollars")).toBe(120_000);
  });
});
