import { NextResponse } from "next/server";
import { readRequest, updateSlotRequestSchema, type ApiErrorBody, type DeleteSlotResponse, type UpdateSlotResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { deleteSlot, updateSlot } from "@/lib/db/queries";
import type { Slot } from "@/lib/types";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await readRequest(request, updateSlotRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  const patch: Partial<Omit<Slot, "id" | "zoneId">> = {};
  if (parsed.data.need !== undefined) patch.need = parsed.data.need;
  if (parsed.data.quantityRule !== undefined) patch.quantityRule = parsed.data.quantityRule;
  if (parsed.data.quantity !== undefined) patch.quantity = parsed.data.quantity;
  if (parsed.data.budgetCents !== undefined) patch.budgetCents = parsed.data.budgetCents;
  if (parsed.data.payType !== undefined) patch.payType = parsed.data.payType;
  if (parsed.data.ownerMemberId !== undefined) patch.ownerMemberId = parsed.data.ownerMemberId;
  if (parsed.data.chosenProductId !== undefined) patch.chosenProductId = parsed.data.chosenProductId;
  if (parsed.data.updatedBy !== undefined) patch.updatedBy = parsed.data.updatedBy;
  try {
    const slot = await updateSlot(id, patch);
    const body: UpdateSlotResponse = { slot };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await deleteSlot(id);
    const body: DeleteSlotResponse = { id, deleted: true };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
