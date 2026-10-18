import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { lockGroupRequestSchema, type ApiErrorBody, type LockGroupResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { jsonError } from "@/lib/db/http";
import { lockGroup } from "@/lib/db/queries";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, lockGroupRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid lock request" } satisfies ApiErrorBody, { status: 400 });
    }
    const state = await lockGroup(id, user.id);
    const body: LockGroupResponse = { shares: state.shares, state };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
