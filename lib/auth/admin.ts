import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { AuthError } from "@/lib/auth/errors";
import type { VerifiedFirebaseUser } from "@/lib/auth/verify-token";
import { getFirebaseAdminCredentials, getFirebaseWebConfig } from "@/lib/env";

/**
 * Verifying an ID token only needs the project id: firebase-admin checks the signature against Google's public keys,
 * plus audience, issuer, and expiry. A service account is used when configured; otherwise the public project id is enough.
 */
function adminAuth() {
  const credentials = getFirebaseAdminCredentials();
  if (getApps()[0]) return getAuth(getApps()[0]);
  if (credentials) {
    return getAuth(initializeApp({ credential: cert({ projectId: credentials.projectId, clientEmail: credentials.clientEmail, privateKey: credentials.privateKey }) }));
  }
  let projectId: string;
  try {
    projectId = process.env.FIREBASE_PROJECT_ID || getFirebaseWebConfig().projectId;
  } catch {
    throw new AuthError();
  }
  return getAuth(initializeApp({ projectId }));
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === "string" ? decoded.email : null,
      name: typeof decoded.name === "string" ? decoded.name : null,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError();
  }
}
