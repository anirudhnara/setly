import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { type ApiErrorBody } from "@/lib/contracts";
import { readRequest } from "@/lib/security/request";
import { interviewRequestSchema, planInterview, type InterviewResponse } from "@/lib/ai/interview";
import { warmGemini } from "@/lib/ai/llm";
import { jsonError } from "@/lib/db/http";

/** The questionnaire for a new set, from the first message. Always answers: rules write it when Gemini is off. */
export async function POST(request: Request) {
  try {
    // Signed-in only: planning spends Gemini quota.
    await requireUser(request);
    const parsed = await readRequest(request, interviewRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: "Send { request: \"what you're shopping for\" }." } satisfies ApiErrorBody, { status: 400 });
    }
    const body: InterviewResponse = { plan: await planInterview(parsed.data) };
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
