"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUp, BedDouble, Check, Laptop, Mic, RotateCcw, Sofa, Tent } from "lucide-react";
import { LiveSetPreview } from "@/components/console/live-set";
import { QuestionCard } from "@/components/console/question-card";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { MODE_INFO } from "@/components/shared/modes";
import { SiteNav } from "@/components/shared/site-nav";
import { formatBudget } from "@/components/shared/format";
import { CreationSteps } from "@/components/shared/creation-steps";
import { readMode, readYou, stageDraft, stageMode, stageYou, watchMode, type FundingMode } from "@/components/shared/session";
import { firebaseConfigured, watchAuth } from "@/lib/auth/client";
import { FIREBASE_SETUP_MESSAGE } from "@/lib/env";
import { planInterview, warmInterview } from "@/lib/client";
import type { Question, QuestionOption, QuestionPlan } from "@/lib/ai/interview";
import { answerText, applyAnswer, canBuild, composePrompt, emptyBrief, essentialQuestions, groupName, readOpening, readyLine, sceneOk, type Brief } from "@/components/console/brief";

interface Line {
  id: string;
  role: "assistant" | "user";
  text: string;
  /** A short line said before the question ("Got it: a dorm for three."). */
  lead?: string;
  /** The question this line asks, answered with the card under it. */
  question?: Question;
}

interface SpeechRec {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
}

const BUILD_STEPS = ["Reading your answers", "Lining up vibes for you"];
const BUILD_STEP_AT_MS = [0, 700];
const MODES: FundingMode[] = ["solo", "group", "parent", "insurance"];

/** Tap-to-start ideas on the welcome screen. Each sends its text as the first message. */
const STARTERS = [
  { icon: BedDouble, title: "Dorm move-in", text: "Dorm room for my roommates and me: bed, bath, and storage" },
  { icon: Sofa, title: "First apartment", text: "First apartment living room and kitchen basics" },
  { icon: Tent, title: "Weekend camping trip", text: "Weekend camping trip with friends" },
  { icon: Laptop, title: "Home office", text: "A home office I can work in all day" },
];

const RETRY: Partial<Record<Question["topic"], string>> = {
  people: "Just a number is fine, like 3.",
  budget: "A dollar amount works, like $900.",
};

/**
 * Step 1 of a new set. The first message sends Gemini off to plan the whole questionnaire (one careful call), and
 * while it thinks the person answers the two questions code can ask at once: how many people and the budget. Then
 * every question is a tap: one choice, or many things to buy from a picker. No waiting between questions.
 */
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
  const [phase, setPhase] = useState<"talk" | "building">("talk");
  const [buildStep, setBuildStep] = useState(0);
  const [listening, setListening] = useState(false);
  const [fundingMode, setFundingMode] = useState<FundingMode>("group");
  const [active, setActive] = useState<Question | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState<QuestionOption[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);
  // The question queue lives in refs: the plan can land while someone is mid-answer.
  const queue = useRef<Question[]>([]);
  const position = useRef(0);
  const planState = useRef<"idle" | "loading" | "ready">("idle");
  const lead = useRef("");
  const waiting = useRef<{ brief: Brief; history: Line[] } | null>(null);

  // The nav chip and the welcome screen both change who's paying; keep this screen in step.
  useEffect(() => watchMode(setFundingMode), []);

  // Groups belong to signed-in people, so the chat needs a Firebase session before it can build anything.
  useEffect(() => {
    if (!firebaseConfigured()) return;
    return watchAuth((user) => {
      if (!user) {
        router.replace(`/sign-in?next=${encodeURIComponent("/home")}`);
        return;
      }
      const name = user.displayName?.trim() || prettyName(user.email ?? "") || "Friend";
      stageYou(name);
      setFundingMode(readMode());
      setYou(name);
      setBrief((current) => ({ ...current, name }));
      setReady(true);
      void warmInterview();
    });
  }, [router]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines, thinking, phase, buildStep, extra]);

  useEffect(() => {
    if (phase !== "building") return;
    const timers = BUILD_STEP_AT_MS.map((at, index) => window.setTimeout(() => setBuildStep((current) => Math.max(current, index)), at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  function line(role: Line["role"], text: string, extras: Pick<Line, "lead" | "question"> = {}): Line {
    seq.current += 1;
    return { id: `m${seq.current}`, role, text, ...extras };
  }

  /** Step 1 is done: hand the brief to the vibe step. The set itself is created after the vibe is picked. */
  function build(next: Brief) {
    setPhase("building");
    setBuildStep(0);
    const person = readYou() || you || next.name || "You";
    stageDraft({
      name: groupName(next),
      prompt: `${composePrompt({ ...next, name: person })} ${MODE_INFO[readMode()].promptLine}`.replace(/\s+/g, " ").trim(),
      budgetCents: next.budgetCents ?? 0,
      people: next.people,
    });
    window.setTimeout(() => router.push("/vibes"), 1400);
  }

  function finish(next: Brief, history: Line[]) {
    setActive(null);
    setLines([...history, line("assistant", readyLine(next))]);
    build(next);
  }

  /** Shows the next question, waits for the plan if it hasn't landed, or finishes. */
  function askNext(next: Brief, history: Line[], intro?: string) {
    const question = queue.current[position.current];
    if (question) {
      // The plan's "here's what I understood" line rides along with its first question.
      const said = intro ?? (question.topic !== "people" && question.topic !== "budget" && lead.current ? lead.current : undefined);
      if (said === lead.current) lead.current = "";
      setActive(question);
      setPicked(question.options.filter((option) => option.pick).map((option) => option.label));
      setExtra([]);
      setLines([...history, line("assistant", question.ask, { lead: said, question })]);
      return;
    }
    if (planState.current === "loading") {
      waiting.current = { brief: next, history };
      setActive(null);
      setLines(history);
      setThinking(true);
      return;
    }
    finish(next, history);
  }

  function receivePlan(plan: QuestionPlan | null) {
    planState.current = "ready";
    if (plan) {
      queue.current = [...queue.current, ...plan.questions];
      lead.current = plan.understood;
      setBrief((current) => ({ ...current, title: plan.title }));
    }
    const held = waiting.current;
    if (!held) return;
    waiting.current = null;
    setThinking(false);
    askNext({ ...held.brief, title: plan?.title ?? held.brief.title }, held.history);
  }

  /** The first message: read what it says, ask the essentials at once, and plan the rest in the background. */
  function start(text: string, history: Line[]) {
    if (!sceneOk(text)) {
      setLines([...history, line("assistant", "Tell me what you’re shopping for: a room, a trip, a move, anything.")]);
      return;
    }
    const opened = readOpening({ ...emptyBrief(), name: you }, text);
    setBrief(opened);
    queue.current = essentialQuestions(opened, fundingMode);
    position.current = 0;
    planState.current = "loading";
    planInterview({
      request: text,
      known: {
        ...(opened.people ? { people: String(opened.people) } : {}),
        ...(opened.budgetCents ? { budget: formatBudget(opened.budgetCents) } : {}),
        whoPays: MODE_INFO[fundingMode].promptLine,
      },
    })
      .then(({ plan }) => receivePlan(plan))
      .catch(() => receivePlan(null));
    askNext(opened, history, queue.current.length ? "Love it. A couple of quick ones while I put your list together." : undefined);
  }

  function answer(values: string[]) {
    const question = active;
    if (!question || thinking || phase === "building") return;
    const history = [...lines, line("user", answerText(question, values))];
    const result = applyAnswer(brief, question, values);
    if (!result.ok) {
      setLines([...history, line("assistant", RETRY[question.topic] ?? question.ask, { question })]);
      return;
    }
    setBrief(result.brief);
    position.current += 1;
    askNext(result.brief, history);
    queueMicrotask(() => input.current?.focus());
  }

  function toggle(label: string) {
    setPicked((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]));
  }

  function addOwn(label: string) {
    if (!active) return;
    const exists = [...active.options, ...extra].some((option) => option.label.toLowerCase() === label.toLowerCase());
    if (!exists) setExtra((current) => [...current, { label }]);
    setPicked((current) => (current.some((item) => item.toLowerCase() === label.toLowerCase()) ? current : [...current, label]));
  }

  /** Typing works everywhere: the first message, a typed answer, or an extra item for a picker. */
  function send(raw: string) {
    const text = raw.trim();
    if (!text || thinking || phase === "building") return;
    setDraft("");
    if (active?.kind === "multi") {
      addOwn(text.slice(0, 40));
      return;
    }
    if (active) {
      answer([text]);
      return;
    }
    const history = [...lines, line("user", text)];
    setLines(history);
    if (planState.current === "idle") start(text, history);
  }

  /** "Next: pick your vibe" before every question is answered: what's known so far is enough. */
  function growNow() {
    if (!canBuild(brief) || phase === "building") return;
    finish(brief, lines);
  }

  function restart() {
    setBrief({ ...emptyBrief(), name: you });
    setLines([]);
    setActive(null);
    setPicked([]);
    setExtra([]);
    setThinking(false);
    setPhase("talk");
    setDraft("");
    queue.current = [];
    position.current = 0;
    planState.current = "idle";
    lead.current = "";
    waiting.current = null;
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
      if (heard) send(heard);
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
  const known = [Boolean(brief.scene), Boolean(brief.people), Boolean(brief.budgetCents)];
  const placeholder = empty
    ? "e.g. Living room for 3 roommates, around $1,000"
    : active?.kind === "multi"
      ? "Add something not listed…"
      : active
        ? "Or type your own answer…"
        : "Type here…";

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
                <p>Tell me in your own words: a room, a trip, a move. You’ll tap through a few quick choices, pick a vibe, and I’ll grow a full set from real stores.</p>
              </section>
            ) : null}

            {lines.map((item, index) => {
              const first = item.role === "assistant" && lines[index - 1]?.role !== "assistant";
              const open = item.question && item === latest && active === item.question && !busy;
              return (
                <div key={item.id} className={`msg ${item.role}${open ? " has-card" : ""}`}>
                  {item.role === "assistant" ? <span className="msg-avatar" aria-hidden="true">{first ? <JarvisMark size={28} /> : null}</span> : null}
                  <div className="msg-body">
                    {item.lead ? <p className="msg-lead">{item.lead}</p> : null}
                    <p>{item.text}</p>
                    {open && item.question ? (
                      <QuestionCard question={item.question} picked={picked} extra={extra} onToggle={toggle} onAdd={addOwn} onAnswer={answer} />
                    ) : null}
                  </div>
                </div>
              );
            })}

            {thinking ? (
              <div className="msg assistant">
                <span className="msg-avatar" aria-hidden="true"><JarvisMark size={28} live /></span>
                <div className="msg-body">
                  <span className="typing" role="status"><i /><i /><i /><span>Putting your list together…</span></span>
                </div>
              </div>
            ) : null}

            {phase === "building" ? <BuildStage step={buildStep} /> : null}
          </div>

          {!empty ? (
            <div className="brief-strip" aria-label="What Setly knows so far">
              {[brief.people ? `${brief.people} people` : "", brief.budgetCents ? formatBudget(brief.budgetCents) : "", brief.mustHaves.length ? `${brief.mustHaves.length} items` : ""].filter(Boolean).map((fact) => (
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
              send(draft);
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
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
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
                  <button key={title} type="button" className="starter" style={{ "--i": index } as CSSProperties} disabled={busy} onClick={() => send(text)}>
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
              <span className="brief-progress" aria-label={`${known.filter(Boolean).length} of 3 essentials known`}>
                {known.map((done, index) => <i key={index} className={done ? "done" : ""} />)}
              </span>
            </div>
            <LiveSetPreview brief={brief} building={phase === "building"} />
            <button type="button" className="btn btn-accent brief-go" disabled={!canBuild(brief) || busy} onClick={growNow}>
              Next: pick your vibe <ArrowRight aria-hidden="true" />
            </button>
            <p className="brief-note">{canBuild(brief) ? "Or keep tapping: every answer sharpens the picks." : "I need what it’s for, how many people, and a total budget."}</p>
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
