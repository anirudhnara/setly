import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { pasteMapRequestSchema, type ApiErrorBody, type PasteMapResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { generateMapFromPaste } from "@/lib/ai/gemini";
import { jsonError } from "@/lib/db/http";
import { requireMember, saveMap } from "@/lib/db/queries";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, pasteMapRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const groupId = parsed.data.groupId;
    if (groupId) await requireMember(groupId, user.id);
    const map = await generateMapFromPaste(parsed.data.text, groupId);
    // With a group, the pasted list becomes that group's map; without one it's a preview.
    const body: PasteMapResponse = groupId ? (await saveMap(groupId, map)).map : map;
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
