import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import type { GetGroupResponse } from "@/lib/contracts";
import { advanceCheckout } from "@/lib/checkout/orchestrator";
import { jsonError } from "@/lib/db/http";
import { LedgerError, getGroupState } from "@/lib/db/queries";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await requireUser(request);
    const state = await getGroupState(id);
    if (!state) throw new LedgerError("Group not found", 404);
    // The 1s poll is what moves checkout forward: there are no background jobs on Vercel.
    const body: GetGroupResponse = await advanceCheckout(state);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
