import { NextResponse } from "next/server";
import { joinGroupRequestSchema, readRequest, type ApiErrorBody, type JoinGroupResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { joinGroup } from "@/lib/db/queries";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await readRequest(request, joinGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const body: JoinGroupResponse = await joinGroup(id, parsed.data.name);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
