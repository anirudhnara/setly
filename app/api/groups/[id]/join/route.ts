import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { joinGroupRequestSchema, type ApiErrorBody, type JoinGroupResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { jsonError } from "@/lib/db/http";
import { joinGroup } from "@/lib/db/queries";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, joinGroupRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const body: JoinGroupResponse = await joinGroup(id, user, parsed.data.name);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
