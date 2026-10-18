"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, MessagesSquare, Shuffle, Wallet } from "lucide-react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { readLastGroup } from "@/components/shared/session";
import { signInWithGoogle, watchAuth } from "@/lib/auth/client";

const STEPS = [
  { icon: MessagesSquare, title: "Answer a few questions", text: "Setly asks only what changes what you buy." },
  { icon: Shuffle, title: "Shape the set together", text: "Love, swap, or regrow any piece with real store picks." },
  { icon: Wallet, title: "Split and pay once", text: "Everyone pays their share; one card buys the plan." },
];

export function AuthPage() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [lastGroup, setLastGroup] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    try {
      return watchAuth((user) => {
        setLastGroup(readLastGroup());
        setName(user ? user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "there" : null);
      });
    } catch {
      // Firebase isn't configured here; the sign-in buttons stay, and /sign-in explains what's missing.
    }
  }, []);

  async function google() {
    setError("");
    setPending(true);
    try {
      await signInWithGoogle();
      router.push("/home");
    } catch {
      setError("Google sign-in didn’t finish. Try again, or use email.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="orbit auth-page">
      <div className="auth-topbar">
        <Link className="orbit-brand" href="/" aria-label="Setly home">
          <JarvisMark size={32} />
          <span>setly</span>
        </Link>
        <span className="auth-topline">Group shopping, grown by AI</span>
      </div>
      <div className="auth-layout">
        <section className="auth-intro">
          <span className="orbit-label">Shop as a set</span>
          <h1>Tell us the room.<br /><em className="serif">We’ll grow the set.</em></h1>
          <p>Setly asks a few smart questions, finds a complete set from real stores, and lets everyone in your group love, swap, and split it — then pays with one card that only works for the plan.</p>
          <div className="auth-preview" aria-hidden="true">
            <svg viewBox="0 0 440 220">
              <path className="ap-link trunk" pathLength={1} d="M120 110 C 160 110, 160 60, 200 60" />
              <path className="ap-link trunk t2" pathLength={1} d="M120 110 C 160 110, 160 160, 200 160" />
              <path className="ap-link l1" pathLength={1} d="M262 60 C 285 60, 285 34, 306 34" />
              <path className="ap-link l2" pathLength={1} d="M262 60 C 285 60, 285 86, 306 86" />
              <path className="ap-link l3" pathLength={1} d="M262 160 C 285 160, 285 136, 306 136" />
              <path className="ap-link l4" pathLength={1} d="M262 160 C 285 160, 285 186, 306 186" />
            </svg>
            <span className="ap-root">The set<b>$1,184</b></span>
            <span className="ap-zone z1">Living</span>
            <span className="ap-zone z2">Kitchen</span>
            <span className="ap-leaf f1">Sofa · <b>$549</b></span>
            <span className="ap-leaf f2">Rug · <b>$129</b></span>
            <span className="ap-leaf f3">Kettle · <b>$39</b></span>
            <span className="ap-leaf f4">Mugs ×4 · <b>$32</b></span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="auth-title">
          <span className="orbit-label">{name ? "Welcome back" : "Start a set"}</span>
          <h2 id="auth-title">{name ? `Hi, ${name}.` : "Your first set takes a minute."}</h2>
          <ol className="auth-steps">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} style={{ animationDelay: `${0.25 + index * 0.08}s` }}>
                <span aria-hidden="true"><Icon /></span>
                <div><strong>{title}</strong><p>{text}</p></div>
              </li>
            ))}
          </ol>
          {name ? (
            <>
              <Link className="btn btn-accent auth-submit" href="/home">Start a new set <ArrowRight aria-hidden="true" /></Link>
              {lastGroup ? <Link className="btn btn-ghost auth-secondary" href={`/g/${lastGroup}`}>Open my last set</Link> : null}
            </>
          ) : (
            <>
              <button type="button" className="btn btn-accent auth-submit" disabled={pending} onClick={() => void google()}>
                Continue with Google <ArrowRight aria-hidden="true" />
              </button>
              <Link className="btn btn-ghost auth-secondary" href={`/sign-in?next=${encodeURIComponent("/home")}`}>Use email instead</Link>
            </>
          )}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <p className="auth-prototype">Test mode · payments use Stripe test cards, nothing is charged.</p>
        </section>
      </div>
      <footer className="auth-footer"><span>© Setly</span><span>Claude can tell you what to buy. Setly is how four people actually buy it.</span></footer>
    </main>
  );
}
