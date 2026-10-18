import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { seedVibes, vibeSeedRequestSchema, type VibeSeedResponse } from "@/lib/ai/vibes";
import { jsonError } from "@/lib/db/http";

/** The vibes that float in step 2 for this brief, with starting weights. */
export async function POST(request: Request) {
  try {
    await requireUser(request);
    const parsed = await readRequest(request, vibeSeedRequestSchema);
    if (!parsed.success) return NextResponse.json({ error: "Send { prompt } from the chat." } satisfies ApiErrorBody, { status: 400 });
    const body: VibeSeedResponse = await seedVibes(parsed.data);
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
