import { NextResponse } from "next/server";
import { lockGroupRequestSchema, readRequest, type ApiErrorBody, type LockGroupResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { lockGroup } from "@/lib/db/queries";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await readRequest(request, lockGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const state = await lockGroup(id, parsed.data.memberId);
    const body: LockGroupResponse = { shares: state.shares, state };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
