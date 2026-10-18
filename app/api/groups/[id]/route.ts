import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import type { GetGroupResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { LedgerError, getGroupState } from "@/lib/db/queries";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await requireUser(request);
    const state = await getGroupState(id);
    if (!state) throw new LedgerError("Group not found", 404);
    const body: GetGroupResponse = state;
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
