import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { joinGroupRequestSchema, readRequest, type ApiErrorBody, type JoinGroupResponse } from "@/lib/contracts";
import { loadGroupState } from "@/lib/fixtures/sample";
import type { Member } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await readRequest(request, joinGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): add the member by name. No login.
  const state = loadGroupState();
  const member: Member = {
    id: `mem_${nanoid(8)}`,
    groupId: id || state.group.id,
    name: parsed.data.name,
    isOrganizer: false,
    joinedAt: new Date().toISOString(),
  };
  const body: JoinGroupResponse = { member, state: { ...state, members: [...state.members, member] } };
  return NextResponse.json(body);
}
