import { NextResponse } from "next/server";
import { readRequest, returnItemRequestSchema, type ApiErrorBody, type ReturnItemResponse } from "@/lib/contracts";
import { getIssuer } from "@/lib/payments";

export async function POST(request: Request) {
  const parsed = await readRequest(request, returnItemRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  // TODO(Backend 1 (Money)): refund each payer for this product through Stripe test mode.
  void parsed.data.groupId;
  const refunds = await getIssuer().refundItem(parsed.data.productId);
  const body: ReturnItemResponse = { refunds };
  return NextResponse.json(body);
}
