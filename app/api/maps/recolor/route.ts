import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { recolorMap, recolorRequestSchema, type RecolorResponse } from "@/lib/ai/recolor";
import { jsonError } from "@/lib/db/http";
import { requireMember, saveMap } from "@/lib/db/queries";

/** Shuffles the set's colors: each item becomes a different color of the same thing at a similar price. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, recolorRequestSchema);
    if (!parsed.success) return NextResponse.json({ error: "Send { groupId, zoneId? }." } satisfies ApiErrorBody, { status: 400 });
    const { state, member } = await requireMember(parsed.data.groupId, user.id);
    if (state.group.status !== "editing") {
      return NextResponse.json({ error: "This set is locked for payment, so it can't change now." } satisfies ApiErrorBody, { status: 409 });
    }
    const result = await recolorMap(state, member.id, parsed.data.zoneId);
    const map = result.changed > 0 ? (await saveMap(state.group.id, result.map)).map : result.map;
    const body: RecolorResponse = { map, changed: result.changed };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
