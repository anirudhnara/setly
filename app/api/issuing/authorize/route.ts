import { NextResponse } from "next/server";
import { authorizeRequestSchema, readRequest, type ApiErrorBody, type AuthorizeResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { getIssuer } from "@/lib/payments";

export async function POST(request: Request) {
  const parsed = await readRequest(request, authorizeRequestSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() } satisfies ApiErrorBody, { status: 400 });
  }
  try {
    const body: AuthorizeResponse = await getIssuer().authorize(parsed.data.cardId, parsed.data.merchant, parsed.data.amountCents);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
