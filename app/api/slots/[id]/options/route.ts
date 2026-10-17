import { NextResponse } from "next/server";
import type { ApiErrorBody, SlotOptionsResponse } from "@/lib/contracts";
import { getSlotOptions } from "@/lib/search/options";

/** Shuffle stack for a slot: the chosen product first, then real alternatives from search. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const products = await getSlotOptions(id);
    if (!products) {
      return NextResponse.json({ error: `Slot ${id} was not found.` } satisfies ApiErrorBody, { status: 404 });
    }
    const body: SlotOptionsResponse = { products };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Slot options failed", error);
    return NextResponse.json({ error: "Couldn't load options for this slot." } satisfies ApiErrorBody, { status: 500 });
  }
}
