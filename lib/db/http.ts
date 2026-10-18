import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/errors";
import type { ApiErrorBody } from "@/lib/contracts";
import { LedgerError } from "@/lib/db/store";

export function jsonError(error: unknown) {
  if (error instanceof LedgerError || error instanceof AuthError) {
    return NextResponse.json({ error: error.message } satisfies ApiErrorBody, { status: error.status });
  }
  throw error;
}
