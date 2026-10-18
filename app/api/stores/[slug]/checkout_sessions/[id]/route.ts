import { NextResponse } from "next/server";
import { readRequest } from "@/lib/contracts";
import { getSession, updateSession, updateSessionSchema } from "@/lib/stores/server";

type Context = { params: Promise<{ slug: string; id: string }> };

export async function GET(_request: Request, context: Context) {
  const { slug, id } = await context.params;
  const result = getSession(slug, id);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request, context: Context) {
  const { slug, id } = await context.params;
  const parsed = await readRequest(request, updateSessionSchema);
  if (!parsed.success) return NextResponse.json({ error: "Invalid checkout session update" }, { status: 400 });
  const result = updateSession(slug, id, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
