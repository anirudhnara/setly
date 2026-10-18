import { z } from "zod";
import { getEnv, mockAiEnabled } from "@/lib/env";

/**
 * One way to ask Gemini for JSON. Every call is validated against a zod schema:
 * a validation failure retries once, then throws so the caller can fall back.
 * A rejected key or a disabled API (401/403) pauses Gemini for a minute instead of failing slowly on every request.
 */
export const GEMINI_MODEL = "gemini-2.5-flash";
const BLOCKED_PAUSE_MS = 60_000;

export class ValidationError extends Error {}

const state = globalThis as typeof globalThis & { __setlyGeminiBlockedUntil?: number; __setlyGeminiWarmAt?: number };

export function geminiConfigured() {
  if (mockAiEnabled()) return false;
  try {
    return Boolean(getEnv().GEMINI_API_KEY);
  } catch {
    return false;
  }
}

/** zod's JSON Schema minus keywords Gemini's structured output may reject. zod still validates the full schema. */
// Vertex rejects numeric bounds (minimum, maxItems) with a bare 400, so they stay zod-only.
const SCHEMA_KEYS = new Set(["type", "properties", "required", "items", "enum", "description", "anyOf"]);
function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => SCHEMA_KEYS.has(key))
      .map(([key, child]) => [key, key === "properties" ? Object.fromEntries(Object.entries(child as object).map(([name, inner]) => [name, sanitizeSchema(inner)])) : sanitizeSchema(child)]),
  );
}

const jsonSchemas = new WeakMap<z.ZodType, unknown>();
function jsonSchemaFor(schema: z.ZodType) {
  let cached = jsonSchemas.get(schema);
  if (cached === undefined) {
    cached = sanitizeSchema(z.toJSONSchema(schema));
    jsonSchemas.set(schema, cached);
  }
  return cached;
}

/** Strips a fenced block, parses, and validates. Throws ValidationError on either failure. */
export function parseJsonAs<T>(text: string, schema: z.ZodType<T>, label = "Gemini"): T {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ValidationError(`${label} returned text that isn't JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ValidationError(`${label} output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data;
}

export interface AskJsonOptions<T> {
  prompt: string;
  system: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  temperature?: number;
}

export async function askGeminiJson<T>({ prompt, system, schema, timeoutMs, temperature = 0.4 }: AskJsonOptions<T>): Promise<T> {
  if (!geminiConfigured()) throw new Error("Gemini is off (MOCK_AI=1 or no key)");
  if ((state.__setlyGeminiBlockedUntil ?? 0) > Date.now()) throw new Error("Gemini is paused after an access error");
  const apiKey = getEnv().GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const { GoogleGenAI } = await import("@google/genai");
  // "AQ." keys are Vertex AI express-mode keys; "AIza" keys are AI Studio keys. Both reach Gemini through the same SDK.
  const vertex = apiKey.startsWith("AQ.");
  const ai = client(vertex, apiKey, GoogleGenAI);
  const started = Date.now();
  let useSchema = true;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining < 1500) break;
    let text: string;
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          ...(useSchema ? { [vertex ? "responseSchema" : "responseJsonSchema"]: jsonSchemaFor(schema) } : {}),
          temperature,
          // Structured answers don't need reasoning tokens, and skipping them keeps turns under a second.
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(remaining),
        },
      });
      text = response.text ?? "";
    } catch (error) {
      const message = describe(error);
      if (/\b(401|403)\b|PERMISSION_DENIED|API key not valid|has not been used|is disabled/i.test(message)) {
        state.__setlyGeminiBlockedUntil = Date.now() + BLOCKED_PAUSE_MS;
        throw new Error("Gemini rejected the key or the API is disabled for this project");
      }
      // A rejected schema is a 400. Ask again with JSON mode only; zod still checks the result.
      if (attempt === 0 && useSchema && /\b400\b|INVALID_ARGUMENT|schema/i.test(message)) {
        useSchema = false;
        continue;
      }
      throw error;
    }
    try {
      return parseJsonAs(text, schema);
    } catch (error) {
      if (!(error instanceof ValidationError) || attempt === 1) throw error;
    }
  }
  throw new Error("Gemini ran out of time");
}

type GenAICtor = typeof import("@google/genai").GoogleGenAI;
const clients = globalThis as typeof globalThis & { __setlyGemini?: { key: string; ai: InstanceType<GenAICtor> } };

/** One client per key, so connections are reused: the first Gemini call is slow, the rest are fast. */
function client(vertex: boolean, apiKey: string, Ctor: GenAICtor) {
  if (clients.__setlyGemini?.key !== apiKey) {
    clients.__setlyGemini = { key: apiKey, ai: new Ctor(vertex ? { vertexai: true, apiKey } : { apiKey }) };
  }
  return clients.__setlyGemini.ai;
}

export function describe(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

/** Opens the Gemini connection ahead of the first real question (the first call is several seconds slower). */
export async function warmGemini() {
  if (!geminiConfigured() || (state.__setlyGeminiWarmAt ?? 0) > Date.now() - 5 * 60_000) return;
  state.__setlyGeminiWarmAt = Date.now();
  try {
    await askGeminiJson({ prompt: "Reply {\"ok\":true}", system: "Reply with JSON only.", schema: z.object({ ok: z.boolean() }), timeoutMs: 15_000, temperature: 0 });
  } catch {
    // Warming is best effort.
  }
}
