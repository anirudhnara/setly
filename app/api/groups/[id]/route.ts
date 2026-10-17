import { NextResponse } from "next/server";
import { loadGroupState } from "@/lib/fixtures/sample";
import type { GetGroupResponse } from "@/lib/contracts";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // TODO(Backend 1 (Money)): load the GroupState for this id from the database.
  void id;
  const body: GetGroupResponse = loadGroupState();
  return NextResponse.json(body);
}
