import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { createSlotRequestSchema, readRequest, type ApiErrorBody, type CreateSlotResponse } from "@/lib/contracts";
import type { Slot } from "@/lib/types";

export async function POST(request: Request) {
  const parsed = await readRequest(request, createSlotRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): insert the slot on the group's map.
  const slot: Slot = {
    id: `slot_${nanoid(8)}`,
    zoneId: parsed.data.zoneId,
    need: parsed.data.need,
    quantityRule: parsed.data.quantityRule,
    quantity: parsed.data.quantity,
    budgetCents: parsed.data.budgetCents,
    payType: parsed.data.payType,
    ownerMemberId: parsed.data.ownerMemberId ?? null,
    chosenProductId: null,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
  };
  const body: CreateSlotResponse = { slot };
  return NextResponse.json(body);
}
