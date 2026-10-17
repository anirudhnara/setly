import { NextResponse } from "next/server";
import { createGroupRequestSchema, readRequest, type ApiErrorBody, type CreateGroupResponse } from "@/lib/contracts";
import { loadGroupState } from "@/lib/fixtures/sample";

export async function POST(request: Request) {
  const parsed = await readRequest(request, createGroupRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): insert the group, the organizer, and an empty map.
  const sample = loadGroupState();
  const body: CreateGroupResponse = {
    ...sample,
    group: {
      ...sample.group,
      name: parsed.data.name,
      prompt: parsed.data.prompt,
      budgetCents: parsed.data.budgetCents,
      status: "editing",
    },
  };
  return NextResponse.json(body);
}
