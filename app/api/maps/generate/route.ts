import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { generateMapRequestSchema, readRequest, type ApiErrorBody, type GenerateMapResponse } from "@/lib/contracts";
import { generateMapFromPrompt } from "@/lib/ai/gemini";
import { jsonError } from "@/lib/db/http";

export async function POST(request: Request) {
  try {
    await requireUser(request);
    const parsed = await readRequest(request, generateMapRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    // TODO(Backend 2 (Maps)): replace the fixture switch with Gemini plus search prices.
    const body: GenerateMapResponse = await generateMapFromPrompt(parsed.data.prompt, parsed.data.budgetCents);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
