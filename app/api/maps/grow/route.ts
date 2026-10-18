import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody, type GetGroupResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { generateMapFromPrompt } from "@/lib/ai/gemini";
import { stampChangedSlots } from "@/lib/ai/stamp";
import { jsonError } from "@/lib/db/http";
import { requireMember, saveMap } from "@/lib/db/queries";
import { checkRules } from "@/lib/rules/check";

const growRequestSchema = z.object({ groupId: z.string().min(1) });

/**
 * Grows the group's first set from its prompt and saves it, so every member sees the same products.
 * Idempotent: a group that already has a set gets it back unchanged instead of spending searches again.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, growRequestSchema);
    if (!parsed.success) return NextResponse.json({ error: "Send { groupId }." } satisfies ApiErrorBody, { status: 400 });
    const { state, member } = await requireMember(parsed.data.groupId, user.id);
    if (state.map.slots.length > 0 || state.group.status !== "editing") {
      const body: GetGroupResponse = state;
      return NextResponse.json(body);
    }
    const grown = await generateMapFromPrompt(state.group.prompt, state.group.budgetCents || undefined, state.group.id);
    if (state.members.length > 0) grown.rules = checkRules(grown, state.members);
    const map = stampChangedSlots(state.map, grown, member.id);
    const body: GetGroupResponse = await saveMap(state.group.id, map);
    return NextResponse.json(body);
  } catch (error) {
    try {
      return jsonError(error);
    } catch {
      console.error("Growing the set failed");
      return NextResponse.json({ error: "Couldn't grow the set. Try again." } satisfies ApiErrorBody, { status: 500 });
    }
  }
}
