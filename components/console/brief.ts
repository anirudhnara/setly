import type { Question } from "@/lib/ai/interview";
import { parseBudgetCents, parseDoorWidthIn, parseMemberCount, parseQuestionnaireItems } from "@/lib/ai/parse";

/**
 * What step 1 learns, built from the first message and the tapped answers. The composed prompt uses the phrases
 * the map parser already understands ("Must-haves:", "Already have:"), so every ticked item becomes a slot.
 */
export interface Brief {
  scene: string;
  /** Short name for the set, from the question plan. */
  title: string;
  people: number | null;
  budgetCents: number | null;
  /** Things they ticked to buy, and the picker section each came from (the set's branches follow these). */
  mustHaves: string[];
  groups: Record<string, string>;
  owned: string[];
  doorIn: number | null;
  when: string;
  /** Answers to the other questions, as short "Question: answer." lines. */
  notes: string[];
  name: string;
}

export type Mode = "solo" | "group" | "parent" | "insurance";

export function emptyBrief(): Brief {
  return { scene: "", title: "", people: null, budgetCents: null, mustHaves: [], groups: {}, owned: [], doorIn: null, when: "", notes: [], name: "" };
}

const GREETING_ONLY = /^(hi|hey|hello|help|yo|test|idk|ok|okay)[.!\s]*$/i;

/** A first message worth planning from (not just "hi"). */
export function sceneOk(text: string) {
  const clean = text.trim();
  return clean.length >= 2 && !GREETING_ONLY.test(clean);
}

/** Everything the first message already says: the scene, and people or budget when it names them. */
export function readOpening(brief: Brief, text: string): Brief {
  const clean = text.replace(/\s+/g, " ").trim();
  const items = parseQuestionnaireItems(clean);
  return {
    ...brief,
    scene: clean,
    people: parseMemberCount(clean) ?? (/\b(just me|only me|myself)\b/i.test(clean) ? 1 : brief.people),
    budgetCents: parseBudgetCents(clean) ?? brief.budgetCents,
    doorIn: parseDoorWidthIn(clean) ?? brief.doorIn,
    mustHaves: items.mustHaves.length ? items.mustHaves : brief.mustHaves,
    owned: items.owned.length ? items.owned : brief.owned,
  };
}

const TRIP = /\b(camp|camping|trip|hike|hiking|travel|vacation|festival|beach|cabin)\b/i;

/** Typical spend per person, only to suggest sensible budget buttons. The person picks or types the real number. */
const PER_PERSON: Array<[RegExp, number]> = [
  [/\b(fire|flood|insurance|claim|lost|stolen|damage)/i, 2500],
  [TRIP, 150],
  [/\b(dorm|college|campus)/i, 350],
  [/\b(apartment|house|home|move|moving|living ?room)\b/i, 800],
  [/\bkitchen\b/i, 300],
  [/\b(office|desk|study|wfh)/i, 700],
];

function roundNice(dollars: number) {
  const step = dollars < 400 ? 25 : dollars < 1500 ? 50 : 100;
  return Math.max(step, Math.round(dollars / step) * step);
}

function dollars(amount: number) {
  return `$${amount.toLocaleString("en-US")}`;
}

/**
 * The questions code writes itself, shown at once while Gemini plans the rest: how many people (unless it's just
 * them) and the total budget. Budget buttons scale with the kind of set and the headcount. Never from the model.
 */
export function essentialQuestions(brief: Brief, mode: Mode): Question[] {
  const questions: Question[] = [];
  const trip = TRIP.test(brief.scene);
  if (!brief.people && mode !== "solo") {
    const unit = trip ? "of us" : /\b(dorm|room|apartment|house|roommates?)\b/i.test(brief.scene) ? "roommates" : "people";
    questions.push({
      id: "people",
      kind: "single",
      topic: "people",
      ask: trip ? "How many are going?" : "How many people is this for?",
      options: [{ label: "Just me" }, ...[2, 3, 4, 6].map((count) => ({ label: `${count} ${unit}` }))],
    });
  }
  if (!brief.budgetCents) {
    const claim = mode === "insurance" || /\b(insurance|claim)\b/i.test(brief.scene);
    questions.push({
      id: "budget",
      kind: "single",
      topic: "budget",
      ask: claim ? "Roughly how much is the claim for?" : "What’s the budget for everything?",
      hint: "Total for the whole set. Or type any amount.",
      options: budgetOptions(brief, mode).map((amount) => ({ label: dollars(amount) })),
    });
  }
  return questions;
}

export function budgetOptions(brief: Brief, mode: Mode): number[] {
  const perPerson = PER_PERSON.find(([pattern]) => pattern.test(brief.scene))?.[1] ?? (mode === "insurance" ? 2500 : 600);
  const people = brief.people ?? (mode === "solo" ? 1 : 3);
  // Shared things don't scale with headcount, so the base grows slower than people.
  const base = perPerson * (1 + (people - 1) * 0.6);
  return [0.5, 1, 1.6, 2.5].map((factor) => roundNice(base * factor));
}

/** Folds one answered question into the brief. `ok` is false when an essential couldn't be read (ask again). */
export function applyAnswer(brief: Brief, question: Question, values: string[]): { brief: Brief; ok: boolean } {
  const answers = values.map((value) => value.trim()).filter(Boolean);
  const first = answers[0] ?? "";
  const next: Brief = { ...brief, notes: [...brief.notes] };
  switch (question.topic) {
    case "people": {
      const count = /^(just me|only me|me|myself|solo)$/i.test(first) ? 1 : parseLooseCount(first);
      if (!count) return { brief, ok: false };
      next.people = count;
      break;
    }
    case "budget": {
      const cents = parseLooseBudget(first);
      if (!cents) return { brief, ok: false };
      next.budgetCents = cents;
      break;
    }
    case "items":
      next.groups = Object.fromEntries(question.options.filter((option) => option.group && answers.includes(option.label)).map((option) => [option.label, option.group as string]));
      next.mustHaves = answers.filter((item) => !next.owned.includes(item));
      break;
    case "owned":
      next.owned = answers;
      // Owned beats ticked: nothing gets bought twice.
      next.mustHaves = next.mustHaves.filter((item) => !answers.includes(item));
      break;
    case "timing":
      next.when = answers.join(", ");
      if (answers.length) next.notes.push(`${noteLabel(question.ask)}: ${answers.join(", ")}.`);
      break;
    default:
      if (answers.length) next.notes.push(`${noteLabel(question.ask)}: ${answers.join(", ")}.`);
  }
  return { brief: next, ok: true };
}

/** "How big is the living room?" → "How big is the living room", for a compact note line. */
function noteLabel(ask: string) {
  return ask.replace(/[?.!]+$/, "").trim();
}

/** What the person "said" by tapping, for their chat bubble. */
export function answerText(question: Question, values: string[]): string {
  if (values.length === 0) return question.topic === "owned" ? "Nothing yet" : "Skip";
  if (question.kind === "single") return values[0];
  const shown = values.slice(0, 4).join(", ");
  return values.length > 4 ? `${shown} +${values.length - 4} more` : shown;
}

/** Item names go into a comma list the map parser splits on ",", "and", "/" and ends at ".", so those are made safe. */
function listSafe(item: string) {
  return item.replace(/[.()]/g, "").replace(/\s*[,;/]\s*/g, " & ").replace(/\band\b/gi, "&").replace(/\s+/g, " ").trim();
}

export function composePrompt(brief: Brief): string {
  const trip = TRIP.test(brief.scene);
  const lines = [brief.scene.replace(/\s+/g, " ").trim().replace(/[.!]*$/, ".")];
  if (brief.people) lines.push(`${brief.people} ${brief.people === 1 ? "person" : trip ? "people" : "roommates"}.`);
  if (brief.budgetCents) lines.push(`Budget $${Math.round(brief.budgetCents / 100)}.`);
  if (brief.mustHaves.length) lines.push(`Must-haves: ${brief.mustHaves.map(listSafe).join(", ")}.`);
  const sections = [...new Set(brief.mustHaves.map((item) => brief.groups[item]).filter(Boolean))];
  if (sections.length > 1) {
    lines.push(`Branches they picked from: ${sections.map((section) => `${section} (${brief.mustHaves.filter((item) => brief.groups[item] === section).map(listSafe).join("; ")})`).join("; ")}.`);
  }
  if (brief.owned.length) lines.push(`Already have: ${brief.owned.map(listSafe).join(", ")}.`);
  if (brief.doorIn) lines.push(`Door is ${brief.doorIn} inches.`);
  lines.push(...brief.notes);
  return lines.join(" ");
}

export function groupName(brief: Brief): string {
  const base = brief.title || brief.scene.split(/[.,:]/)[0]?.trim() || "Shared plan";
  return base.length > 48 ? `${base.slice(0, 46).trim()}…` : base;
}

export function readyLine(brief: Brief): string {
  const bits = [
    brief.people ? `${brief.people} ${brief.people === 1 ? "person" : "people"}` : "",
    brief.budgetCents ? `${dollars(Math.round(brief.budgetCents / 100))} all in` : "",
    brief.mustHaves.length ? `${brief.mustHaves.length} things on the list` : "",
  ].filter(Boolean);
  return `Perfect: ${bits.join(", ")}. Next, pick your vibe. It takes ten seconds.`;
}

export function parseLooseCount(text: string): number | null {
  return parseMemberCount(text) ?? parseMemberCount(`${text.trim()} people`);
}

export function parseLooseBudget(text: string): number | null {
  const direct = parseBudgetCents(text);
  if (direct) return direct;
  // "1200", "1.5k", "around 900": a number on its own is dollars when the question was the budget.
  const bare = text.trim().match(/^(?:about|around|under|max|maybe|roughly|~)?\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?\s*k?)\s*(?:total|all in|tops)?[.!]?$/i);
  return bare ? parseBudgetCents(`$${bare[1].replace(/\s+/g, "")}`) : null;
}

/** The three things a set can't be built without. */
export function canBuild(brief: Brief) {
  return sceneOk(brief.scene) && Boolean(brief.people) && Boolean(brief.budgetCents);
}
