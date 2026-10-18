import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { interviewRequestSchema, runInterview, type InterviewResponse } from "@/lib/ai/interview";
import { warmGemini } from "@/lib/ai/llm";
import { jsonError } from "@/lib/db/http";

/** Next chat turn while building the brief. `turn: null` means use the scripted questions (MOCK_AI=1 or Gemini down). */
export async function POST(request: Request) {
  try {
    // Signed-in only: each turn spends Gemini quota.
    await requireUser(request);
    const parsed = await readRequest(request, interviewRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: "Send the chat as { messages: [{ role, text }] }." } satisfies ApiErrorBody, { status: 400 });
    }
    const body: InterviewResponse = { turn: await runInterview(parsed.data) };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}

/** Warms Gemini when the chat opens, so the first question comes back fast. */
export async function GET(request: Request) {
  try {
    await requireUser(request);
    await warmGemini();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
