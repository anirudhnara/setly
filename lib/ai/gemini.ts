import { z } from "zod";
import { getEnv, mockAiEnabled } from "@/lib/env";
import type { MapData } from "@/lib/types";
import { buildMap } from "@/lib/ai/build-map";
import starterStructuresJson from "@/fixtures/starter-structures.json";
import { fixtureMapForPrompt, isCampingPrompt } from "@/lib/ai/fixture-map";
import { applyQuestionnaire, parseBudgetCents, parseDoorWidthIn, parseMemberCount, parsePastedList, parseQuestionnaireItems, type QuestionnaireItems } from "@/lib/ai/parse";
import { MAP_SYSTEM_PROMPT, buildMapPrompt, buildPastePrompt } from "@/lib/ai/prompts";
import { generatedMapSchema, type GeneratedMap } from "@/lib/ai/schemas";
import { searchCatalog, searchProducts } from "@/lib/search/serpapi";

/**
 * Prompt or pasted list → MapData, within the 15 second target:
 * Gemini returns structure only (about 10 s max), then every slot is searched in parallel (6 s max each).
 * Validation failure: retry once, then fall back. Network failure or timeout: fall back right away.
 * The fallback is the starter fixture for prompts and the line parser for pasted lists.
 */
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 8_500;
const DEFAULT_MEMBER_COUNT = 4;

/** zod's JSON Schema minus keywords Gemini's structured output may reject. zod still validates the full schema. */
const SCHEMA_KEYS = new Set(["type", "properties", "required", "items", "enum", "description", "minItems", "maxItems", "minimum", "maximum", "anyOf"]);
function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => SCHEMA_KEYS.has(key))
      .map(([key, child]) => [key, key === "properties" ? Object.fromEntries(Object.entries(child as object).map(([name, inner]) => [name, sanitizeSchema(inner)])) : sanitizeSchema(child)]),
  );
}
const responseJsonSchema = sanitizeSchema(z.toJSONSchema(generatedMapSchema));

export async function generateMapFromPrompt(prompt: string, budgetCents?: number, groupId = ""): Promise<MapData> {
  // 0 means the budget wasn't set; a 0 cent budget would mark every map over budget.
  const budget = budgetCents ? budgetCents : parseBudgetCents(prompt);
  const memberCount = parseMemberCount(prompt);
  const doorWidthIn = parseDoorWidthIn(prompt);
  const items = parseQuestionnaireItems(prompt);
  const fallback = () => starterMapForPrompt(prompt, { budgetCents: budget, memberCount, doorWidthIn, groupId, items });
  if (mockAiEnabled()) return fallback();

  try {
    const generated = applyQuestionnaire(await askGemini(buildMapPrompt(prompt, budget, { memberCount, doorWidthIn, ...items })), items);
    const people = memberCount ?? generated.groupSize ?? DEFAULT_MEMBER_COUNT;
    return await buildMap({ generated, budgetCents: budget, memberCount: people, groupId, doorWidthIn, search: searchProducts });
  } catch (error) {
    console.warn(`Map generation fell back to the starter map: ${describe(error)}`);
    return fallback();
  }
}

export async function generateMapFromPaste(text: string, groupId = ""): Promise<MapData> {
  const budget = parseBudgetCents(text);
  const memberCount = parseMemberCount(text) ?? DEFAULT_MEMBER_COUNT;
  const fromLines = () => buildMap({ generated: parsePastedList(text), budgetCents: budget, memberCount, groupId, search: searchProducts });
  if (mockAiEnabled()) return fromLines();

  try {
    const generated = await askGemini(buildPastePrompt(text));
    return await buildMap({ generated, budgetCents: budget, memberCount, groupId, search: searchProducts });
  } catch (error) {
    console.warn(`Paste parsing fell back to the line parser: ${describe(error)}`);
    return fromLines();
  }
}

/**
 * Sample map without Gemini or SerpApi: a bedroom or home office structure filled from the sample catalog,
 * otherwise the living room or camping fixture.
 */
async function starterMapForPrompt(
  prompt: string,
  options: { budgetCents: number | null; memberCount: number | null; doorWidthIn: number | null; groupId: string; items: QuestionnaireItems },
) {
  const kind = isCampingPrompt(prompt) ? null : /bed ?room|dorm/i.test(prompt) ? "bedroom" : /office|study|desk|work from home|wfh/i.test(prompt) ? "office" : null;
  if (!kind) return fixtureMapForPrompt(prompt, options);
  const generated = applyQuestionnaire(generatedMapSchema.parse(starterStructuresJson[kind]), options.items);
  return buildMap({ ...options, generated, memberCount: options.memberCount ?? 1, search: async (query) => searchCatalog(query) });
}

class ValidationError extends Error {}

async function askGemini(prompt: string): Promise<GeneratedMap> {
  const apiKey = getEnv().GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const started = Date.now();
  let useSchema = true;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = GEMINI_TIMEOUT_MS - (Date.now() - started);
    if (remaining < 2500) break;
    let text: string;
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: MAP_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          ...(useSchema ? { responseJsonSchema } : {}),
          temperature: 0.4,
          abortSignal: AbortSignal.timeout(remaining),
        },
      });
      text = response.text ?? "";
    } catch (error) {
      // A rejected schema is a 400. Ask again with JSON mode only; zod still checks the result.
      if (attempt === 0 && useSchema && /\b400\b|INVALID_ARGUMENT|schema/i.test(describe(error))) {
        useSchema = false;
        continue;
      }
      throw error;
    }
    try {
      return parseGenerated(text);
    } catch (error) {
      if (!(error instanceof ValidationError) || attempt === 1) throw error;
    }
  }
  throw new Error("Gemini ran out of time");
}

/** Parses and validates model output. Exported for tests. */
export function parseGenerated(text: string): GeneratedMap {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ValidationError("Gemini returned text that isn't JSON");
  }
  const parsed = generatedMapSchema.safeParse(json);
  if (!parsed.success) throw new ValidationError(`Gemini output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
