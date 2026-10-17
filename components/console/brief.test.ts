import { describe, expect, it } from "vitest";
import { applyStep, composePrompt, emptyBrief, nextStep, parseLooseBudget, parseLooseCount } from "@/components/console/brief";

describe("brief interview", () => {
  it("asks for a scene when the opener is empty", () => {
    expect(nextStep(emptyBrief())).toBe("scene");
    expect(applyStep(emptyBrief(), "scene", "hi").accepted).toBe(false);
  });

  it("pulls people, budget, and mood out of a strong prompt", () => {
    const result = applyStep(emptyBrief(), "scene", "living room for 4 roommates, cozy, under $1,200");
    expect(result.accepted).toBe(true);
    expect(result.brief.people).toBe(4);
    expect(result.brief.budgetCents).toBe(120_000);
    expect(result.brief.vibe).toBe("cozy");
    expect(nextStep(result.brief)).toBe("must");
  });

  it("does not ask door width for a camping trip", () => {
    let brief = applyStep(emptyBrief(), "scene", "Weekend camping trip").brief;
    brief = applyStep(brief, "people", "4").brief;
    brief = applyStep(brief, "budget", "$800").brief;
    brief = applyStep(brief, "vibe", "Outdoorsy").brief;
    brief = applyStep(brief, "must", "Skip").brief;
    brief = applyStep(brief, "owned", "Skip").brief;
    expect(nextStep(brief)).toBe("when");
  });

  it("asks door width for a room and then the name", () => {
    let brief = applyStep(emptyBrief(), "scene", "Living room for roommates").brief;
    brief = applyStep(brief, "people", "four").brief;
    brief = applyStep(brief, "budget", "1200").brief;
    brief = applyStep(brief, "vibe", "Cozy").brief;
    brief = applyStep(brief, "must", "Skip").brief;
    brief = applyStep(brief, "owned", "A lamp and a rug").brief;
    expect(nextStep(brief)).toBe("door");
    brief = applyStep(brief, "door", "32 in").brief;
    brief = applyStep(brief, "when", "No deadline").brief;
    expect(nextStep(brief)).toBe("name");
    brief = applyStep(brief, "name", "Ani").brief;
    expect(nextStep(brief)).toBeNull();
    const prompt = composePrompt(brief);
    expect(prompt).toContain("4 roommates");
    expect(prompt).toContain("Budget $1200");
    expect(prompt).toContain("Already have: Lamp, Rug");
    expect(prompt).toContain("Door is 32 inches");
    expect(parseLooseCount("four")).toBe(4);
    expect(parseLooseBudget("1200")).toBe(120_000);
  });
});
