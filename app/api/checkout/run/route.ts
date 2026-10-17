import { NextResponse } from "next/server";
import { demoCheckoutRequestSchema, readRequest, type ApiErrorBody, type DemoCheckoutResponse } from "@/lib/contracts";
import { getIssuer } from "@/lib/payments";
import type { StoreLimit } from "@/lib/types";

export async function POST(request: Request) {
  const parsed = await readRequest(request, demoCheckoutRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): run checkout only after the group is fully funded.
  const issuer = getIssuer();
  const result = await issuer.runDemoCheckout(parsed.data.groupId);
  const spent = new Map<string, number>();
  for (const authorization of result.authorizations) {
    if (!authorization.approved) continue;
    spent.set(authorization.merchant, (spent.get(authorization.merchant) ?? 0) + authorization.amountCents);
  }
  const storeLimits: StoreLimit[] = [...spent.entries()].map(([store, limitCents]) => ({
    cardId: result.card.id,
    store,
    limitCents,
    spentCents: limitCents,
  }));
  const body: DemoCheckoutResponse = { card: result.card, authorizations: result.authorizations, storeLimits };
  return NextResponse.json(body);
}
