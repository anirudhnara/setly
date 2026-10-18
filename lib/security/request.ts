import type { z } from "zod";
import { LedgerError } from "@/lib/db/store";

/** Enforce the limit on bytes actually received, even without Content-Length. */
export async function readText(request: Request, maxBytes = 256 * 1024): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) throw new LedgerError("Request body is too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new LedgerError("Request body is too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readRequest<T>(request: Request, schema: z.ZodType<T>) {
  const text = await readText(request);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = undefined;
  }
  return schema.safeParse(payload);
}
