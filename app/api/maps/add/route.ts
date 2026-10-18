import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { readRequest, type ApiErrorBody, type GetGroupResponse } from "@/lib/contracts";
import { addRequestSchema, addToZone } from "@/lib/ai/suggest";
import { jsonError } from "@/lib/db/http";
import { requireMember, saveMap } from "@/lib/db/queries";

/** Adds a suggested item to a branch. The product is re-found on the server, so prices are the store's. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, addRequestSchema);
    if (!parsed.success) return NextResponse.json({ error: "Send { groupId, zoneId, need, searchQuery, productId }." } satisfies ApiErrorBody, { status: 400 });
    const { state } = await requireMember(parsed.data.groupId, user.id);
    if (state.group.status !== "editing") return NextResponse.json({ error: "This set is locked for payment, so it can’t change now." } satisfies ApiErrorBody, { status: 409 });
    const map = await addToZone(state, parsed.data);
    if (!map) return NextResponse.json({ error: "That item isn’t available anymore. Grow ideas again." } satisfies ApiErrorBody, { status: 404 });
    const body: GetGroupResponse = await saveMap(state.group.id, map);
    return NextResponse.json(body);
  } catch (error) {
    try {
      return jsonError(error);
    } catch {
      console.error("Adding to the set failed", error);
      return NextResponse.json({ error: "Couldn’t add that. Try again." } satisfies ApiErrorBody, { status: 500 });
    }
  }
}
