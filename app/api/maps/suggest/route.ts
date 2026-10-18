import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { suggestForZone, suggestRequestSchema, type SuggestResponse } from "@/lib/ai/suggest";
import { jsonError } from "@/lib/db/http";
import { requireMember } from "@/lib/db/queries";

/** Ideas to grow one branch of the set: Gemini's suggestions, each with a real product. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, suggestRequestSchema);
    if (!parsed.success) return NextResponse.json({ error: "Send { groupId, zoneId }." } satisfies ApiErrorBody, { status: 400 });
    const { state } = await requireMember(parsed.data.groupId, user.id);
    const body: SuggestResponse = { ideas: await suggestForZone(state, parsed.data.zoneId) };
    return NextResponse.json(body);
  } catch (error) {
    try {
      return jsonError(error);
    } catch {
      console.error("Branch ideas failed");
      return NextResponse.json({ error: "Couldn’t grow ideas for that branch. Try again." } satisfies ApiErrorBody, { status: 500 });
    }
  }
}
