import { mockAiEnabled } from "@/lib/env";
import type { MapData } from "@/lib/types";
import { buildMap } from "@/lib/ai/build-map";
import starterStructuresJson from "@/fixtures/starter-structures.json";
import { fixtureMapForPrompt, isCampingPrompt } from "@/lib/ai/fixture-map";
import { askGeminiJson, describe, parseJsonAs } from "@/lib/ai/llm";
import { applyQuestionnaire, parseBudgetCents, parseDoorWidthIn, parseMemberCount, parsePastedList, parseQuestionnaireItems, type QuestionnaireItems } from "@/lib/ai/parse";
import { MAP_SYSTEM_PROMPT, buildMapPrompt, buildPastePrompt } from "@/lib/ai/prompts";
import { rankWithGemini } from "@/lib/ai/rank";
import { generatedMapSchema, type GeneratedMap } from "@/lib/ai/schemas";
import { starterStructure } from "@/lib/ai/structure";
import { searchCatalog, searchProducts } from "@/lib/search/serpapi";

/**
 * Prompt or pasted list → MapData, within the 15 second target:
 * Gemini returns structure only (about 8 s max), every slot is searched in parallel (6 s max each),
 * then Gemini ranks the real results for fit (4.5 s max, skipped on failure).
 * Validation failure: retry once, then fall back. Network failure or timeout: fall back right away.
 * Fallbacks, in order: the starter structure searched in real stores, then the starter fixture (MOCK_AI=1 goes
 * straight to the fixture). Pasted lists fall back to the line parser.
 */
const GEMINI_TIMEOUT_MS = 14_000;
const DEFAULT_MEMBER_COUNT = 4;

export async function generateMapFromPrompt(prompt: string, budgetCents?: number, groupId = ""): Promise<MapData> {
  // 0 means the budget wasn't set; a 0 cent budget would mark every map over budget.
  const budget = budgetCents ? budgetCents : parseBudgetCents(prompt);
  const memberCount = parseMemberCount(prompt);
  const doorWidthIn = parseDoorWidthIn(prompt);
  const items = parseQuestionnaireItems(prompt);
  const fallback = () => starterMapForPrompt(prompt, { budgetCents: budget, memberCount, doorWidthIn, groupId, items });
  if (mockAiEnabled()) return fallback();

  let generated: GeneratedMap;
  let planned = true;
  try {
    generated = applyQuestionnaire(await askGemini(buildMapPrompt(prompt, budget, { memberCount, doorWidthIn, ...items })), items);
  } catch (error) {
    console.warn(`Gemini planning fell back to the starter structure: ${describe(error)}`);
    generated = applyQuestionnaire(starterStructure(prompt), items);
    planned = false;
  }
  try {
    const people = memberCount ?? generated.groupSize ?? DEFAULT_MEMBER_COUNT;
    // Ranking only helps when Gemini is reachable; after a planning failure it would fail the same way.
    const rank = planned ? (slots: Parameters<typeof rankWithGemini>[1]) => rankWithGemini(prompt, slots) : undefined;
    return await buildMap({ generated, budgetCents: budget, memberCount: people, groupId, doorWidthIn, search: searchProducts, rank });
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

function askGemini(prompt: string): Promise<GeneratedMap> {
  return askGeminiJson({ prompt, system: MAP_SYSTEM_PROMPT, schema: generatedMapSchema, timeoutMs: GEMINI_TIMEOUT_MS });
}

/** Parses and validates model output. Exported for tests. */
export function parseGenerated(text: string): GeneratedMap {
  return parseJsonAs(text, generatedMapSchema);
}
