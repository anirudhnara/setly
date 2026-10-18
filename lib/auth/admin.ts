import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { AuthError } from "@/lib/auth/errors";
import type { VerifiedFirebaseUser } from "@/lib/auth/verify-token";
import { getFirebaseAdminCredentials, getFirebaseWebConfig } from "@/lib/env";

/**
 * Check signature, audience, issuer, expiry, revocation, and disabled accounts.
 * Revocation checks require service-account credentials or Application Default Credentials.
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
    const decoded = await adminAuth().verifyIdToken(token, true);
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
