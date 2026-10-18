import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { payRequestSchema, readRequest, type ApiErrorBody, type PayResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { ensureFundedCard, markPaidByPaymentIntent, quoteShare, recordContribution, requireMember } from "@/lib/db/queries";
import { getStripe } from "@/lib/payments/stripe-client";
import { getEnv } from "@/lib/env";
import type { Contribution } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, payRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const { member } = await requireMember(parsed.data.groupId, user.id);
    const quote = await quoteShare(parsed.data.groupId, member.id);
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
        memberId: member.id,
        amountCents: quote.expectedCents,
        status: "paid",
        stripePaymentIntentId: null,
      });
      const body: PayResponse = { contribution: recorded.contribution, clientSecret: null };
      return NextResponse.json(body);
    }
    // Test mode has no card form yet, so the server confirms with Stripe's test Visa. Live keys never get here (AGENTS.md).
    const testMode = getEnv().STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false;
    const intent = await stripe.paymentIntents.create(
      {
        amount: quote.expectedCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        ...(testMode ? { payment_method: "pm_card_visa", confirm: true } : {}),
        metadata: { groupId: parsed.data.groupId, memberId: member.id },
      },
      { idempotencyKey: `pay:${parsed.data.groupId}:${member.id}:${testMode ? "test-confirm" : "intent"}` },
    );
    const recorded = await recordContribution({
      groupId: parsed.data.groupId,
      memberId: member.id,
      amountCents: quote.expectedCents,
      status: "pending",
      stripePaymentIntentId: intent.id,
    });
    if (intent.status === "succeeded") {
      const body: PayResponse = await confirmContribution(recorded.contribution);
      return NextResponse.json(body);
    }
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
