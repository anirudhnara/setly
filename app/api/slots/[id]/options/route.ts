import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import type { ApiErrorBody, SlotOptionsResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { requireSlotMember } from "@/lib/db/queries";
import { getSlotOptions } from "@/lib/search/options";

/** Shuffle stack for a slot: the chosen product first, then real alternatives from search. Members only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const user = await requireUser(request);
    await requireSlotMember(id, user.id);
  } catch (error) {
    return jsonError(error);
  }
  try {
    const products = await getSlotOptions(id);
    if (!products) return NextResponse.json({ error: `Slot ${id} was not found.` } satisfies ApiErrorBody, { status: 404 });
    const body: SlotOptionsResponse = { products };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Slot options failed");
    return NextResponse.json({ error: "Couldn't load options for this slot." } satisfies ApiErrorBody, { status: 500 });
  }
}
