import { NextResponse } from "next/server";
import { authorizeRequestSchema, readRequest, type ApiErrorBody, type AuthorizeResponse } from "@/lib/contracts";
import { loadGroupState } from "@/lib/fixtures/sample";
import { getIssuer } from "@/lib/payments";

export async function POST(request: Request) {
  const parsed = await readRequest(request, authorizeRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): authorize against the persisted card. This stub uses sample store limits.
  const state = loadGroupState();
  const limits = new Map<string, number>();
  for (const product of state.map.products) {
    const slot = state.map.slots.find((item) => item.id === product.slotId);
    if (!slot || slot.payType === "already_owned") continue;
    const amount = slot.payType === "per_person" ? product.priceCents * slot.quantity * state.members.length : product.priceCents * slot.quantity;
    limits.set(product.store, (limits.get(product.store) ?? 0) + amount);
  }
  const card = await getIssuer().createCard(state.group.id, [...limits.entries()].map(([store, limitCents]) => ({ store, limitCents })));
  const body: AuthorizeResponse = await getIssuer().authorize(card.id, parsed.data.merchant, parsed.data.amountCents);
  return NextResponse.json(body);
}
