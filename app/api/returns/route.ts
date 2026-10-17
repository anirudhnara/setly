import { NextResponse } from "next/server";
import { readRequest, returnItemRequestSchema, type ApiErrorBody, type ReturnItemResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { returnItem } from "@/lib/db/queries";
import { refundContributions } from "@/lib/payments/stripe-refunds";

export async function POST(request: Request) {
  const parsed = await readRequest(request, returnItemRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const result = await returnItem(parsed.data.groupId, parsed.data.productId);
    if (result.created) await refundContributions(result.refunds, result.contributions);
    const body: ReturnItemResponse = { refunds: result.refunds };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
