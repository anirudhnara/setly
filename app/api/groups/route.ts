import { NextResponse } from "next/server";
import { createGroupRequestSchema, readRequest, type ApiErrorBody, type CreateGroupResponse } from "@/lib/contracts";
import { createGroup } from "@/lib/db/queries";
import { jsonError } from "@/lib/db/http";

export async function POST(request: Request) {
  const parsed = await readRequest(request, createGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const body: CreateGroupResponse = await createGroup(parsed.data);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
