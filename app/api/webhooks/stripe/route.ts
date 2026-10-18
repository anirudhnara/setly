import { readText } from "@/lib/security/request";
import { NextResponse } from "next/server";
import { stripeWebhookRequestSchema, type ApiErrorBody, type StripeWebhookResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { markPaidByCheckoutSession, markPaidByPaymentIntent } from "@/lib/db/queries";
import { getEnv } from "@/lib/env";
import { getStripe } from "@/lib/payments/stripe-client";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: "Webhook signature is not configured" } satisfies ApiErrorBody, { status: 400 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" } satisfies ApiErrorBody, { status: 400 });
  }
  let raw: string;
  try {
    raw = await readText(request);
  } catch (error) {
    return jsonError(error);
  }
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature" } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    if (event.livemode) return NextResponse.json({ error: "Live Stripe events are not allowed" }, { status: 400 });
    const parsed = stripeWebhookRequestSchema.safeParse(event);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    if (event.type === "payment_intent.succeeded") {
      const paymentIntentId = paymentIntentIdFrom(event.data.object);
      if (paymentIntentId) await markPaidByPaymentIntent(paymentIntentId);
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id: string;
        amount_total: number | null;
        payment_intent: string | { id: string } | null;
        payment_status: string;
        metadata: Record<string, string> | null;
      };
      const groupId = session.metadata?.groupId;
      const memberId = session.metadata?.memberId;
      const paymentIntentId = paymentIntentIdFrom(session.payment_intent);
      if (session.payment_status === "paid" && session.amount_total !== null && groupId && memberId && paymentIntentId) {
        await markPaidByCheckoutSession({
          sessionId: session.id,
          paymentIntentId,
          groupId,
          memberId,
          amountCents: session.amount_total,
        });
      }
    }
    const body: StripeWebhookResponse = { received: true };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}

function paymentIntentIdFrom(object: unknown) {
  if (!object || typeof object !== "object") return null;
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}
