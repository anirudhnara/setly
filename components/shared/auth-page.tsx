"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { stageYou } from "@/components/shared/session";

type Mode = "signup" | "login";

export function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    const displayName = mode === "signup"
      ? name.trim()
      : cleanEmail.split("@")[0]?.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Friend";

    if (mode === "signup" && displayName.length < 2) {
      setError("Please enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    // Prototype only: the backend will own credentials and session creation.
    stageYou(displayName);
    router.push("/home");
  }

  return (
    <main className="orbit auth-page">
      <div className="auth-topbar">
        <Link className="auth-brand" href="/" aria-label="Setly home">
          <JarvisMark size={33} />
          <span>setly</span>
        </Link>
        <span className="auth-topline">MAKE A PLAN. MAKE IT HAPPEN.</span>
      </div>
      <div className="auth-layout">
        <section className="auth-intro">
          <span className="auth-overline">SHOP BETTER, TOGETHER</span>
          <h1>Good plans<br /><em>start together.</em></h1>
          <p>Bring your ideas, people, and budget into one shared plan. Setly keeps the details in one place so getting started feels easy.</p>
          <div className="auth-preview" aria-hidden="true">
            <div className="auth-preview-line" />
            <span className="auth-preview-node auth-node-one">Sofa</span>
            <span className="auth-preview-node auth-node-two">Lighting</span>
            <span className="auth-preview-node auth-node-three">Rug</span>
            <span className="auth-preview-center"><JarvisMark size={47} /></span>
          </div>
          <div className="auth-trust"><span>✦</span> Plans everyone can feel good about.</div>
        </section>

        <section id="auth-panel" className="auth-card" role="tabpanel" aria-labelledby={mode === "signup" ? "signup-tab" : "login-tab"}>
          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button id="signup-tab" type="button" role="tab" aria-controls="auth-panel" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button>
            <button id="login-tab" type="button" role="tab" aria-controls="auth-panel" aria-selected={mode === "login"} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
          </div>
          <span className="auth-overline">{mode === "signup" ? "A LITTLE SPACE TO PLAN" : "GOOD TO SEE YOU AGAIN"}</span>
          <h2 id="auth-title">{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-card-sub">{mode === "signup" ? "Start a shared plan in just a few steps." : "Pick up where your group left off."}</p>
          <form onSubmit={submit}>
            {mode === "signup" ? (
              <label className="auth-field">
                <span>Your name</span>
                <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex Morgan" required minLength={2} />
              </label>
            ) : null}
            <label className="auth-field">
              <span>Email address</span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <span className="auth-password-wrap">
                <input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" required minLength={8} />
                <button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
              </span>
            </label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="auth-submit" type="submit">{mode === "signup" ? "Create account" : "Log in"}<span aria-hidden="true">→</span></button>
          </form>
          <p className="auth-prototype">Preview mode · Account access will connect to Setly soon.</p>
          <p className="auth-swap">{mode === "signup" ? "Already have an account?" : "New to Setly?"} <button type="button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}>{mode === "signup" ? "Log in" : "Sign up"}</button></p>
        </section>
      </div>
      <footer className="auth-footer"><span>© Setly</span><span>Group plans, made real.</span></footer>
    </main>
  );
}
