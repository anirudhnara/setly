"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { watchAuth, type FirebaseAuthUser } from "@/lib/auth/client";

let current: FirebaseAuthUser | null | undefined = undefined;
let startError: string | null = null;
const listeners = new Set<() => void>();
let started = false;
let redirected = false;

function publish() {
  for (const listener of listeners) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    watchAuth((user) => {
      current = user;
      publish();
    });
  } catch (error) {
    startError = error instanceof Error ? error.message : "Sign-in failed";
    current = null;
    publish();
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return current;
}

function serverSnapshot() {
  return undefined;
}

if (typeof window !== "undefined") start();

export function GroupAuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  if (user) {
    redirected = false;
    return children;
  }

  if (user === null && typeof window !== "undefined" && !redirected) {
    redirected = true;
    const next = `/sign-in?next=${encodeURIComponent(pathname)}`;
    if (!window.location.pathname.startsWith("/sign-in")) router.replace(next);
  }

  return (
    <main className="sign-in-shell">
      <p className="sign-in-status">{startError ?? (user === null ? "Sending you to sign-in…" : "Checking sign-in…")}</p>
    </main>
  );
}
