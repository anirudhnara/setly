import { NextResponse } from "next/server";
import { generateMapFromPrompt } from "@/lib/ai/gemini";
import { createGroupRequestSchema, readRequest, type ApiErrorBody, type CreateGroupResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { createGroup, saveMap } from "@/lib/db/queries";

export async function POST(request: Request) {
  const parsed = await readRequest(request, createGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const created = await createGroup(parsed.data);
    const map = await generateMapFromPrompt(parsed.data.prompt, parsed.data.budgetCents || undefined, created.group.id);
    const body: CreateGroupResponse = await saveMap(created.group.id, map);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
