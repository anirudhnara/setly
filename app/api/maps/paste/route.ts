import { NextResponse } from "next/server";
import { pasteMapRequestSchema, readRequest, type ApiErrorBody, type PasteMapResponse } from "@/lib/contracts";
import { generateMapFromPaste } from "@/lib/ai/gemini";

export async function POST(request: Request) {
  const parsed = await readRequest(request, pasteMapRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const body: PasteMapResponse = await generateMapFromPaste(parsed.data.text, parsed.data.groupId);
    if (body.slots.length === 0) {
      return NextResponse.json({ error: "No items found in that list." } satisfies ApiErrorBody, { status: 422 });
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error("Paste parsing failed", error);
    return NextResponse.json({ error: "Couldn't read that list. Try one item per line." } satisfies ApiErrorBody, { status: 500 });
  }
}
