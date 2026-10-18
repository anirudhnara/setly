import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import type { CurrentUserResponse } from "@/lib/contracts";
import { jsonError } from "@/lib/db/http";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const body: CurrentUserResponse = { user };
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
