import { NextResponse } from "next/server";
import { readRequest, updateSlotRequestSchema, type ApiErrorBody, type DeleteSlotResponse, type UpdateSlotResponse } from "@/lib/contracts";
import { loadGroupState } from "@/lib/fixtures/sample";
import type { Slot } from "@/lib/types";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await readRequest(request, updateSlotRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): update the slot and record who changed it.
  const current = loadGroupState().map.slots.find((slot) => slot.id === id) ?? loadGroupState().map.slots[0];
  const slot: Slot = {
    ...current,
    ...parsed.data,
    id: current.id,
    ownerMemberId: parsed.data.ownerMemberId === undefined ? current.ownerMemberId : parsed.data.ownerMemberId,
    chosenProductId: parsed.data.chosenProductId === undefined ? current.chosenProductId : parsed.data.chosenProductId,
    updatedBy: parsed.data.updatedBy === undefined ? current.updatedBy : parsed.data.updatedBy,
    updatedAt: new Date().toISOString(),
  };
  const body: UpdateSlotResponse = { slot };
  return NextResponse.json(body);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // TODO(Backend 1 (Money)): delete the slot and its product links.
  const body: DeleteSlotResponse = { id, deleted: true };
  return NextResponse.json(body);
}
