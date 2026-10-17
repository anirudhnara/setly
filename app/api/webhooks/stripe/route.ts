import { NextResponse } from "next/server";
import { readRequest, stripeWebhookRequestSchema, type ApiErrorBody, type StripeWebhookResponse } from "@/lib/contracts";

export async function POST(request: Request) {
  const parsed = await readRequest(request, stripeWebhookRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): verify the Stripe signature and mark contributions paid or refunded.
  void parsed.data.type;
  const body: StripeWebhookResponse = { received: true };
  return NextResponse.json(body);
}
