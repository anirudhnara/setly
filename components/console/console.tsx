"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUp, BedDouble, Check, Laptop, Mic, RotateCcw, Sofa, Tent } from "lucide-react";
import { LiveSetPreview } from "@/components/console/live-set";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { MODE_INFO } from "@/components/shared/modes";
import { SiteNav } from "@/components/shared/site-nav";
import { formatBudget } from "@/components/shared/format";
import { CreationSteps } from "@/components/shared/creation-steps";
import { readMode, readYou, stageDraft, stageMode, stageYou, watchMode, type FundingMode } from "@/components/shared/session";
import { firebaseConfigured, watchAuth } from "@/lib/auth/client";
import { FIREBASE_SETUP_MESSAGE } from "@/lib/env";
import { interviewTurn, warmInterview } from "@/lib/client";
import {
  QUESTIONS,
  chipsFor,
  RETRY,
  absorbAnswer,
  applyStep,
  canBuild,
  composePrompt,
  emptyBrief,
  essentials,
  groupName,
  knownFacts,
  mergeFacts,
  missingEssential,
  nextStep,
  type Brief,
  type Step,
} from "@/components/console/brief";

interface Line {
  id: string;
  role: "assistant" | "user";
  text: string;
  chips?: string[];
}

interface SpeechRec {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
}

const BUILD_STEPS = ["Reading your answers", "Lining up vibes for you"];
const MODES: FundingMode[] = ["solo", "group", "parent", "insurance"];

/** Tap-to-start ideas on the welcome screen. Each sends its text as the first message. */
const STARTERS = [
  { icon: BedDouble, title: "Dorm move-in", text: "Dorm room for my roommates and me: bed, bath, and storage" },
  { icon: Sofa, title: "First apartment", text: "First apartment living room and kitchen basics" },
  { icon: Tent, title: "Weekend camping trip", text: "Weekend camping trip with friends" },
  { icon: Laptop, title: "Home office", text: "A home office I can work in all day" },
];
const BUILD_STEP_AT_MS = [0, 700];
const MAX_MODEL_QUESTIONS = 6;

export function Console() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  // Without Firebase config the chat can’t sign anyone in, so it explains that instead.
  const [blocked] = useState<string | null>(() => (firebaseConfigured() ? null : FIREBASE_SETUP_MESSAGE));
  const [you, setYou] = useState("");
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [phase, setPhase] = useState<"talk" | "building" | "failed">("talk");
  const [buildStep, setBuildStep] = useState(0);
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<"model" | "script">("model");
  const [step, setStep] = useState<Step>("scene");
  const [modelTurns, setModelTurns] = useState(0);
  const [modelMisses, setModelMisses] = useState(0);
  const [fundingMode, setFundingMode] = useState<FundingMode>("group");
  const scroller = useRef<HTMLDivElement>(null);

  // The nav chip and the welcome screen both change who's paying; keep this screen in step.
  useEffect(() => watchMode(setFundingMode), []);
  const input = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  // Groups belong to signed-in people, so the chat needs a Firebase session before it can build anything.
  useEffect(() => {
    function enter(name: string) {
      setYou(name);
      setBrief((current) => ({ ...current, name }));
      setReady(true);
    }
    if (!firebaseConfigured()) return;
    return watchAuth((user) => {
      if (!user) {
        router.replace(`/sign-in?next=${encodeURIComponent("/home")}`);
        return;
      }
      const name = user.displayName?.trim() || prettyName(user.email ?? "") || "Friend";
      stageYou(name);
      setFundingMode(readMode());
      enter(name);
      void warmInterview();
    });
  }, [router]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines, thinking, phase, buildStep]);

  useEffect(() => {
    if (phase !== "building") return;
    const timers = BUILD_STEP_AT_MS.map((at, index) => window.setTimeout(() => setBuildStep((current) => Math.max(current, index)), at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  function line(role: Line["role"], text: string, chips?: string[]): Line {
    seq.current += 1;
    return { id: `m${seq.current}`, role, text, chips };
  }

  /** Step 1 is done: hand the brief to the vibe step. The set itself is created after the vibe is picked. */
  async function build(next: Brief) {
    setPhase("building");
    setBuildStep(0);
    const person = readYou() || you || next.name || "You";
    stageDraft({
      name: groupName(next),
      prompt: `${composePrompt({ ...next, name: person, vibe: next.vibe || "" })} ${MODE_INFO[fundingMode].promptLine}`.replace(/Style: \./, "").replace(/\s+/g, " ").trim(),
      budgetCents: next.budgetCents ?? 0,
      people: next.people,
    });
    window.setTimeout(() => router.push("/vibes"), 1400);
  }

  /** Scripted interview, used when Gemini is off: one question per step from brief.ts. */
  function scriptedTurn(current: Brief, text: string, history: Line[]) {
    const result = applyStep(current, step, text);
    if (!result.accepted) {
      setLines([...history, line("assistant", RETRY[step], chipsFor(step, current))]);
      return;
    }
    setBrief(result.brief);
    const following = nextStep(result.brief);
    if (!following) {
      setLines([...history, line("assistant", readyLine(result.brief))]);
      void build(result.brief);
      return;
    }
    setStep(following);
    setLines([...history, line("assistant", QUESTIONS[following].ask, chipsFor(following, result.brief))]);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || thinking || phase === "building") return;
    setDraft("");
    const mine = line("user", text);
    const history = [...lines.map((item) => ({ ...item, chips: undefined })), mine];
    setLines(history);

    if (phase === "failed") setPhase("talk");
    if (mode === "script") {
      scriptedTurn(brief, text, history);
      return;
    }

    const lastQuestion = [...lines].reverse().find((item) => item.role === "assistant")?.text ?? "";
    let next = absorbAnswer(brief, text, lastQuestion);
    if (/^(go|go ahead|build it|grow it|that'?s it|done|let'?s go|build my set|grow my set)[.!]*$/i.test(text) && canBuild(next)) {
      setBrief(next);
      setLines([...history, line("assistant", readyLine(next))]);
      void build(next);
      return;
    }

    setThinking(true);
    try {
      const { turn } = await interviewTurn({
        messages: history.slice(-24).map((item) => ({ role: item.role, text: item.text.slice(0, 2000) })),
        known: { ...knownFacts(next), whoPays: MODE_INFO[fundingMode].promptLine },
      });
      if (!turn) {
        // Gemini is off: continue with the scripted questions from wherever the brief is.
        setMode("script");
        const following = nextStep(next);
        setBrief(next);
        if (!following) {
          setLines([...history, line("assistant", readyLine(next))]);
          void build(next);
          return;
        }
        setStep(following);
        setLines([...history, line("assistant", QUESTIONS[following].ask, chipsFor(following, next))]);
        return;
      }
      next = mergeFacts(next, turn.facts);
      setBrief(next);
      setModelMisses(0);
      const asked = modelTurns + 1;
      setModelTurns(asked);
      if (canBuild(next) && (turn.ready || asked >= MAX_MODEL_QUESTIONS)) {
        setLines([...history, line("assistant", turn.ready ? turn.reply : readyLine(next))]);
        void build(next);
        return;
      }
      const gap = turn.ready ? missingEssential(next) : null;
      if (gap) {
        setLines([...history, line("assistant", QUESTIONS[gap].ask, chipsFor(gap, next))]);
        return;
      }
      setLines([...history, line("assistant", turn.reply, turn.chips)]);
    } catch {
      // A slow or rate-limited turn: ask the next scripted question this once, and try Gemini again next turn.
      // Two misses in a row means it's down, so the rest of the chat stays scripted.
      const misses = modelMisses + 1;
      setModelMisses(misses);
      if (misses >= 2) setMode("script");
      const following = nextStep(next) ?? "scene";
      setBrief(next);
      setStep(following);
      setLines([...history, line("assistant", QUESTIONS[following].ask, chipsFor(following, next))]);
    } finally {
      setThinking(false);
      queueMicrotask(() => input.current?.focus());
    }
  }

  function growNow() {
    if (!canBuild(brief) || phase === "building") return;
    setLines((current) => [...current.map((item) => ({ ...item, chips: undefined })), line("assistant", readyLine(brief))]);
    void build(brief);
  }

  function restart() {
    setBrief({ ...emptyBrief(), name: you });
    setLines([]);
    setStep("scene");
    setMode("model");
    setModelTurns(0);
    setPhase("talk");
    setDraft("");
  }

  function speak() {
    if (listening) return;
    const host = window as Window & { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Ctor) {
      input.current?.focus();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    setListening(true);
    rec.onresult = (event) => {
      const heard = event.results[0]?.[0]?.transcript ?? "";
      if (heard) void send(heard);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
  }

  if (blocked) {
    return (
      <main className="sign-in-shell">
        <p className="sign-in-error" role="alert">{blocked}</p>
      </main>
    );
  }

  if (!ready) return <div className="orbit chat-page" />;

  const empty = lines.length === 0;
  const latest = lines[lines.length - 1];
  const busy = thinking || phase === "building";
  const known = essentials(brief);
  const knownCount = Number(known.scene) + Number(known.people) + Number(known.budget);

  return (
    <div className="orbit chat-page">
      <SiteNav />

      <div className="chat-steps"><CreationSteps current={phase === "building" ? 1 : 0} /></div>
      <div className={`chat-layout ${empty ? "is-empty" : ""}`}>
        <main className="chat-main">
          <div className="chat-log" ref={scroller} aria-live="polite">
            {empty ? (
              <section className="chat-hero">
                <span className="hello-badge" aria-hidden="true"><JarvisMark size={46} live={thinking || listening} /></span>
                <h1>Hi {you.split(" ")[0] || "there"}! <em>What are we shopping for?</em></h1>
                <p>Tell me in your own words: a room, a trip, a move. I’ll ask a couple of quick questions, you’ll pick a vibe, and I’ll grow a full set from real stores.</p>
              </section>
            ) : null}

            {lines.map((item, index) => {
              const first = item.role === "assistant" && lines[index - 1]?.role !== "assistant";
              return (
                <div key={item.id} className={`msg ${item.role}`}>
                  {item.role === "assistant" ? <span className="msg-avatar" aria-hidden="true">{first ? <JarvisMark size={28} /> : null}</span> : null}
                  <div className="msg-body">
                    <p>{item.text}</p>
                    {item.chips?.length && item === latest && !busy ? (
                      <div className="msg-chips" role="group" aria-label="Quick answers">
                        {item.chips.map((chip, chipIndex) => (
                          <button key={chip} type="button" className="chip" style={{ "--i": chipIndex } as CSSProperties} onClick={() => void send(chip)}>
                            {chip}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {thinking ? (
              <div className="msg assistant">
                <span className="msg-avatar" aria-hidden="true"><JarvisMark size={28} live /></span>
                <div className="msg-body"><span className="typing" role="status"><i /><i /><i /><span>Thinking</span></span></div>
              </div>
            ) : null}

            {phase === "building" ? <BuildStage step={buildStep} /> : null}
            {phase === "failed" ? (
              <div className="msg assistant">
                <span className="msg-avatar" aria-hidden="true"><JarvisMark size={28} /></span>
                <div className="msg-body">
                  <p>I couldn’t reach the stores just now. Your brief is safe — want me to try again?</p>
                  <div className="msg-chips">
                    <button type="button" className="chip" onClick={() => void build(brief)}>Try again</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {!empty ? (
            <div className="brief-strip" aria-label="What Setly knows so far">
              {[brief.people ? `${brief.people} people` : "", brief.budgetCents ? formatBudget(brief.budgetCents) : "", brief.vibe].filter(Boolean).map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
              <button type="button" className="chip" disabled={!canBuild(brief) || busy} onClick={growNow}>
                Next: vibe <ArrowRight aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <form
            className={`composer ${busy ? "is-busy" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <label className="sr-only" htmlFor="brief-input">Message Setly</label>
            <textarea
              id="brief-input"
              ref={input}
              rows={1}
              value={draft}
              autoFocus
              disabled={phase === "building"}
              placeholder={empty ? "e.g. Living room for 3 roommates, around $1,000" : "Type your answer…"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button type="button" className={`icon-btn ${listening ? "on" : ""}`} aria-label={listening ? "Listening" : "Speak your answer"} disabled={busy} onClick={speak}>
              <Mic aria-hidden="true" />
            </button>
            <button type="submit" className="icon-btn send-btn" aria-label="Send" disabled={busy || !draft.trim()}>
              <ArrowUp aria-hidden="true" />
            </button>
          </form>

          {empty ? (
            <div className="hello-extras">
              <div className="starter-grid" role="group" aria-label="Ideas to start with">
                {STARTERS.map(({ icon: Icon, title, text }, index) => (
                  <button key={title} type="button" className="starter" style={{ "--i": index } as CSSProperties} disabled={busy} onClick={() => void send(text)}>
                    <span className="starter-icon" aria-hidden="true"><Icon /></span>
                    <span className="starter-text"><strong>{title}</strong><span>{text}</span></span>
                  </button>
                ))}
              </div>
              <div className="who-pays" role="radiogroup" aria-label="Who’s paying?">
                <span>Who’s paying?</span>
                {MODES.map((key) => (
                  <button key={key} type="button" role="radio" aria-checked={fundingMode === key} className={fundingMode === key ? "on" : ""} onClick={() => stageMode(key)}>
                    {MODE_INFO[key].label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </main>

        {!empty ? (
          <aside className="brief-card" aria-label="Your set, taking shape">
            <div className="brief-head">
              <span className="orbit-label">{MODE_INFO[fundingMode].label} · your set</span>
              <span className="brief-progress" aria-label={`${knownCount} of 3 essentials known`}>
                {[known.scene, known.people, known.budget].map((done, index) => <i key={index} className={done ? "done" : ""} />)}
              </span>
            </div>
            <LiveSetPreview brief={brief} building={phase === "building"} />
            <button type="button" className="btn btn-accent brief-go" disabled={!canBuild(brief) || busy} onClick={growNow}>
              Next: pick your vibe <ArrowRight aria-hidden="true" />
            </button>
            <p className="brief-note">{canBuild(brief) ? "Or keep answering — every detail sharpens the picks." : "I need what it’s for, how many people, and a total budget."}</p>
            <button type="button" className="btn btn-ghost restart-btn" onClick={restart} disabled={phase === "building"}><RotateCcw aria-hidden="true" /> Start over</button>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function BuildStage({ step }: { step: number }) {
  return (
    <section className="build-stage" aria-label="Building your set">
      <svg className="sprout" viewBox="0 0 120 120" aria-hidden="true">
        <path className="sprout-ground" d="M20 104h80" />
        <path className="sprout-stem" pathLength={1} d="M60 104V52" />
        <path className="sprout-branch s1" pathLength={1} d="M60 80c0-12-10-18-24-18" />
        <path className="sprout-branch s2" pathLength={1} d="M60 70c0-12 10-18 24-18" />
        <path className="sprout-branch s3" pathLength={1} d="M60 58c0-10-6-16-16-20" />
        <path className="sprout-branch s4" pathLength={1} d="M60 54c0-10 6-16 16-22" />
        <circle className="sprout-leaf l1" cx="34" cy="62" r="6" />
        <circle className="sprout-leaf l2" cx="86" cy="52" r="6" />
        <circle className="sprout-leaf l3" cx="43" cy="37" r="5" />
        <circle className="sprout-leaf l4" cx="77" cy="31" r="5" />
        <circle className="sprout-leaf l5 accent" cx="60" cy="46" r="7" />
      </svg>
      <ol className="build-steps">
        {BUILD_STEPS.map((label, index) => (
          <li key={label} className={index < step ? "done" : index === step ? "active" : ""}>
            <span className="build-dot" aria-hidden="true">{index < step ? <Check /> : null}</span>
            {label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function prettyName(email: string) {
  return email.split("@")[0]?.replace(/[._-]+/g, " ").replace(/\d+/g, "").trim().replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? "";
}

function readyLine(brief: Brief) {
  const bits = [`${brief.people} ${brief.people === 1 ? "person" : "people"}`, brief.budgetCents ? `${formatBudget(brief.budgetCents)} all in` : ""].filter(Boolean);
  return `Perfect — ${bits.join(", ")}. Next, show me your vibe: it takes ten seconds.`;
}
