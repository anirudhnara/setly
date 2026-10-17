import { NextResponse } from "next/server";
import { payRequestSchema, readRequest, type ApiErrorBody, type PayResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { ensureFundedCard, markPaidByPaymentIntent, quoteShare, recordContribution } from "@/lib/db/queries";
import { getStripe } from "@/lib/payments/stripe-client";
import type { Contribution } from "@/lib/types";

export async function POST(request: Request) {
  const parsed = await readRequest(request, payRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const quote = await quoteShare(parsed.data.groupId, parsed.data.memberId);
    if (quote.existing && (quote.existing.status === "paid" || quote.existing.status === "refunded_partial")) {
      await ensureFundedCard(parsed.data.groupId);
      const body: PayResponse = { contribution: quote.existing, clientSecret: null };
      return NextResponse.json(body);
    }
    if (quote.existing?.status === "pending" && quote.existing.stripePaymentIntentId) {
      const body: PayResponse = await confirmContribution(quote.existing);
      return NextResponse.json(body);
    }
    if (parsed.data.amountCents !== quote.expectedCents) {
      return NextResponse.json({ error: `Share is ${quote.expectedCents} cents` } satisfies ApiErrorBody, { status: 400 });
    }
    const stripe = getStripe();
    if (!stripe) {
      const recorded = await recordContribution({
        groupId: parsed.data.groupId,
        memberId: parsed.data.memberId,
        amountCents: quote.expectedCents,
        status: "paid",
        stripePaymentIntentId: null,
      });
      const body: PayResponse = { contribution: recorded.contribution, clientSecret: null };
      return NextResponse.json(body);
    }
    const intent = await stripe.paymentIntents.create(
      {
        amount: quote.expectedCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: { groupId: parsed.data.groupId, memberId: parsed.data.memberId },
      },
      { idempotencyKey: `pay:${parsed.data.groupId}:${parsed.data.memberId}` },
    );
    const recorded = await recordContribution({
      groupId: parsed.data.groupId,
      memberId: parsed.data.memberId,
      amountCents: quote.expectedCents,
      status: "pending",
      stripePaymentIntentId: intent.id,
    });
    const body: PayResponse = { contribution: recorded.contribution, clientSecret: intent.client_secret };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}

async function confirmContribution(contribution: Contribution): Promise<PayResponse> {
  if (contribution.status !== "pending" || !contribution.stripePaymentIntentId) {
    return { contribution, clientSecret: null };
  }
  const stripe = getStripe();
  if (!stripe) return { contribution, clientSecret: null };
  const intent = await stripe.paymentIntents.retrieve(contribution.stripePaymentIntentId);
  if (intent.status !== "succeeded") return { contribution, clientSecret: intent.client_secret };
  const state = await markPaidByPaymentIntent(intent.id);
  const updated = state?.contributions.find((item) => item.id === contribution.id) ?? { ...contribution, status: "paid" as const };
  return { contribution: updated, clientSecret: null };
}
