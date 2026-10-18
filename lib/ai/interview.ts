import { z } from "zod";
import { askGeminiJson, describe, geminiConfigured } from "@/lib/ai/llm";

/**
 * The chat that builds the brief. Gemini asks one short, relevant question at a time and returns tappable answers
 * plus the facts it understood. Money never comes from the model: the client parses the budget from what the
 * person typed. When Gemini is off or fails, `turn` is null and the client runs its scripted questions instead.
 */
const INTERVIEW_TIMEOUT_MS = 12_000;

export const interviewMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(2000),
});

export const interviewRequestSchema = z.object({
  messages: z.array(interviewMessageSchema).min(1).max(40),
  /** What code already knows, e.g. { people: "4", budget: "$1,200" }. */
  known: z.record(z.string(), z.string().max(200)).optional(),
});
export type InterviewRequest = z.infer<typeof interviewRequestSchema>;

export const interviewTurnSchema = z.object({
  reply: z.string().min(1).max(400),
  chips: z.array(z.string().min(1).max(40)).max(4),
  facts: z.object({
    scene: z.string().max(140).optional(),
    people: z.number().int().positive().max(50).optional(),
    style: z.string().max(60).optional(),
    mustHaves: z.array(z.string().min(1).max(40)).max(10).optional(),
    owned: z.array(z.string().min(1).max(40)).max(10).optional(),
    doorWidthIn: z.number().positive().max(80).optional(),
    timing: z.string().max(60).optional(),
    notes: z.string().max(300).optional(),
  }),
  ready: z.boolean(),
});
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;
export type InterviewResponse = { turn: InterviewTurn | null };

export const INTERVIEW_SYSTEM = `You are Setly, a warm, sharp personal shopper who builds a complete shopping "set" for a group (roommates furnishing a room, friends packing for a trip, a team kitting out a space).
Your job in this chat is to understand the people well enough that a store search could fill every item. Ask ONE short question per turn (max 20 words). Never ask something you already know.

Essentials (ask for any that are missing first): what the set is for, how many people, the total budget for the whole group.
Then ask 1 to 3 questions that matter most for THIS kind of set, for example:
- rooms: style or colors, what they already own, must-haves, door width for big furniture
- trips: how many nights, season or weather, what gear they already have
- kitchens: how much they cook, what they already have
Prefer questions whose answer changes what gets bought. Skip anything generic.

"reply" MUST end with exactly one question (a "?") unless ready is true. A short warm acknowledgement of their last answer may come first, in a few words.
"chips" are 2 to 4 short tappable answers (max 4 words each) tailored to your question. Include a "Skip" style chip for optional questions.
"facts" holds what the person has told you so far across the whole chat (not guesses). Never put money in facts.
Set "ready" to true once the essentials are known and you've asked the taste questions that matter (at most about 5 questions total), or when the person asks you to go ahead. When ready, "reply" is one short line saying you're building the set, mentioning one detail you picked up.
Never mention specific products, prices, or stores. Plain, friendly language, no emoji.`;

export async function runInterview(request: InterviewRequest): Promise<InterviewTurn | null> {
  if (!geminiConfigured()) return null;
  const transcript = request.messages.map((message) => `${message.role === "user" ? "Person" : "Setly"}: ${message.text}`).join("\n");
  const known = Object.entries(request.known ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  const prompt = `${known ? `Already known from code: ${known}\n\n` : ""}Chat so far:\n${transcript}\n\nWrite Setly's next turn.`;
  try {
    return await askGeminiJson({ prompt, system: INTERVIEW_SYSTEM, schema: interviewTurnSchema, timeoutMs: INTERVIEW_TIMEOUT_MS, temperature: 0.6 });
  } catch (error) {
    console.warn(`Interview fell back to scripted questions: ${describe(error)}`);
    return null;
  }
}
