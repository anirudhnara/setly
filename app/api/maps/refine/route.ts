import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { parseBudgetCents, parseMemberCount } from "@/lib/ai/parse";
import { refineMap, refineRequestSchema, type RefineResponse } from "@/lib/ai/refine";
import { stampChangedSlots } from "@/lib/ai/stamp";
import { jsonError } from "@/lib/db/http";
import { requireMember, saveMap } from "@/lib/db/queries";
import { checkRules } from "@/lib/rules/check";

/** Regrows the group's set from feedback and item reactions, then saves it to the group. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, refineRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: "Send { groupId, message } to refine a set." } satisfies ApiErrorBody, { status: 400 });
    }
    const { groupId, message, history, liked, disliked } = parsed.data;
    if (!message.trim() && liked.length === 0 && disliked.length === 0) {
      return NextResponse.json({ error: "Tell Setly what to change first." } satisfies ApiErrorBody, { status: 400 });
    }
    const { state, member } = await requireMember(groupId, user.id);
    if (state.group.status !== "editing") {
      return NextResponse.json({ error: "This set is locked for payment, so it can't change now." } satisfies ApiErrorBody, { status: 409 });
    }
    if (state.map.slots.length === 0) {
      return NextResponse.json({ error: "This group has no set to refine yet." } satisfies ApiErrorBody, { status: 422 });
    }
    const prompt = state.group.prompt;
    const result = await refineMap({
      prompt,
      history,
      message,
      map: state.map,
      liked,
      disliked,
      budgetCents: state.group.budgetCents || parseBudgetCents(prompt),
      memberCount: state.members.length || parseMemberCount(prompt) || 4,
      groupId,
    });
    if (state.members.length > 0) result.map.rules = checkRules(result.map, state.members);
    result.map = stampChangedSlots(state.map, result.map, member.id);
    await saveMap(groupId, result.map);
    const body: RefineResponse = result;
    return NextResponse.json(body);
  } catch (error) {
    try {
      return jsonError(error);
    } catch {
      console.error("Refine failed");
      return NextResponse.json({ error: "Couldn't regrow the set. Try saying it another way." } satisfies ApiErrorBody, { status: 500 });
    }
  }
}
