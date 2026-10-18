import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { demoCheckoutRequestSchema, type ApiErrorBody, type DemoCheckoutResponse } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { jsonError } from "@/lib/db/http";
import { getGroupState, requireMember } from "@/lib/db/queries";
import { getIssuer } from "@/lib/payments";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = await readRequest(request, demoCheckoutRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
    }
    await requireMember(parsed.data.groupId, user.id);
    const result = await getIssuer().runDemoCheckout(parsed.data.groupId);
    const state = await getGroupState(parsed.data.groupId);
    const body: DemoCheckoutResponse = {
      card: result.card,
      authorizations: result.authorizations,
      storeLimits: state?.storeLimits ?? [],
    };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
