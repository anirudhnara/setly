import { timingSafeEqual } from "node:crypto";
import { readText } from "@/lib/security/request";
import { NextResponse } from "next/server";
import { demoResetRequestSchema, type DemoResetResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";
import { seedDemoGroup } from "@/lib/db/queries";
import { demoResetEnabled, demoResetToken } from "@/lib/env";

export async function POST(request: Request) {
  if (!demoResetEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = demoResetToken();
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  if (!token || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const text = await readText(request);
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
    }
    const parsed = demoResetRequestSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    await seedDemoGroup();
    const body: DemoResetResponse = { reseeded: true };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
