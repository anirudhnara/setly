import { NextResponse } from "next/server";
import type { ApiErrorBody, GetGroupResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { getGroupState } from "@/lib/db/queries";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body: GetGroupResponse | null = await getGroupState(id);
    if (!body) return NextResponse.json({ error: "Group not found" } satisfies ApiErrorBody, { status: 404 });
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
