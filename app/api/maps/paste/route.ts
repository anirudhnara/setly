import { NextResponse } from "next/server";
import { pasteMapRequestSchema, readRequest, type ApiErrorBody, type PasteMapResponse } from "@/lib/contracts";
import { generateMapFromPaste } from "@/lib/ai/gemini";
import { jsonError } from "@/lib/db/http";
import { getGroupState, saveMap } from "@/lib/db/queries";
import { checkRules } from "@/lib/rules/check";

export async function POST(request: Request) {
  const parsed = await readRequest(request, pasteMapRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  const { text, groupId } = parsed.data;
  try {
    // Fail before spending Gemini and search calls on a group that doesn't exist.
    const state = groupId ? await getGroupState(groupId) : null;
    if (groupId && !state) {
      return NextResponse.json({ error: "Group not found" } satisfies ApiErrorBody, { status: 404 });
    }
    const map: PasteMapResponse = await generateMapFromPaste(text, groupId);
    if (map.slots.length === 0) {
      return NextResponse.json({ error: "No items found in that list." } satisfies ApiErrorBody, { status: 422 });
    }
    if (groupId && state) {
      // Saved maps resolve from the ledger, so their shuffle stacks work on any instance.
      if (state.members.length > 0) map.rules = checkRules(map, state.members);
      await saveMap(groupId, map);
    }
    return NextResponse.json(map);
  } catch (error) {
    try {
      return jsonError(error);
    } catch {
      console.error("Paste parsing failed", error);
      return NextResponse.json({ error: "Couldn't read that list. Try one item per line." } satisfies ApiErrorBody, { status: 500 });
    }
  }
}
