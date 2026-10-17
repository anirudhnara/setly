"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { readYou, stageMap, stageMember } from "@/components/shared/session";
import { createGroup, joinGroup } from "@/lib/client";
import { applyStep, composePrompt, emptyBrief, groupName, nextStep, noteBrief, type Brief } from "@/components/console/brief";

interface Line {
  id: string;
  role: "jarvis" | "you";
  text: string;
}

interface SpeechRec {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
}

const ASK = {
  scene: "What should we shop for?",
  people: "How many people?",
  budget: "What’s the budget?",
};

function missing(brief: Brief) {
  const step = nextStep(brief);
  if (step === "scene" || step === "people" || step === "budget") return step;
  return null;
}

export function Console() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [you, setYou] = useState("");
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [lines, setLines] = useState<Line[]>([{ id: "hello", role: "jarvis", text: ASK.scene }]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"talk" | "building">("talk");
  const [listening, setListening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const ear = useRef<SpeechRec | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const name = readYou();
    if (!name) {
      router.replace("/");
      return;
    }
    setYou(name);
    setReady(true);
  }, [router]);

  function push(role: Line["role"], text: string) {
    seq.current += 1;
    const id = `m${seq.current}`;
    setLines((current) => (current.some((line) => line.id === id) ? current : [...current, { id, role, text }]));
    queueMicrotask(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
  }

  async function build(next: Brief) {
    setPhase("building");
    push("jarvis", "Building your set.");
    try {
      const person = readYou() || you || next.name || "You";
      const prompt = composePrompt({ ...next, name: person, vibe: next.vibe || "practical" });
      const created = await createGroup({
        name: groupName(next),
        prompt,
        budgetCents: next.budgetCents ?? 0,
      });
      stageMap(created.group.id, created.map);
      const joined = await joinGroup(created.group.id, { name: person });
      stageMember(created.group.id, { memberId: joined.member.id, name: joined.member.name });
      router.push(`/g/${created.group.id}`);
    } catch {
      setPhase("talk");
      push("jarvis", "Try that once more.");
    }
  }

  function answer(text: string) {
    const clean = text.trim();
    if (!clean || phase !== "talk") return;
    setDraft("");
    const step = missing(brief);
    if (!step) {
      push("you", clean);
      void build(noteBrief(brief, clean));
      return;
    }
    const result = applyStep(brief, step, clean);
    push("you", clean);
    if (!result.accepted) {
      push("jarvis", ASK[step]);
      return;
    }
    setBrief(result.brief);
    const follow = missing(result.brief);
    if (follow) push("jarvis", ASK[follow]);
    else void build(result.brief);
  }

  function speak() {
    if (listening) return;
    const host = window as Window & {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Ctor) {
      document.getElementById("brief-input")?.focus();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    ear.current = rec;
    setListening(true);
    rec.onresult = (event) => {
      const heard = event.results[0]?.[0]?.transcript ?? "";
      if (heard) answer(heard);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
  }

  if (!ready) return <div className="orbit frame" />;

  return (
    <div className="orbit frame">
      <section className={`whisper ${listening || phase === "building" ? "live" : ""}`}>
        <JarvisMark size={120} />
        <div className="whisper-log" ref={scroller} aria-live="polite">
          {lines.map((line) => (
            <p key={line.id} className={line.role}>{line.text}</p>
          ))}
        </div>
        <form
          className="whisper-bar"
          onSubmit={(event) => {
            event.preventDefault();
            answer(draft);
          }}
        >
          <label className="sr-only" htmlFor="brief-input">Message</label>
          <input
            id="brief-input"
            value={draft}
            autoFocus
            disabled={phase !== "talk"}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="send" disabled={phase !== "talk" || !draft.trim()}>Send</button>
          <button type="button" className={listening ? "mic on" : "mic"} aria-label="Speak" disabled={phase !== "talk"} onClick={speak}>
            <Mic />
          </button>
        </form>
      </section>
    </div>
  );
}

function Mic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v3" />
    </svg>
  );
}
