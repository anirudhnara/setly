"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { firebaseConfigured, signInWithEmail, signInWithGoogle, signUpWithEmail, watchAuth } from "@/lib/auth/client";
import { FIREBASE_SETUP_MESSAGE } from "@/lib/env";

function nextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function signInMessage(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = String(error.code);
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      return "That email and password did not match.";
    }
    if (code === "auth/email-already-in-use") return "An account already exists for that email.";
    if (code === "auth/weak-password") return "Use a password of at least 6 characters.";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Google sign-in was closed before it finished.";
    if (code === "auth/popup-blocked") return "The browser blocked the Google window. Allow popups, then try again.";
  }
  return "Sign-in failed. Try again.";
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new MutationObserver(() => {
      if (node.style.display === "none") {
        setError(null);
        setPending(false);
      }
    });
    observer.observe(node, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  function finish() {
    router.push(nextPath(searchParams.get("next")));
  }

  useEffect(() => {
    if (!firebaseConfigured()) {
      setSetup(FIREBASE_SETUP_MESSAGE);
      return;
    }
    return watchAuth((user) => {
      if (user) finish();
    });
  }, [router, searchParams]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      finish();
    } catch (caught) {
      setError(signInMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="sign-in-shell" ref={rootRef}>
      <section className="dialog">
        <p className="dialog-kicker">SETLY</p>
        <h1>Sign in</h1>
        <p>Google or email. Your groups stay in Postgres.</p>
        {setup ? <p className="sign-in-error" role="alert">{setup}</p> : null}
        {error ? <p className="sign-in-error" role="alert">{error}</p> : null}
        <button type="button" className="dialog-primary" disabled={pending || Boolean(setup)} onClick={() => void run(() => signInWithGoogle())}>
          Continue with Google
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => signInWithEmail(email, password));
          }}
        >
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit" className="dialog-primary" disabled={pending || Boolean(setup)}>Sign in</button>
          <button type="button" className="sign-in-secondary" disabled={pending || Boolean(setup)} onClick={() => void run(() => signUpWithEmail(email, password))}>
            Create account
          </button>
        </form>
      </section>
    </main>
  );
}
