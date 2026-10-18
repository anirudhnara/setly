import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { readRequest, updateSlotRequestSchema, type ApiErrorBody, type DeleteSlotResponse, type UpdateSlotResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { deleteSlot, requireSlotMember, updateSlot } from "@/lib/db/queries";
import type { Slot } from "@/lib/types";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, updateSlotRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const { member } = await requireSlotMember(id, user.id);
    const patch: Partial<Omit<Slot, "id" | "zoneId">> = { updatedBy: member.id };
    if (parsed.data.need !== undefined) patch.need = parsed.data.need;
    if (parsed.data.quantityRule !== undefined) patch.quantityRule = parsed.data.quantityRule;
    if (parsed.data.quantity !== undefined) patch.quantity = parsed.data.quantity;
    if (parsed.data.budgetCents !== undefined) patch.budgetCents = parsed.data.budgetCents;
    if (parsed.data.payType !== undefined) patch.payType = parsed.data.payType;
    if (parsed.data.ownerMemberId !== undefined) patch.ownerMemberId = parsed.data.ownerMemberId;
    if (parsed.data.chosenProductId !== undefined) patch.chosenProductId = parsed.data.chosenProductId;
    const slot = await updateSlot(id, patch);
    const body: UpdateSlotResponse = { slot };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const user = await requireUser(request);
    await requireSlotMember(id, user.id);
    await deleteSlot(id);
    const body: DeleteSlotResponse = { id, deleted: true };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
