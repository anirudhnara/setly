import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { chooseRequestSchema, type ChooseResponse } from "@/lib/ai/refine";
import { stampChangedSlots } from "@/lib/ai/stamp";
import { jsonError } from "@/lib/db/http";
import { requireMember, saveMap } from "@/lib/db/queries";
import { checkRules } from "@/lib/rules/check";
import { findSlotOption } from "@/lib/search/options";

/**
 * Puts one of a slot's options on the group's set. The product is looked up again from search on the server,
 * so the price, store, and link saved are the search data, never what a browser sent.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, chooseRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: "Send { groupId, slotId, productId }." } satisfies ApiErrorBody, { status: 400 });
    }
    const { groupId, slotId, productId } = parsed.data;
    const { state, member } = await requireMember(groupId, user.id);
    if (state.group.status !== "editing") {
      return NextResponse.json({ error: "This set is locked for payment, so it can't change now." } satisfies ApiErrorBody, { status: 409 });
    }
    const slot = state.map.slots.find((item) => item.id === slotId);
    if (!slot) return NextResponse.json({ error: "That item isn't on this set anymore." } satisfies ApiErrorBody, { status: 404 });
    const product = await findSlotOption(slotId, productId);
    if (!product) return NextResponse.json({ error: "That option is no longer available. Open the options again." } satisfies ApiErrorBody, { status: 404 });
    const map = stampChangedSlots(state.map, {
      ...state.map,
      slots: state.map.slots.map((item) => (item.id === slotId ? { ...item, chosenProductId: product.id } : item)),
      products: [...state.map.products.filter((item) => item.slotId !== slotId), { ...product, slotId }],
    }, member.id);
    if (state.members.length > 0) map.rules = checkRules(map, state.members);
    const saved = await saveMap(groupId, map);
    const body: ChooseResponse = saved.map;
    return NextResponse.json(body);
  } catch (error) {
    try {
      return jsonError(error);
    } catch {
      console.error("Choose failed");
      return NextResponse.json({ error: "Couldn't swap that item. Try again." } satisfies ApiErrorBody, { status: 500 });
    }
  }
}
