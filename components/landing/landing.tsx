"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Ban, Check, HeartHandshake, RotateCcw, ShieldCheck, Store, User, Users } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { MODE_INFO } from "@/components/shared/modes";
import { ProductImage } from "@/components/shared/product-image";
import { readMode, stageMode, type FundingMode } from "@/components/shared/session";
import { firebaseConfigured, signInWithGoogle, watchAuth } from "@/lib/auth/client";
import { FIREBASE_SETUP_MESSAGE } from "@/lib/env";
import type { CatalogItem } from "@/lib/catalog/source";

const MODE_ICONS: Record<FundingMode, typeof User> = { solo: User, group: Users, parent: HeartHandshake, insurance: ShieldCheck };
const MODES: FundingMode[] = ["solo", "group", "parent", "insurance"];
type Entry = "/home";

export function Landing({ showcase }: { showcase: CatalogItem[] }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [mode, setMode] = useState<FundingMode>("group");
  const [pending, setPending] = useState<Entry | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured()) {
      queueMicrotask(() => {
        setMode(readMode());
        setError(FIREBASE_SETUP_MESSAGE);
        setSignedIn(false);
      });
      return;
    }
    return watchAuth((user) => {
      setMode(readMode());
      setSignedIn(Boolean(user));
    });
  }, []);

  function choose(next: FundingMode) {
    setMode(next);
    stageMode(next);
  }

  /** Signed in: go straight there. Signed out: Google first, then there (email lives on /sign-in). */
  async function start(entry: Entry) {
    stageMode(mode);
    setError("");
    if (signedIn) {
      router.push(entry);
      return;
    }
    setPending(entry);
    try {
      await signInWithGoogle();
      router.push(entry);
    } catch (caught) {
      const code = typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") setError("Google sign-in was closed before it finished.");
      else if (code === "auth/popup-blocked") setError("The browser blocked the Google window. Allow popups, then try again.");
      else setError("Google sign-in didn’t finish. Try again, or use email.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="landing">
      <header className="lp-head">
        <Link href="/" className="nav-brand" aria-label="Setly">
          <JarvisMark size={30} />
          <span>setly</span>
        </Link>
        <nav className="lp-links" aria-label="On this page">
          <a href="#how">How it works</a>
          <a href="#shield">Protection</a>
        </nav>
        <div className="lp-actions">
          {signedIn ? (
            <Link className="btn btn-accent" href="/home">Open Setly <ArrowRight aria-hidden="true" /></Link>
          ) : (
            <>
              <Link className="btn btn-ghost" href={`/sign-in?next=${encodeURIComponent("/home")}`}>Sign in</Link>
              <button type="button" className="btn btn-accent" onClick={() => void start("/home")} disabled={pending !== null}>Start a set</button>
            </>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-sky" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="b4" /></div>
        <div className="hero-copy">
          <span className="hero-kicker"><span className="spark" aria-hidden="true" /> Group shopping, grown by AI</span>
          <h1>Shop together,<br /><em className="serif">as a set.</em></h1>
          <p>Tell Setly what you need. It grows a complete set from real stores, lets everyone pull what matters closer, and pays with one card that can only buy the plan.</p>
          <div className="hero-ctas">
            <button type="button" className="btn btn-accent" onClick={() => void start("/home")} disabled={pending !== null}>{pending ? "Signing in…" : signedIn ? "Start a set" : "Get started"} <ArrowRight aria-hidden="true" /></button>
            <a className="btn btn-ghost" href="#how">See how it works</a>
          </div>
        </div>
        <Constellation items={showcase} />
      </section>

      <section className="modes" id="modes" aria-labelledby="modes-title">
        <span className="orbit-label">Made for every way you pay</span>
        <h2 id="modes-title">Who’s paying?</h2>
        <div className="mode-grid" role="radiogroup" aria-label="Who’s paying">
          {MODES.map((key, index) => {
            const Icon = MODE_ICONS[key];
            return (
              <button key={key} type="button" role="radio" aria-checked={mode === key} className={`mode-card m-${key}${mode === key ? " on" : ""}`} style={{ "--i": index } as CSSProperties} onClick={() => choose(key)}>
                <span className="mode-icon" aria-hidden="true"><Icon /></span>
                <strong>{MODE_INFO[key].label}</strong>
                <span>{MODE_INFO[key].blurb}</span>
                <span className="mode-check" aria-hidden="true"><Check /></span>
              </button>
            );
          })}
        </div>

        <span className="orbit-label step-2" id="how">How it works</span>
        <h2>Three steps. About two minutes.</h2>
        <ol className="flow">
          <li style={{ "--i": 0 } as CSSProperties}>
            <span className="flow-art chat-art" aria-hidden="true"><i>How many people?</i><i>4 of us</i><i>Small living room?</i></span>
            <span className="flow-num">1</span>
            <strong>Tell us what you need</strong>
            <span>A few quick questions about the space, the people, and the budget. Nothing about style yet.</span>
          </li>
          <li style={{ "--i": 1 } as CSSProperties}>
            <span className="flow-art vibe-art" aria-hidden="true">{["#8fd3ff", "#ff9f7a", "#d9a066", "#f3d9b1", "#c39bff", "#7ee0a8", "#ffd166"].map((color, index) => <i key={color} style={{ "--c": color, "--k": index } as CSSProperties} />)}<b /></span>
            <span className="flow-num">2</span>
            <strong>Pick your vibe in 3D</strong>
            <span>Pull the moods, colors, and materials that feel like you closer. Push the rest away.</span>
          </li>
          <li style={{ "--i": 2 } as CSSProperties}>
            <span className="flow-art tree-art" aria-hidden="true"><b /><i /><i /><i /><em /><em /><em /><em /><em /><em /></span>
            <span className="flow-num">3</span>
            <strong>Get your set as a tree</strong>
            <span>Gemini grows a full set in branches. Tap to swap, add, or remove anything, then split and pay.</span>
          </li>
        </ol>
        <button type="button" className="btn btn-accent start-btn" onClick={() => void start("/home")} disabled={pending !== null}>
          {pending ? "Signing in…" : "Start a set"} <ArrowRight aria-hidden="true" />
        </button>
        {signedIn === false ? <p className="entry-note">Sign in with Google and you’re straight into the chat. Prefer email? <Link href={`/sign-in?next=${encodeURIComponent("/home")}`}>Use email</Link></p> : null}
        {error ? <p className="fault" role="alert">{error}</p> : null}
      </section>

      <section className="shield-band" id="shield" aria-labelledby="shield-title">
        <div className="shield-copy">
          <span className="shield-kicker"><ShieldCheck aria-hidden="true" /> Setly Shield</span>
          <h2 id="shield-title">Every dollar can only buy the plan.</h2>
          <ul>
            <li><Store aria-hidden="true" /><span><b>Locked to your stores.</b> Each set gets one virtual card that works only at its stores, up to each store’s total.</span></li>
            <li><RotateCcw aria-hidden="true" /><span><b>Returns pay people back.</b> Send something back and each payer gets their part, automatically.</span></li>
            <li><ShieldCheck aria-hidden="true" /><span><b>Insurance claims, made whole.</b> After a fire or flood, insurers usually pay part now and the rest after you buy and send receipts. With Setly the insurer funds the full claim up front, the card only buys claim items, and every charge matches a claim line.</span></li>
          </ul>
          <button type="button" className="btn btn-accent" onClick={() => { choose("insurance"); document.getElementById("modes")?.scrollIntoView({ behavior: "smooth" }); }}>Start an insurance claim set <ArrowRight aria-hidden="true" /></button>
        </div>
        <CardDemo />
      </section>

      <footer className="landing-foot">
        <span>© Setly · DubHacks ’26</span>
        <span>Claude can tell you what to buy. Setly is how four people actually buy it.</span>
      </footer>
    </div>
  );
}

/** Real catalog products orbiting a warm core, on three tilted rings. */
function Constellation({ items }: { items: CatalogItem[] }) {
  return (
    <div className="constellation" aria-hidden="true">
      <div className="core"><i /></div>
      {[0, 1, 2].map((ring) => (
        <div key={ring} className={`ring ring-${ring}`}>
          {items.filter((_, index) => index % 3 === ring).map((item, index, list) => (
            <div key={item.id} className="orbiter" style={{ "--a": `${(360 / list.length) * index + ring * 47}deg` } as CSSProperties}>
              <div className="card-chip">
                <ProductImage product={{ id: item.id, slotId: "", title: item.title, store: item.store, priceCents: item.priceCents, url: item.url, imageUrl: item.imageUrl, attributes: {} }} need={item.category} className="chip-image" />
                <span><b>{formatCents(item.priceCents)}</b>{item.store}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const DEMO = [
  { merchant: "IKEA", amount: 12999, ok: true, reason: "In the plan, under IKEA’s $180 limit" },
  { merchant: "Target", amount: 3999, ok: true, reason: "In the plan, under Target’s $60 limit" },
  { merchant: "GiftCardz", amount: 25000, ok: false, reason: "GiftCardz isn’t in this plan" },
  { merchant: "Wayfair", amount: 54900, ok: true, reason: "In the plan, exactly Wayfair’s limit" },
  { merchant: "Target", amount: 9000, ok: false, reason: "Over Target’s remaining $21" },
];

/** A looping card-activity feed: approvals and declines with the plain-English reason Setly logs. */
function CardDemo() {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setShown((count) => (count >= DEMO.length + 2 ? 1 : count + 1)), 1400);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="card-demo" aria-hidden="true">
      <div className="demo-card">
        <span className="vcard-brand">setly</span>
        <span className="demo-chip" />
        <span className="demo-number">•••• 4242</span>
        <span className="demo-name">Living room · 4 people</span>
      </div>
      <ul>
        {DEMO.slice(0, Math.min(shown, DEMO.length)).map((row, index) => (
          <li key={`${row.merchant}${index}`} className={row.ok ? "ok" : "no"}>
            <span className="demo-icon">{row.ok ? <Check /> : <Ban />}</span>
            <span><b>{row.merchant}</b><small>{row.reason}</small></span>
            <em>{formatCents(row.amount)}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
