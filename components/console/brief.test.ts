import { describe, expect, it } from "vitest";
import { answerText, applyAnswer, budgetOptions, canBuild, composePrompt, emptyBrief, essentialQuestions, parseLooseBudget, readOpening } from "@/components/console/brief";
import { applyQuestionnaire, needMatches, parseQuestionnaireItems } from "@/lib/ai/parse";
import { cleanPlan, rulesPlan, type Question } from "@/lib/ai/interview";

const items: Question = {
  id: "q0",
  kind: "multi",
  topic: "items",
  ask: "What should we get?",
  options: [
    { label: "Twin XL sheet set", group: "Sleep", pick: true },
    { label: "Pots and pans", group: "Kitchen", pick: true },
    { label: "Shower caddy", group: "Bath" },
  ],
};

describe("chat brief", () => {
  it("reads what the first message already says", () => {
    const brief = readOpening(emptyBrief(), "Dorm for 3 roommates, around $1,200");
    expect(brief.people).toBe(3);
    expect(brief.budgetCents).toBe(120_000);
    expect(essentialQuestions(brief, "group")).toEqual([]);
    expect(parseLooseBudget("4 roommates")).toBeNull();
  });

  it("asks only the essentials it doesn't know, with budgets that fit the kind of set", () => {
    const dorm = readOpening(emptyBrief(), "dorm room");
    expect(essentialQuestions(dorm, "group").map((question) => question.topic)).toEqual(["people", "budget"]);
    expect(essentialQuestions(dorm, "solo").map((question) => question.topic)).toEqual(["budget"]);
    const camping = budgetOptions(readOpening(emptyBrief(), "weekend camping trip for 4"), "group");
    const claim = budgetOptions(readOpening(emptyBrief(), "replace our living room after a fire"), "insurance");
    expect(camping[1]).toBeLessThan(claim[1]);
    expect(camping).toEqual([...camping].sort((a, b) => a - b));
    // An apartment where they cook a lot is still an apartment, not a kitchen-only set.
    expect(budgetOptions(readOpening(emptyBrief(), "first apartment for 2 of us, we cook a lot"), "group")[1]).toBeGreaterThanOrEqual(1000);
  });

  it("folds tapped answers in, and re-asks an essential it can't read", () => {
    let brief = readOpening(emptyBrief(), "dorm room");
    const [people, budget] = essentialQuestions(brief, "group");
    expect(applyAnswer(brief, people, ["Just me"]).brief.people).toBe(1);
    expect(applyAnswer(brief, budget, ["not sure"]).ok).toBe(false);
    brief = applyAnswer(brief, people, ["3 roommates"]).brief;
    brief = applyAnswer(brief, budget, ["$1,200"]).brief;
    brief = applyAnswer(brief, items, ["Twin XL sheet set", "Pots and pans", "Desk fan"]).brief;
    expect(brief.groups).toEqual({ "Twin XL sheet set": "Sleep", "Pots and pans": "Kitchen" });
    brief = applyAnswer(brief, { id: "owned", kind: "multi", topic: "owned", ask: "Anything you already have?", options: [] }, ["Desk fan"]).brief;
    expect(brief.mustHaves).toEqual(["Twin XL sheet set", "Pots and pans"]);
    expect(canBuild(brief)).toBe(true);
    expect(answerText(items, ["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d +2 more");
  });

  it("composes a prompt the map parser reads back, branches included", () => {
    let brief = readOpening(emptyBrief(), "Dorm for 3 roommates, $1,200");
    brief = applyAnswer(brief, items, ["Twin XL sheet set", "Pots and pans", "Shower caddy"]).brief;
    brief = applyAnswer(brief, { id: "s", kind: "single", topic: "space", ask: "How big is the room?", options: [] }, ["Small, about 10x12 ft"]).brief;
    const prompt = composePrompt(brief);
    expect(prompt).toContain("How big is the room: Small, about 10x12 ft.");
    const parsed = parseQuestionnaireItems(prompt);
    // "and" would split one item in two, so it's written as "&".
    expect(parsed.mustHaves).toEqual(["Twin XL sheet set", "Pots & pans", "Shower caddy"]);
    expect(parsed.groups?.["pots & pans"]).toBe("Kitchen");
  });

  it("treats a planned item as covering the ticked one when the words match, plurals included", () => {
    expect(needMatches("Kitchen trash can", "Trash cans (kitchen & bath)")).toBe(true);
    expect(needMatches("Desk lamp", "Floor lamp")).toBe(false);
  });

  it("puts a must-have the plan dropped back under the branch it was picked from", () => {
    const parsed = parseQuestionnaireItems("Must-haves: Sheets, Shower caddy. Branches they picked from: Sleep (Sheets); Bath (Shower caddy).");
    const planned = applyQuestionnaire({ zones: [{ name: "Sleep", sortOrder: 0, slots: [{ need: "Sheets", quantityRule: "per_group", quantity: 1, payType: "shared", searchQuery: "twin xl sheets" }] }], links: [], rules: [] }, parsed);
    expect(planned.zones.map((zone) => [zone.name, zone.slots.map((slot) => slot.need)])).toEqual([["Sleep", ["Sheets"]], ["Bath", ["Shower caddy"]]]);
  });
});

describe("question plan", () => {
  it("keeps one items picker first, drops money questions, and trims", () => {
    const plan = cleanPlan({
      title: "Dorm for 3",
      understood: "A dorm setup for three.",
      questions: [
        { kind: "single", topic: "space", ask: "How big is the room?", options: [{ label: "Small" }, { label: "Large" }] },
        { kind: "single", topic: "other", ask: "What's your budget?", options: [{ label: "$500" }, { label: "$900" }] },
        { kind: "multi", topic: "items", ask: "What should we get?", options: [{ label: "Sheets", group: "Sleep", pick: true }, { label: "sheets" }, { label: "Lamp" }] },
        { kind: "multi", topic: "items", ask: "Anything else?", options: [{ label: "Rug" }, { label: "Fan" }] },
      ],
    });
    expect(plan?.questions.map((question) => question.topic)).toEqual(["items", "space"]);
    expect(plan?.questions[0].options.map((option) => [option.label, option.group, option.pick])).toEqual([["Sheets", "Sleep", true], ["Lamp", "More", false]]);
    expect(cleanPlan({ title: "x", understood: "", questions: [{ kind: "single", topic: "space", ask: "Size?", options: [{ label: "S" }, { label: "L" }] }] })).toBeNull();
  });

  it("still writes a real questionnaire without Gemini", () => {
    const plan = rulesPlan({ request: "dorm for 3, need bed and bathroom stuff" });
    const picker = plan.questions.find((question) => question.topic === "items");
    expect(picker?.options.length).toBeGreaterThan(6);
    expect(new Set(picker?.options.map((option) => option.group)).size).toBeGreaterThan(1);
  });
});
