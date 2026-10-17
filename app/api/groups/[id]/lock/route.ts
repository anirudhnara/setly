import { NextResponse } from "next/server";
import { lockGroupRequestSchema, readRequest, type ApiErrorBody, type LockGroupResponse } from "@/lib/contracts";
import { loadGroupState } from "@/lib/fixtures/sample";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await readRequest(request, lockGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): lock the map and persist computeShares for this group.
  void id;
  void parsed.data.memberId;
  const state = loadGroupState();
  const body: LockGroupResponse = {
    shares: state.shares,
    state: { ...state, group: { ...state.group, status: "funding" } },
  };
  return NextResponse.json(body);
}
