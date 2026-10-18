import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { pasteMapRequestSchema, readRequest, type ApiErrorBody, type PasteMapResponse } from "@/lib/contracts";
import { generateMapFromPaste } from "@/lib/ai/gemini";
import { jsonError } from "@/lib/db/http";
import { requireMember } from "@/lib/db/queries";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, pasteMapRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    if (parsed.data.groupId) await requireMember(parsed.data.groupId, user.id);
    // TODO(Backend 2 (Maps)): parse the pasted list into slots, then price them from search.
    const body: PasteMapResponse = await generateMapFromPaste(parsed.data.text);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
