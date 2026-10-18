import { NextResponse } from "next/server";
import { readRequest } from "@/lib/contracts";
import { createSession, createSessionSchema } from "@/lib/stores/server";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const parsed = await readRequest(request, createSessionSchema);
  if (!parsed.success) return NextResponse.json({ error: "Invalid checkout session" }, { status: 400 });
  const result = createSession(slug, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
