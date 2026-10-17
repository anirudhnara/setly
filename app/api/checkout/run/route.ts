import { NextResponse } from "next/server";
import { demoCheckoutRequestSchema, readRequest, type ApiErrorBody, type DemoCheckoutResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { getGroupState } from "@/lib/db/queries";
import { getIssuer } from "@/lib/payments";

export async function POST(request: Request) {
  const parsed = await readRequest(request, demoCheckoutRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
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
