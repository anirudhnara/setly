import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { payRequestSchema, readRequest, type ApiErrorBody, type PayResponse } from "@/lib/contracts";
import type { Contribution } from "@/lib/types";

export async function POST(request: Request) {
  const parsed = await readRequest(request, payRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): create a Stripe test-mode PaymentIntent for this member's share.
  const contribution: Contribution = {
    id: `con_${nanoid(8)}`,
    groupId: parsed.data.groupId,
    memberId: parsed.data.memberId,
    amountCents: parsed.data.amountCents,
    stripePaymentIntentId: `pi_test_${nanoid(8)}`,
    status: "pending",
  };
  const body: PayResponse = { contribution, clientSecret: `${contribution.stripePaymentIntentId}_secret_test` };
  return NextResponse.json(body);
}
