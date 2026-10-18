import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createSlotRequestSchema, type ApiErrorBody, type CreateSlotResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { jsonError } from "@/lib/db/http";
import { createSlot, requireZoneMember } from "@/lib/db/queries";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, createSlotRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    await requireZoneMember(parsed.data.zoneId, user.id);
    const slot = await createSlot(parsed.data);
    const body: CreateSlotResponse = { slot };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
