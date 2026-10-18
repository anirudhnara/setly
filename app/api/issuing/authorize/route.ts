import { NextResponse } from "next/server";
import { authorizeRequestSchema, type ApiErrorBody, type AuthorizeResponse } from "@/lib/contracts";
import { readText } from "@/lib/security/request";
import { getEnv } from "@/lib/env";
import { getStripe } from "@/lib/payments/stripe-client";
import { jsonError } from "@/lib/db/http";
import { getIssuer } from "@/lib/payments";

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    const secret = getEnv().STRIPE_WEBHOOK_SECRET;
    if (!signature || !secret) {
      return NextResponse.json({ error: "Invalid Stripe signature" } satisfies ApiErrorBody, { status: 400 });
    }
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: "Stripe is not configured" } satisfies ApiErrorBody, { status: 503 });
    const raw = await readText(request);
    let payload: unknown;
    try {
      payload = stripe.webhooks.constructEvent(raw, signature, secret);
    } catch {
      return NextResponse.json({ error: "Invalid Stripe signature" } satisfies ApiErrorBody, { status: 400 });
    }
    const parsed = authorizeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const body: AuthorizeResponse = await getIssuer().authorize(parsed.data.cardId, parsed.data.merchant, parsed.data.amountCents);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
