import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { payRequestSchema, readRequest, type ApiErrorBody, type PayResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import {
  ensureFundedCard,
  markPaidByCheckoutSession,
  markPaidByPaymentIntent,
  quoteShare,
  recordContribution,
  replacePendingCheckoutSession,
  requireMember,
} from "@/lib/db/queries";
import { getEnv } from "@/lib/env";
import { getStripe } from "@/lib/payments/stripe-client";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, payRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }

    const { state, member } = await requireMember(parsed.data.groupId, user.id);
    const group = state.group;
    const quote = await quoteShare(parsed.data.groupId, member.id);
    if (quote.existing && (quote.existing.status === "paid" || quote.existing.status === "refunded_partial")) {
      await ensureFundedCard(parsed.data.groupId);
      const body: PayResponse = { contribution: quote.existing, checkoutUrl: null };
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
      const body: PayResponse = { contribution: recorded.contribution, checkoutUrl: null };
      return NextResponse.json(body);
    }

    const env = getEnv();
    if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      return NextResponse.json({ error: "Setly accepts Stripe test-mode payments only" } satisfies ApiErrorBody, { status: 503 });
    }

    const previousReference = quote.existing?.stripePaymentIntentId ?? null;
    if (previousReference?.startsWith("cs_")) {
      const existingSession = await stripe.checkout.sessions.retrieve(previousReference);
      if (existingSession.status === "open" && existingSession.url) {
        const contribution = quote.existing;
        if (!contribution) throw new Error("Pending checkout contribution was not found");
        const body: PayResponse = { contribution, checkoutUrl: existingSession.url };
        return NextResponse.json(body);
      }
      if (existingSession.status === "complete" && existingSession.payment_status === "paid") {
        const paymentIntentId = paymentIntentIdFrom(existingSession.payment_intent);
        if (paymentIntentId) {
          const state = await markPaidByCheckoutSession({
            sessionId: existingSession.id,
            paymentIntentId,
            groupId: parsed.data.groupId,
            memberId: member.id,
            amountCents: existingSession.amount_total ?? -1,
          });
          const contribution = state?.contributions.find((item) => item.memberId === member.id);
          if (contribution) {
            const body: PayResponse = { contribution, checkoutUrl: null };
            return NextResponse.json(body);
          }
        }
        return NextResponse.json({ error: "Stripe completed checkout, but Setly is still syncing the payment" } satisfies ApiErrorBody, { status: 409 });
      }
      if (existingSession.status !== "expired") {
        return NextResponse.json({ error: "This checkout is still processing. Please wait a moment and refresh." } satisfies ApiErrorBody, { status: 409 });
      }
    } else if (previousReference) {
      // Complete any payment started by the earlier in-app PaymentIntent flow before opening Checkout.
      const previousIntent = await stripe.paymentIntents.retrieve(previousReference);
      if (previousIntent.status === "succeeded") {
        const state = await markPaidByPaymentIntent(previousIntent.id);
        const contribution = state?.contributions.find((item) => item.memberId === member.id);
        if (contribution) {
          const body: PayResponse = { contribution, checkoutUrl: null };
          return NextResponse.json(body);
        }
      }
    }

    const successUrl = new URL(`/g/${encodeURIComponent(parsed.data.groupId)}/checkout?payment=success&session_id={CHECKOUT_SESSION_ID}`, env.NEXT_PUBLIC_APP_URL).toString();
    const cancelUrl = new URL(`/g/${encodeURIComponent(parsed.data.groupId)}/checkout?payment=cancelled`, env.NEXT_PUBLIC_APP_URL).toString();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: quote.expectedCents,
              product_data: {
                name: `Setly contribution · ${group.name}`,
                description: "Your share of this group purchase (test mode)",
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: member.id,
        metadata: { groupId: parsed.data.groupId, memberId: member.id },
        payment_intent_data: { metadata: { groupId: parsed.data.groupId, memberId: member.id } },
      },
      { idempotencyKey: `pay:${parsed.data.groupId}:${member.id}:${previousReference ?? "first-checkout"}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");

    const recorded = previousReference
      ? await replacePendingCheckoutSession({
          groupId: parsed.data.groupId,
          memberId: member.id,
          amountCents: quote.expectedCents,
          previousReference,
          sessionId: session.id,
        })
      : await recordContribution({
          groupId: parsed.data.groupId,
          memberId: member.id,
          amountCents: quote.expectedCents,
          status: "pending",
          stripePaymentIntentId: session.id,
        });

    const body: PayResponse = { contribution: recorded.contribution, checkoutUrl: session.url };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}

function paymentIntentIdFrom(value: string | { id: string } | null) {
  return typeof value === "string" ? value : value?.id ?? null;
}
