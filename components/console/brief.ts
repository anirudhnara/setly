import { parseBudgetCents, parseDoorWidthIn, parseMemberCount, parseQuestionnaireItems } from "@/lib/ai/parse";

/** One question at a time. The composed prompt uses the phrases the map parser already understands. */
export type Step = "scene" | "people" | "budget" | "vibe" | "must" | "owned" | "door" | "when" | "name";

export interface Brief {
  scene: string;
  people: number | null;
  budgetCents: number | null;
  vibe: string;
  mustHaves: string;
  owned: string;
  doorIn: number | null;
  when: string;
  name: string;
  notes: string;
  asked: Step[];
}

export const GREETING =
  "I'm Setly. Tell me what the group is actually buying — a room, a trip, a first kitchen. If the prompt is thin, I'll ask until a store could fill it.";

export const QUESTIONS: Record<Step, { ask: string; chips: string[] }> = {
  scene: {
    ask: "What are you buying together? Give me the scene in one sentence.",
    chips: ["Living room for roommates", "Weekend camping trip", "First apartment kitchen"],
  },
  people: {
    ask: "How many people are in on this?",
    chips: ["2 roommates", "4 roommates", "6 friends"],
  },
  budget: {
    ask: "What's the ceiling for the whole group, not per person?",
    chips: ["$400", "$800", "$1,200", "$2,000"],
  },
  vibe: {
    ask: "What should it feel like when it's done?",
    chips: ["Cozy", "Minimal", "Practical", "Outdoorsy"],
  },
  must: {
    ask: "Anything that has to be in the plan?",
    chips: ["A sofa and a lamp", "Skip"],
  },
  owned: {
    ask: "What do you already own, so we don't buy it twice?",
    chips: ["A lamp and a rug", "Skip"],
  },
  door: {
    ask: "How wide is the door? Bulky pieces get checked against it.",
    chips: ["30 in", "32 in", "36 in", "Skip"],
  },
  when: {
    ask: "When does this need to exist?",
    chips: ["This weekend", "Move-in week", "No deadline"],
  },
  name: {
    ask: "What should the group call you? A first name is enough — no account.",
    chips: [],
  },
};

export const RETRY: Record<Step, string> = {
  scene: "I need a real scene. Try “living room for 4 roommates, cozy.”",
  people: "Give me a headcount. “4 roommates” is enough.",
  budget: "I need one number for the whole group. Try “$1,200”.",
  vibe: "One mood is enough — cozy, minimal, practical.",
  must: "Name a must-have, or say skip.",
  owned: "Name what you already have, or say skip.",
  door: "A width in inches, like “32 in”, or say skip.",
  when: "A timing note, or say no deadline.",
  name: "What should we call you in the group?",
};

const VIBES = ["cozy", "minimal", "modern", "warm", "calm", "bright", "outdoorsy", "rugged", "practical", "premium", "neutral", "quiet", "colorful"];
const SKIP = /^(skip|none|nothing|no|nope|n\/a|nah|not really|no thanks|no deadline)$/i;
const GREETING_ONLY = /^(hi|hey|hello|help|yo|test|idk|ok|okay)[.!\s]*$/i;
const FURNITURE = /room|sofa|couch|apartment|dorm|furniture|desk|bed|kitchen|table|living|bedroom|office|home/i;

export function emptyBrief(): Brief {
  return {
    scene: "",
    people: null,
    budgetCents: null,
    vibe: "",
    mustHaves: "",
    owned: "",
    doorIn: null,
    when: "",
    name: "",
    notes: "",
    asked: [],
  };
}

export function nextStep(brief: Brief): Step | null {
  if (!sceneOk(brief.scene)) return "scene";
  if (!brief.people) return "people";
  if (!brief.budgetCents) return "budget";
  if (!brief.vibe) return "vibe";
  if (!brief.asked.includes("must")) return "must";
  if (!brief.asked.includes("owned")) return "owned";
  if (wantsDoor(brief) && brief.doorIn == null && !brief.asked.includes("door")) return "door";
  if (!brief.asked.includes("when")) return "when";
  if (!brief.name) return "name";
  return null;
}

export function applyStep(brief: Brief, step: Step, text: string): { brief: Brief; accepted: boolean } {
  const clean = text.trim();
  if (!clean) return { brief, accepted: false };

  if (step === "scene" && !sceneOk(clean)) return { brief, accepted: false };
  if (step === "people" && parseLooseCount(clean) == null) return { brief, accepted: false };
  if (step === "budget" && parseLooseBudget(clean) == null) return { brief, accepted: false };
  if (step === "vibe" && !isSkip(clean) && clean.length < 3) return { brief, accepted: false };
  if (step === "door" && !isSkip(clean) && parseLooseDoor(clean) == null) return { brief, accepted: false };
  if (step === "name" && !nameOk(clean)) return { brief, accepted: false };

  let next = absorbFreeform(brief, clean);
  next = { ...next, asked: withStep(next.asked, step) };

  if (step === "scene") next.scene = clean;
  if (step === "people") next.people = parseLooseCount(clean);
  if (step === "budget") next.budgetCents = parseLooseBudget(clean);
  if (step === "vibe") next.vibe = isSkip(clean) ? "practical" : clean;
  if (step === "must") next.mustHaves = isSkip(clean) ? "" : phrase(clean, "must");
  if (step === "owned") next.owned = isSkip(clean) ? "" : phrase(clean, "owned");
  if (step === "door") next.doorIn = isSkip(clean) ? null : parseLooseDoor(clean);
  if (step === "when") next.when = isSkip(clean) ? "no deadline" : clean;
  if (step === "name") next.name = clean.replace(/[.!]+$/, "");
  return { brief: next, accepted: true };
}

/** Extra detail after the brief is already complete. */
export function noteBrief(brief: Brief, text: string): Brief {
  const clean = text.trim();
  if (!clean) return brief;
  return { ...absorbFreeform(brief, clean), notes: brief.notes ? `${brief.notes} ${clean}` : clean };
}

export function absorbFreeform(brief: Brief, text: string): Brief {
  const next: Brief = { ...brief, asked: [...brief.asked] };
  if (!next.scene && sceneOk(text)) next.scene = text.trim();
  // Free text only counts numbers that say what they are ("4 roommates", "$1,200"); a bare "4" is answered by step.
  const people = parseMemberCount(text);
  if (people && !next.people) next.people = people;
  const budget = parseBudgetCents(text);
  if (budget && !next.budgetCents) next.budgetCents = budget;
  const door = parseLooseDoor(text);
  if (door && next.doorIn == null) {
    next.doorIn = door;
    next.asked = withStep(next.asked, "door");
  }
  if (!next.vibe) {
    const vibe = VIBES.find((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
    if (vibe) next.vibe = vibe;
  }
  const items = parseQuestionnaireItems(text);
  if (items.mustHaves.length && !next.mustHaves) {
    next.mustHaves = items.mustHaves.join(", ");
    next.asked = withStep(next.asked, "must");
  }
  if (items.owned.length && !next.owned) {
    next.owned = items.owned.join(", ");
    next.asked = withStep(next.asked, "owned");
  }
  return next;
}

export function composePrompt(brief: Brief): string {
  const lines = [
    brief.scene.replace(/\s+/g, " ").trim(),
    `${brief.people} ${/\b(trip|camp|hike|travel|vacation|festival|party|wedding|team|office)\b/i.test(brief.scene) ? "people" : "roommates"}.`,
    `Budget $${Math.round((brief.budgetCents ?? 0) / 100)}.`,
    `Style: ${brief.vibe}.`,
  ];
  if (brief.mustHaves) lines.push(`Must-haves: ${brief.mustHaves}.`);
  if (brief.owned) lines.push(`Already have: ${brief.owned}.`);
  if (brief.doorIn) lines.push(`Door is ${brief.doorIn} inches.`);
  if (brief.when && brief.when !== "no deadline") lines.push(`Needed by ${brief.when}.`);
  if (brief.notes) lines.push(brief.notes);
  return lines.join(" ");
}

export function groupName(brief: Brief): string {
  const base = brief.scene.split(/[.]/)[0]?.trim() || "Shared plan";
  return base.length > 48 ? `${base.slice(0, 46).trim()}…` : base;
}

export function readyLine(brief: Brief): string {
  const dollars = Math.round((brief.budgetCents ?? 0) / 100).toLocaleString("en-US");
  return `Brief locked for ${brief.people} people, $${dollars} all in, ${brief.vibe}. I'll shop real stores from this — not a catalog.`;
}

function wantsDoor(brief: Brief) {
  return FURNITURE.test(`${brief.scene} ${brief.vibe}`);
}

function sceneOk(text: string) {
  const clean = text.trim();
  return clean.length >= 2 && !GREETING_ONLY.test(clean);
}

function nameOk(text: string) {
  return /^[a-z][a-z .'-]{1,30}$/i.test(text.trim());
}

function isSkip(text: string) {
  return SKIP.test(text.trim());
}

function phrase(text: string, kind: "must" | "owned") {
  const items = parseQuestionnaireItems(kind === "must" ? `Must-haves: ${text}` : `Already have: ${text}`);
  const picked = kind === "must" ? items.mustHaves : items.owned;
  return picked.length ? picked.join(", ") : text.replace(/[.]+$/, "");
}

export function parseLooseCount(text: string): number | null {
  return parseMemberCount(text) ?? parseMemberCount(`${text.trim()} people`);
}

export function parseLooseBudget(text: string): number | null {
  const direct = parseBudgetCents(text);
  if (direct) return direct;
  // "1200", "1.5k", "around 900": a number on its own is dollars when the question was the budget.
  const bare = text.trim().match(/^(?:about|around|under|max|maybe|roughly|~)?\s*(\d[\d,]*(?:\.\d{1,2})?\s*k?)\s*(?:total|all in|tops)?[.!]?$/i);
  return bare ? parseBudgetCents(`$${bare[1].replace(/\s+/g, "")}`) : null;
}

export function parseLooseDoor(text: string): number | null {
  const direct = parseDoorWidthIn(text);
  if (direct) return direct;
  const digits = text.trim().match(/^(\d{2}(?:\.\d)?)\s*(?:in|inch|inches|")?$/i);
  if (!digits) return parseDoorWidthIn(`door is ${text}`);
  return parseDoorWidthIn(`door is ${digits[1]} inches`);
}

function withStep(asked: Step[], step: Step): Step[] {
  return asked.includes(step) ? asked : [...asked, step];
}

/** The three things a set can't be built without. */
export function essentials(brief: Brief) {
  return { scene: sceneOk(brief.scene), people: Boolean(brief.people), budget: Boolean(brief.budgetCents) };
}

export function canBuild(brief: Brief) {
  const known = essentials(brief);
  return known.scene && known.people && known.budget;
}

/** Which essential to ask about next, scripted wording included, or null when all three are known. */
export function missingEssential(brief: Brief): "scene" | "people" | "budget" | null {
  const known = essentials(brief);
  if (!known.scene) return "scene";
  if (!known.people) return "people";
  if (!known.budget) return "budget";
  return null;
}

/**
 * Reads one chat answer. A bare number is matched to the question it answers ("How many?" → people,
 * "Budget?" → dollars); anything else goes through the free-text reader.
 */
export function absorbAnswer(brief: Brief, text: string, lastQuestion: string): Brief {
  const clean = text.trim();
  const next = absorbFreeform(brief, clean);
  if (!next.scene && !brief.scene && sceneOk(clean) && !/^\$?\d/.test(clean)) next.scene = clean;
  const bare = /^(?:about|around|under|maybe|~)?\s*\$?\s*\d[\d,.]*\s*k?\s*(?:people|of us|total)?[.!]?$/i.test(clean) || /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/i.test(clean);
  if (!bare) return next;
  const asksBudget = /budget|spend|cost|\$|afford|ceiling|money/i.test(lastQuestion);
  const asksPeople = /how many|people|who|group|headcount|size/i.test(lastQuestion);
  if (asksBudget || clean.includes("$") || /k$/i.test(clean)) {
    const budget = parseLooseBudget(clean);
    if (budget) next.budgetCents = budget;
  } else if (asksPeople || !next.people) {
    const people = parseLooseCount(clean);
    if (people) next.people = people;
  }
  return next;
}

/** Facts from the model fill gaps only; numbers code already parsed are never overwritten. Budget never comes from here. */
export interface ModelFacts {
  scene?: string;
  people?: number;
  style?: string;
  mustHaves?: string[];
  owned?: string[];
  doorWidthIn?: number;
  timing?: string;
  notes?: string;
}

export function mergeFacts(brief: Brief, facts: ModelFacts): Brief {
  const next: Brief = { ...brief, asked: [...brief.asked] };
  if (facts.scene && !sceneOk(next.scene)) next.scene = facts.scene;
  if (facts.people && !next.people) next.people = facts.people;
  if (facts.style && !next.vibe) next.vibe = facts.style;
  if (facts.mustHaves?.length) {
    next.mustHaves = facts.mustHaves.join(", ");
    next.asked = withStep(next.asked, "must");
  }
  if (facts.owned?.length) {
    next.owned = facts.owned.join(", ");
    next.asked = withStep(next.asked, "owned");
  }
  if (facts.doorWidthIn && next.doorIn == null && facts.doorWidthIn >= 20 && facts.doorWidthIn <= 60) next.doorIn = facts.doorWidthIn;
  if (facts.timing && !next.when) next.when = facts.timing;
  if (facts.notes && !next.notes.includes(facts.notes)) next.notes = facts.notes;
  return next;
}

/** What code already knows, sent with each chat turn so the model doesn't ask again. */
export function knownFacts(brief: Brief): Record<string, string> {
  const known: Record<string, string> = {};
  if (sceneOk(brief.scene)) known.scene = brief.scene;
  if (brief.people) known.people = String(brief.people);
  if (brief.budgetCents) known.budget = `$${Math.round(brief.budgetCents / 100).toLocaleString("en-US")} total`;
  if (brief.vibe) known.style = brief.vibe;
  if (brief.mustHaves) known.mustHaves = brief.mustHaves;
  if (brief.owned) known.alreadyOwned = brief.owned;
  if (brief.doorIn) known.doorWidth = `${brief.doorIn} in`;
  if (brief.when) known.timing = brief.when;
  return known;
}
