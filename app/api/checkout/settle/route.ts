import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { readRequest, settleCheckoutRequestSchema, type ApiErrorBody, type SettleCheckoutResponse } from "@/lib/contracts";
import { settleCheckout } from "@/lib/checkout/orchestrator";
import { jsonError } from "@/lib/db/http";
import { refundContributions } from "@/lib/payments/stripe-refunds";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, settleCheckoutRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const { state, refunds } = await settleCheckout(parsed.data.groupId, user.id);
    // Ledger rows are written first; Stripe refunds use idempotency keys, so a retry never refunds twice.
    if (refunds.length > 0) await refundContributions(refunds, state.contributions);
    const body: SettleCheckoutResponse = state;
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
