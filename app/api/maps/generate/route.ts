import { NextResponse } from "next/server";
import { generateMapRequestSchema, readRequest, type ApiErrorBody, type GenerateMapResponse } from "@/lib/contracts";
import { generateMapFromPrompt } from "@/lib/ai/gemini";

export async function POST(request: Request) {
  const parsed = await readRequest(request, generateMapRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const body: GenerateMapResponse = await generateMapFromPrompt(parsed.data.prompt, parsed.data.budgetCents);
    return NextResponse.json(body);
  } catch (error) {
    console.error("Map generation failed", error);
    return NextResponse.json({ error: "Couldn't build a map for that request. Try again." } satisfies ApiErrorBody, { status: 500 });
  }
}
