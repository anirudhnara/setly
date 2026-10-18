import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { approveCheckoutRequestSchema, type ApiErrorBody, type ApproveCheckoutResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { approveCheckout } from "@/lib/checkout/orchestrator";
import { jsonError } from "@/lib/db/http";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, approveCheckoutRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const { groupId, storeOrderId, approve } = parsed.data;
    const body: ApproveCheckoutResponse = await approveCheckout(groupId, user.id, storeOrderId, approve);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
