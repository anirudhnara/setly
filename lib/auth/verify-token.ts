export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  name: string | null;
}

export type TokenVerifier = (token: string) => Promise<VerifiedFirebaseUser>;

let testVerifier: TokenVerifier | null = null;

/** Tests replace Firebase verification. Production calls firebase-admin only when this is unset. */
export function setTokenVerifierForTests(verifier: TokenVerifier | null) {
  testVerifier = verifier;
}

export async function verifyIdToken(token: string): Promise<VerifiedFirebaseUser> {
  if (testVerifier) return testVerifier(token);
  const { verifyFirebaseIdToken } = await import("@/lib/auth/admin");
  return verifyFirebaseIdToken(token);
}
