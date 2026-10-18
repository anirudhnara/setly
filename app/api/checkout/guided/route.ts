import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { guidedPurchaseRequestSchema, type ApiErrorBody, type GuidedPurchaseResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { recordGuidedPurchase } from "@/lib/checkout/orchestrator";
import { jsonError } from "@/lib/db/http";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, guidedPurchaseRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const body: GuidedPurchaseResponse = await recordGuidedPurchase(parsed.data.groupId, user.id, parsed.data.storeOrderId);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
