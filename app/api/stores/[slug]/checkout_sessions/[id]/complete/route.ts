import { NextResponse } from "next/server";
import { readRequest } from "@/lib/contracts";
import { completeSession, completeSessionSchema } from "@/lib/stores/server";

export async function POST(request: Request, context: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await context.params;
  const parsed = await readRequest(request, completeSessionSchema);
  if (!parsed.success) return NextResponse.json({ error: "payment_data.token is required" }, { status: 400 });
  const result = await completeSession(slug, id, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
