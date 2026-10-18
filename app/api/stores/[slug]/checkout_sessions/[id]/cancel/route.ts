import { NextResponse } from "next/server";
import { cancelSession } from "@/lib/stores/server";

export async function POST(_request: Request, context: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await context.params;
  const result = cancelSession(slug, id);
  return NextResponse.json(result.body, { status: result.status });
}
