import { NextResponse } from "next/server";
import type { ApiErrorBody } from "@/lib/contracts";
import { LedgerError } from "@/lib/db/store";

export function jsonError(error: unknown) {
  if (error instanceof LedgerError) {
    return NextResponse.json({ error: error.message } satisfies ApiErrorBody, { status: error.status });
  }
  throw error;
}
