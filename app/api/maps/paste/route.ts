import { NextResponse } from "next/server";
import { pasteMapRequestSchema, readRequest, type ApiErrorBody, type PasteMapResponse } from "@/lib/contracts";
import { generateMapFromPaste } from "@/lib/ai/gemini";

export async function POST(request: Request) {
  const parsed = await readRequest(request, pasteMapRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 2 (Maps)): parse the pasted list into slots, then price them from search.
  void parsed.data.groupId;
  const body: PasteMapResponse = await generateMapFromPaste(parsed.data.text);
  return NextResponse.json(body);
}
