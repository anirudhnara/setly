import { z } from "zod";
import { GEMINI_FAST_MODEL, askGeminiJson, describe, geminiConfigured } from "@/lib/ai/llm";

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

export const INTERVIEW_SYSTEM = `You are Setly, a warm, sharp personal shopper. This chat collects the PRACTICAL specs for a shopping "set" (roommates furnishing a room, friends packing for a trip, a family replacing things after a loss).
Style, mood, colors, and materials are collected in the NEXT step with a visual vibe picker, so NEVER ask about style, vibe, aesthetic, colors, or materials.

Ask ONE short question per turn (max 18 words). Never ask something you already know (see "Already known").
Order:
1. Essentials, if missing: what the set is for, how many people, total budget for the whole group.
2. Then 2 to 4 questions, picking whichever would most change WHAT gets bought or its SIZE right now:
   - space: room size or layout ("small bedroom ~10x10?"), door or stair limits for big furniture
   - existing: what they already own and want to keep (so nothing is bought twice)
   - use: who uses it and how (work from home, gaming, hosting, napping, cooking a lot), pets or kids
   - constraints: renting (no drilling), moving soon, deadline
   - trips: nights, season or weather, how they get there (car or hiking), gear they own
   - insurance claims (whoPays mentions insurance): what was lost and in which rooms, roughly how many items, replace like-for-like or upgrade
Prefer the question whose answer removes or adds whole items over fine details.

"chips" are 2 to 4 short, concrete, tappable answers (max 4 words) to THAT question. Include a "Skip" chip when the question is optional.
"facts" holds what the person has told you across the whole chat (not guesses). Never put money in facts. Put space, use, pets, and constraint details in "notes" as one short phrase.
"reply" MUST end with exactly one question unless ready is true; a 2-5 word acknowledgement of their last answer may come first.
Set "ready" to true once the essentials are known and you've asked the 2 to 4 questions that matter most (at most 6 questions total), or when they ask to continue. When ready, "reply" is one short line saying you've got what you need and next they'll pick the vibe.
No product names, prices, or stores. Plain, friendly language, no emoji.`;

export async function runInterview(request: InterviewRequest): Promise<InterviewTurn | null> {
  if (!geminiConfigured()) return null;
  const transcript = request.messages.map((message) => `${message.role === "user" ? "Person" : "Setly"}: ${message.text}`).join("\n");
  const known = Object.entries(request.known ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  const prompt = `${known ? `Already known from code: ${known}\n\n` : ""}Chat so far:\n${transcript}\n\nWrite Setly's next turn.`;
  try {
    return await askGeminiJson({ prompt, system: INTERVIEW_SYSTEM, schema: interviewTurnSchema, timeoutMs: INTERVIEW_TIMEOUT_MS, temperature: 0.6, model: GEMINI_FAST_MODEL });
  } catch (error) {
    console.warn(`Interview fell back to scripted questions: ${describe(error)}`);
    return null;
  }
}
