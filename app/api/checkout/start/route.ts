import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { startCheckoutRequestSchema, type ApiErrorBody, type StartCheckoutResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { startCheckout } from "@/lib/checkout/orchestrator";
import { jsonError } from "@/lib/db/http";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, startCheckoutRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    const body: StartCheckoutResponse = await startCheckout(parsed.data.groupId, user.id, parsed.data.address);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
