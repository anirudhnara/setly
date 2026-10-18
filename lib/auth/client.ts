import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

export type FirebaseAuthUser = User;
import { getFirebaseWebConfig, readFirebaseWebConfig } from "@/lib/env";

export function firebaseConfigured() {
  return readFirebaseWebConfig() !== null;
}

function browserAuth() {
  if (typeof window === "undefined") {
    throw new Error("Firebase Auth runs in the browser");
  }
  const config = getFirebaseWebConfig();
  const app = getApps()[0] ?? initializeApp(config);
  try {
    return initializeAuth(app, { persistence: browserLocalPersistence });
  } catch {
    return getAuth(app);
  }
}

export function watchAuth(onChange: (user: User | null) => void) {
  return onAuthStateChanged(browserAuth(), onChange);
}

export async function currentIdToken() {
  const user = browserAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export function signInWithGoogle() {
  return signInWithPopup(browserAuth(), new GoogleAuthProvider());
}

export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(browserAuth(), email, password);
}

export function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(browserAuth(), email, password);
}

export function signOut() {
  return firebaseSignOut(browserAuth());
}
