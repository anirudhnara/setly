import { loadMapForPrompt } from "@/lib/fixtures/sample";
import { mockAiEnabled } from "@/lib/env";
import type { MapData } from "@/lib/types";
import { buildMapPrompt, buildPastePrompt } from "@/lib/ai/prompts";
import { generatedMapSchema } from "@/lib/ai/schemas";

export async function generateMapFromPrompt(prompt: string, budgetCents?: number): Promise<MapData> {
  if (mockAiEnabled()) {
    return loadMapForPrompt(prompt);
  }
  // TODO(Backend 2 (Maps)): call Gemini with generatedMapSchema, then fill prices from search.
  void buildMapPrompt(prompt, budgetCents);
  void generatedMapSchema;
  const { GoogleGenAI } = await import("@google/genai");
  void GoogleGenAI;
  throw new Error("not implemented");
}

export async function generateMapFromPaste(text: string): Promise<MapData> {
  if (mockAiEnabled()) {
    return loadMapForPrompt(text);
  }
  // TODO(Backend 2 (Maps)): parse the pasted list with Gemini. Do not accept prices from the model.
  void buildPastePrompt(text);
  throw new Error("not implemented");
}
