import { z } from "zod";
import { GEMINI_FAST_MODEL, askGeminiJson, geminiConfigured } from "@/lib/ai/llm";
import { VIBES, VIBE_LABELS, vibeFor, type VibeGroup } from "@/lib/catalog/vibes";

/**
 * Step 2: which vibes float in the 3D space for this brief, and where they start. Gemini picks from the fixed
 * vocabulary (code must be able to match products to them) and guesses starting weights from what was said.
 */
const VIBE_TIMEOUT_MS = 12_000;

export const vibeSeedRequestSchema = z.object({
  prompt: z.string().min(1).max(1200),
  mode: z.enum(["solo", "group", "parent", "insurance"]).default("group"),
});
export type VibeSeedRequest = z.input<typeof vibeSeedRequestSchema>;

export interface VibeNodeData {
  label: string;
  group: VibeGroup;
  color: string;
  hint: string;
  weight: number;
}
export type VibeSeedResponse = { title: string; vibes: VibeNodeData[]; source: "gemini" | "rules" };

// Free text is trimmed in code, not rejected: Vertex can't be told length limits, so a long "why" shouldn't fail the turn.
const seedSchema = z.object({
  title: z.string().min(1),
  vibes: z.array(z.object({ label: z.string(), weight: z.number(), why: z.string().optional() })).min(6),
});

const GROUP_LIST = (["Style", "Color", "Material", "Priority"] as const).map((group) => `${group}: ${VIBES.filter((vibe) => vibe.group === group).map((vibe) => vibe.label).join(", ")}`).join("\n");

const SYSTEM = `You set up a visual "vibe picker" for a shopping set. Pick 12 to 16 vibes that are worth choosing between for THIS request. "label" must be copied exactly from these lists (just the label, never the group name):
${GROUP_LIST}
Include several from each group (Style, Color, Material, Priority) that make sense for what's being bought. Skip ones that don't apply (no "Velvet & plush" for camping gear).
"weight" is a starting guess from 0 to 1: 0.5 when nothing was said, higher only if the request clearly points that way (e.g. "on a budget" → Budget-smart 0.8, "small apartment" → Compact 0.75).
"why" is optional, max 8 words, how it applies here. "title" names the set in 2-5 words. JSON only.`;

export async function seedVibes(request: z.infer<typeof vibeSeedRequestSchema>): Promise<VibeSeedResponse> {
  if (geminiConfigured()) {
    try {
      const result = await askGeminiJson({ prompt: `Request: ${request.prompt}\nWho pays: ${request.mode}`, system: SYSTEM, schema: seedSchema, timeoutMs: VIBE_TIMEOUT_MS, temperature: 0.3, model: GEMINI_FAST_MODEL });
      const vibes = cleanSeed(result.vibes);
      if (vibes.length >= 6) return { title: result.title.trim().slice(0, 60), vibes: vibes.slice(0, 18), source: "gemini" };
    } catch (error) {
      console.warn("Vibe seeding fell back to rules");
    }
  }
  return { title: titleFrom(request.prompt), vibes: rulesSeed(request.prompt), source: "rules" };
}

/** Known labels only, no duplicates, weights clamped; the model's "why" replaces the generic hint when given. Exported for tests. */
export function cleanSeed(raw: Array<{ label: string; weight: number; why?: string }>): VibeNodeData[] {
  const seen = new Set<string>();
  const out: VibeNodeData[] = [];
  for (const entry of raw) {
    const vibe = vibeFor(entry.label);
    if (!vibe || seen.has(vibe.label)) continue;
    seen.add(vibe.label);
    out.push({ label: vibe.label, group: vibe.group, color: vibe.color, hint: entry.why?.trim().slice(0, 70) || vibe.hint, weight: Number.isFinite(entry.weight) ? Math.min(1, Math.max(0, entry.weight)) : 0.5 });
  }
  return out;
}

const OUTDOOR = /camp|tent|hike|trail|outdoor|backpack|trip/i;

/** Without Gemini: a sensible set per kind of request, nudged by words in the request. Exported for tests. */
export function rulesSeed(prompt: string): VibeNodeData[] {
  const outdoor = OUTDOOR.test(prompt);
  const skip = outdoor ? new Set(["Velvet & plush", "Boho", "Scandinavian", "Vintage", "Linen & cotton", "Black & white", "Rattan & woven"]) : new Set<string>();
  return VIBE_LABELS.filter((label) => !skip.has(label))
    .slice(0, 16)
    .map((label) => {
      const vibe = vibeFor(label)!;
      const said = vibe.match?.test(prompt) || (label === "Budget-smart" && /budget|cheap|afford|tight/i.test(prompt));
      return { label, group: vibe.group, color: vibe.color, hint: vibe.hint, weight: said ? 0.8 : 0.5 };
    });
}

function titleFrom(prompt: string) {
  const first = prompt.split(/[.!?]/)[0]?.trim() ?? "Your set";
  return first.length > 40 ? `${first.slice(0, 38).trim()}…` : first || "Your set";
}

