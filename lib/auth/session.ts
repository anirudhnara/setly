import { AuthError } from "@/lib/auth/errors";
import { verifyIdToken } from "@/lib/auth/verify-token";
import { upsertFirebaseUser } from "@/lib/db/users";
import type { User } from "@/lib/types";

export async function requireUser(request: Request): Promise<User> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token) throw new AuthError();
  const identity = await verifyIdToken(token);
  if (!identity.email) throw new AuthError();
  return upsertFirebaseUser({ ...identity, email: identity.email });
}
