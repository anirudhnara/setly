import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { returnItemRequestSchema, type ApiErrorBody, type ReturnItemResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { jsonError } from "@/lib/db/http";
import { requireMember, returnItem } from "@/lib/db/queries";
import { refundContributions } from "@/lib/payments/stripe-refunds";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, returnItemRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    await requireMember(parsed.data.groupId, user.id);
    const result = await returnItem(parsed.data.groupId, parsed.data.productId);
    if (result.created) await refundContributions(result.refunds, result.contributions);
    const body: ReturnItemResponse = { refunds: result.refunds };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
