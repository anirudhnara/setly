"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, Check, Mic, RotateCcw, Sparkles } from "lucide-react";
import { Orb } from "@/components/console/orb";
import { LiveSetPreview } from "@/components/console/live-set";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { formatBudget } from "@/components/shared/format";
import { readYou, stageMap, stageMember, stageYou } from "@/components/shared/session";
import { firebaseConfigured, signOut, watchAuth } from "@/lib/auth/client";
import { FIREBASE_SETUP_MESSAGE } from "@/lib/env";
import { createGroup, growMap, interviewTurn, warmInterview } from "@/lib/client";
import {
  QUESTIONS,
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

const BUILD_STEPS = ["Reading your brief", "Planning the set", "Searching real stores", "Picking the best fit for you", "Growing your map"];
const BUILD_STEP_AT_MS = [0, 1800, 5500, 11000, 17000];
const MAX_MODEL_QUESTIONS = 6;

export function Console() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
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
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  // Groups belong to signed-in people, so the chat needs a Firebase session before it can build anything.
  useEffect(() => {
    function enter(name: string) {
      setYou(name);
      setBrief((current) => ({ ...current, name }));
      setReady(true);
    }
    if (!firebaseConfigured()) {
      setBlocked(FIREBASE_SETUP_MESSAGE);
      return;
    }
    return watchAuth((user) => {
      if (!user) {
        router.replace(`/sign-in?next=${encodeURIComponent("/home")}`);
        return;
      }
      const name = user.displayName?.trim() || prettyName(user.email ?? "") || "Friend";
      stageYou(name);
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

  async function build(next: Brief) {
    setPhase("building");
    setBuildStep(0);
    try {
      const person = readYou() || you || next.name || "You";
      const prompt = composePrompt({ ...next, name: person, vibe: next.vibe || "practical" });
      const created = await createGroup({ name: groupName(next), prompt, budgetCents: next.budgetCents ?? 0 });
      const organizer = created.members.find((member) => member.isOrganizer) ?? created.members[0];
      if (organizer) stageMember(created.group.id, { memberId: organizer.id, name: organizer.name });
      // The set is grown and saved on the server, so everyone who joins sees the same products.
      const grown = await growMap(created.group.id).catch(() => null);
      if (grown) stageMap(created.group.id, grown.map);
      setBuildStep(BUILD_STEPS.length);
      window.setTimeout(() => window.location.assign(`/g/${created.group.id}`), 650);
    } catch {
      setPhase("failed");
    }
  }

  /** Scripted interview, used when Gemini is off: one question per step from brief.ts. */
  function scriptedTurn(current: Brief, text: string, history: Line[]) {
    const result = applyStep(current, step, text);
    if (!result.accepted) {
      setLines([...history, line("assistant", RETRY[step], QUESTIONS[step].chips)]);
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
    setLines([...history, line("assistant", QUESTIONS[following].ask, QUESTIONS[following].chips)]);
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
        known: knownFacts(next),
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
        setLines([...history, line("assistant", QUESTIONS[following].ask, QUESTIONS[following].chips)]);
        return;
      }
      next = mergeFacts(next, turn.facts);
      setBrief(next);
      const asked = modelTurns + 1;
      setModelTurns(asked);
      if (canBuild(next) && (turn.ready || asked >= MAX_MODEL_QUESTIONS)) {
        setLines([...history, line("assistant", turn.ready ? turn.reply : readyLine(next))]);
        void build(next);
        return;
      }
      const gap = turn.ready ? missingEssential(next) : null;
      if (gap) {
        setLines([...history, line("assistant", QUESTIONS[gap].ask, QUESTIONS[gap].chips)]);
        return;
      }
      setLines([...history, line("assistant", turn.reply, turn.chips)]);
    } catch {
      setMode("script");
      const following = nextStep(next) ?? "scene";
      setBrief(next);
      setStep(following);
      setLines([...history, line("assistant", QUESTIONS[following].ask, QUESTIONS[following].chips)]);
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
      <header className="chat-top">
        <Link href="/" className="orbit-brand" aria-label="Setly home">
          <JarvisMark size={30} />
          <span>setly</span>
        </Link>
        <div className="chat-top-actions">
          {!empty ? (
            <button type="button" className="btn btn-ghost chat-restart" onClick={restart} disabled={phase === "building"}>
              <RotateCcw aria-hidden="true" /> New set
            </button>
          ) : null}
          <span className="chat-you" aria-label={`Signed in as ${you}`}>
            <span className="avatar" aria-hidden="true">{you.slice(0, 1).toUpperCase()}</span>
            {you}
          </span>
          <button
            type="button"
            className="btn btn-ghost chat-restart"
            onClick={() => void signOut().then(() => router.push("/"))}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className={`chat-layout ${empty ? "is-empty" : ""}`}>
        <main className="chat-main">
          <div className="chat-log" ref={scroller} aria-live="polite">
            {empty ? (
              <section className="chat-hero">
                <Orb state={listening ? "listening" : thinking ? "thinking" : "idle"} size={380} />
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
                <div className="msg-body"><span className="typing" aria-label="Setly is thinking"><i /><i /><i /></span></div>
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
                <Sparkles aria-hidden="true" /> Grow now
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
              placeholder={empty ? "What are we shopping for?" : "Reply to Setly…"}
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
        </main>

        {!empty ? (
          <aside className="brief-card" aria-label="Your set, taking shape">
            <div className="brief-head">
              <span className="orbit-label">Your set, taking shape</span>
              <span className="brief-progress" aria-label={`${knownCount} of 3 essentials known`}>
                {[known.scene, known.people, known.budget].map((done, index) => <i key={index} className={done ? "done" : ""} />)}
              </span>
            </div>
            <LiveSetPreview brief={brief} building={phase === "building"} />
            <button type="button" className="btn btn-accent brief-go" disabled={!canBuild(brief) || busy} onClick={growNow}>
              <Sparkles aria-hidden="true" /> Grow my set now
            </button>
            <p className="brief-note">{canBuild(brief) ? "Or keep answering — every detail sharpens the picks." : "I need what it’s for, how many people, and a total budget."}</p>
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
  const bits = [`${brief.people} ${brief.people === 1 ? "person" : "people"}`, brief.budgetCents ? `${formatBudget(brief.budgetCents)} all in` : "", brief.vibe].filter(Boolean);
  return `Perfect — ${bits.join(", ")}. Growing your set from real stores now.`;
}
