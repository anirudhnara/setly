import { z } from "zod";
import { GEMINI_FAST_MODEL, GEMINI_MODEL, askGeminiJson, describe, geminiConfigured } from "@/lib/ai/llm";
import { starterStructure } from "@/lib/ai/structure";

/**
 * Step 1 of a new set. From the person's first message, Gemini thinks once and writes the whole questionnaire:
 * a big "what do you need?" picker with many real things to buy, plus the few choices that change what gets bought
 * or its size. The person then taps through it with no waiting between questions. Money never comes from the
 * model: people and budget questions are written by code, and the client parses the answers.
 * Gemini off or failing: the same shape is built from the set builder's branches, so the chat still works.
 */
const PLAN_TIMEOUT_MS = 14_000;
/** When the quick model joins the race, if the thinking model hasn't answered yet. */
const HEDGE_AFTER_MS = 5_000;
const THINKING_BUDGET = 512;

export const interviewRequestSchema = z.object({
  /** What the person typed first ("dorm for 3 roommates"). */
  request: z.string().min(1).max(2000),
  /** What code already knows, e.g. { people: "4", budget: "$1,200", whoPays: "Split across the group." }. */
  known: z.record(z.string(), z.string().max(200)).optional(),
});
export type InterviewRequest = z.infer<typeof interviewRequestSchema>;

export type QuestionTopic = "items" | "owned" | "people" | "budget" | "space" | "use" | "timing" | "other";

export interface QuestionOption {
  label: string;
  /** A few words under the label ("fits a twin XL bed"). */
  detail?: string;
  /** Section in the items picker ("Sleep", "Bath"); the set's branches follow these. */
  group?: string;
  /** Pre-ticked in a multi-select: what most people in this situation need. */
  pick?: boolean;
}

export interface Question {
  id: string;
  kind: "single" | "multi";
  topic: QuestionTopic;
  ask: string;
  hint?: string;
  options: QuestionOption[];
}

export interface QuestionPlan {
  title: string;
  /** One line showing what Setly understood, said back before the first question. */
  understood: string;
  questions: Question[];
  source: "gemini" | "rules";
}
export type InterviewResponse = { plan: QuestionPlan };

// Lengths are trimmed in code (Vertex can't be told string limits), so the schema only checks shape.
const modelPlanSchema = z.object({
  title: z.string(),
  understood: z.string(),
  questions: z.array(
    z.object({
      kind: z.enum(["single", "multi"]),
      topic: z.enum(["items", "owned", "space", "use", "timing", "other"]),
      ask: z.string(),
      hint: z.string().optional(),
      options: z.array(z.object({ label: z.string(), detail: z.string().optional(), group: z.string().optional(), pick: z.boolean().optional() })),
    }),
  ),
});
type ModelPlan = z.infer<typeof modelPlanSchema>;

export const INTERVIEW_SYSTEM = `You are Setly, an expert personal shopper who has outfitted thousands of dorms, apartments, trips, and insurance replacements. From the person's first message, write the short questionnaire that lets you build them a complete, well-chosen shopping set. Think carefully about THIS person's situation before writing: who they are, where it goes, what they'll actually use, what people in this situation forget, and what changes sizes or quantities.

Return JSON: "title" (2-4 word name for the set, e.g. "Dorm for 3"), "understood" (one warm sentence, max 22 words, saying back what you understood, no question), and "questions" (3 to 5, in this order):

1. EXACTLY ONE topic "items", kind "multi": "What should we get?" style. This is the heart of it. Offer 12 to 20 concrete things to buy, specific to their situation (dorm: "Twin XL sheet set", "Mattress topper", "Shower caddy"; not "Bedding"). Give every option a "group" (3 to 5 groups total, 1-2 words, like "Sleep", "Bath", "Storage", "Desk", "Kitchen"); the groups become the set's branches. Set "pick": true on the 6 to 10 that most people in their exact situation need; leave nice-to-haves unpicked. Add a 2-5 word "detail" when it helps choose (size, why it matters). Don't offer things they said they already have.
2. Optionally ONE topic "owned", kind "multi": "Anything you already have?" with 5 to 8 big or pricey items from your list people often own already. No "pick".
3. One or two kind "single" questions (topic "space", "use", or "timing") whose answers change WHAT gets bought or its SIZE: room or bed size, who uses it and how (work from home, cooks a lot, pets), renting limits, trip nights or season, move-in date. 3 to 5 options each, concrete and mutually exclusive ("Small, about 10x12 ft", "Twin XL bed"). Never ask something the message already answers.

Rules: questions max 12 words, friendly and plain. Never ask about style, colors, materials, or vibe (the next step covers that). Never ask how many people or the budget (code asks those). No prices, stores, brands, or product names. No emoji.`;

/** The whole questionnaire for a first message. Never throws: falls back to rules. */
export async function planInterview(request: InterviewRequest): Promise<QuestionPlan> {
  const fallback = () => rulesPlan(request);
  if (!geminiConfigured()) return fallback();
  const known = Object.entries(request.known ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  const prompt = `The person wrote: "${request.request}"${known ? `\nAlready known: ${known}` : ""}\n\nWrite the questionnaire.`;
  const stop = new AbortController();
  const ask = (model: string, thinkingBudget: number, timeoutMs: number) =>
    askGeminiJson({ prompt, system: INTERVIEW_SYSTEM, schema: modelPlanSchema, timeoutMs, temperature: 0.5, model, thinkingBudget, signal: stop.signal });
  // The thinking model writes better questions; the quick one joins if it's slow, and the first good plan wins.
  const main = ask(GEMINI_MODEL, THINKING_BUDGET, PLAN_TIMEOUT_MS);
  const backup = new Promise<ModelPlan>((resolve, reject) => {
    const timer = setTimeout(() => ask(GEMINI_FAST_MODEL, 0, PLAN_TIMEOUT_MS - HEDGE_AFTER_MS).then(resolve, reject), HEDGE_AFTER_MS);
    main.then(() => {
      clearTimeout(timer);
      reject(new Error("not needed"));
    }, () => undefined);
  });
  try {
    const plan = cleanPlan(await Promise.any([main, backup]));
    return plan ?? fallback();
  } catch (error) {
    const reasons = error instanceof AggregateError ? error.errors.map(describe).filter((reason) => reason !== "not needed") : [describe(error)];
    console.warn(`Question planning fell back to rules: ${reasons.join("; ")}`);
    return fallback();
  } finally {
    stop.abort();
  }
}

const clip = (text: string | undefined, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const MONEY = /\$|\bprice|\bbudget|\bhow many (people|of you)/i;

/** Trims the model's plan to what the chat can show, or null when it has no usable items picker. Exported for tests. */
export function cleanPlan(raw: ModelPlan): QuestionPlan | null {
  const questions: Question[] = [];
  let itemsSeen = false;
  for (const [index, question] of raw.questions.entries()) {
    const ask = clip(question.ask, 90);
    if (!ask || MONEY.test(ask)) continue;
    if (question.topic === "items" && itemsSeen) continue;
    const seen = new Set<string>();
    const multi = question.kind === "multi" || question.topic === "items" || question.topic === "owned";
    const options = question.options
      .map((option) => ({
        label: clip(option.label, 40),
        detail: clip(option.detail, 50) || undefined,
        group: question.topic === "items" ? clip(option.group, 20) || "More" : undefined,
        pick: question.topic === "items" ? Boolean(option.pick) : undefined,
      }))
      .filter((option) => option.label && !MONEY.test(option.label) && !seen.has(option.label.toLowerCase()) && seen.add(option.label.toLowerCase()))
      .slice(0, question.topic === "items" ? 24 : multi ? 10 : 6);
    if (options.length < 2) continue;
    if (question.topic === "items") itemsSeen = true;
    questions.push({ id: `q${index}`, kind: multi ? "multi" : "single", topic: question.topic, ask, hint: clip(question.hint, 90) || undefined, options });
  }
  if (!itemsSeen) return null;
  // The items picker leads; the rest keep the model's order.
  questions.sort((a, b) => Number(b.topic === "items") - Number(a.topic === "items"));
  return { title: clip(raw.title, 40) || "Your set", understood: clip(raw.understood, 180), questions: questions.slice(0, 5), source: "gemini" };
}

/** The same questionnaire without Gemini: the set builder's branches become the items picker. Exported for tests. */
export function rulesPlan(request: InterviewRequest): QuestionPlan {
  const structure = starterStructure(request.request);
  const options = structure.zones.flatMap((zone) =>
    zone.slots.map((slot, index) => ({ label: slot.need, group: zone.name, pick: index < 3 })),
  );
  const questions: Question[] = [
    { id: "items", kind: "multi", topic: "items", ask: "What should we get? Untick anything you don’t need.", options },
    { id: "owned", kind: "multi", topic: "owned", ask: "Anything you already have?", options: options.slice(0, 8).map(({ label }) => ({ label })) },
  ];
  if (!/camp|trip|hike|tent/i.test(request.request)) {
    questions.push({
      id: "space",
      kind: "single",
      topic: "space",
      ask: "How big is the space?",
      options: [{ label: "Small", detail: "about 10×10 ft" }, { label: "Medium", detail: "about 12×14 ft" }, { label: "Large", detail: "15 ft or more" }],
    });
  }
  return { title: request.request.split(/[.,:]/)[0]?.trim().slice(0, 40) || "Your set", understood: "Got it. A few quick taps and I’ll have what I need.", questions, source: "rules" };
}
