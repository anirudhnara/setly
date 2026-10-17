import { NextResponse } from "next/server";
import { createSlotRequestSchema, readRequest, type ApiErrorBody, type CreateSlotResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { createSlot } from "@/lib/db/queries";

export async function POST(request: Request) {
  const parsed = await readRequest(request, createSlotRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const slot = await createSlot(parsed.data);
    const body: CreateSlotResponse = { slot };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
