"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, Minus, Move3d, Plus, Sparkles, X } from "lucide-react";
import { CreationSteps } from "@/components/shared/creation-steps";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { MODE_INFO } from "@/components/shared/modes";
import { readDraft, readMode, stageMap, stageMember, watchMode, type Draft, type FundingMode } from "@/components/shared/session";
import type { SpaceLink, SpaceNode } from "@/components/space/space-graph";
import type { VibeNodeData } from "@/lib/ai/vibes";
import { vibeLine, vibeSummary, type VibeGroup } from "@/lib/catalog/vibes";
import { createGroup, growMap, seedVibes, warmInterview } from "@/lib/client";

const SpaceGraph = dynamic(() => import("@/components/space/space-graph"), {
  ssr: false,
  loading: () => <div className="space-canvas space-boot"><JarvisMark size={56} live /></div>,
});

const GROUPS: VibeGroup[] = ["Style", "Color", "Material", "Priority"];
const GROW_STEPS = ["Reading your answers", "Weighing your vibe", "Planning the branches", "Finding real products", "Picking the best fit for you"];
const GROW_AT_MS = [0, 1500, 4000, 9000, 15000];

/**
 * Step 2 of a new set: no products, just vibes floating around you. Pull what feels like you closer, push the rest
 * away. Nothing is bought here; the weights go to Gemini with the chat brief to plan the set in step 3.
 */
export function VibeView() {
  const router = useRouter();
  const [draft] = useState<Draft | null>(() => readDraft());
  const [mode, setMode] = useState<FundingMode>(() => readMode());
  const [title, setTitle] = useState(draft?.name ?? "Your set");
  const [vibes, setVibes] = useState<VibeNodeData[]>([]);
  const [selected, setSelected] = useState<SpaceNode | null>(null);
  const [toast, setToast] = useState("");
  const [hint, setHint] = useState(true);
  const [growing, setGrowing] = useState(false);
  const [growStep, setGrowStep] = useState(0);
  const [fault, setFault] = useState("");

  useEffect(() => {
    if (!draft) {
      router.replace("/home");
      return;
    }
    let cancelled = false;
    const start = window.setTimeout(() => {
      void warmInterview();
      seedVibes({ prompt: draft.prompt, mode })
        .then((result) => {
          if (cancelled) return;
          setTitle(result.title || draft.name);
          setVibes(result.vibes);
        })
        .catch(() => !cancelled && setFault("Couldn’t load your vibes. Refresh to try again."));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [draft, mode, router]);

  useEffect(() => watchMode(setMode), []);

  useEffect(() => {
    if (!growing) return;
    const timers = GROW_AT_MS.map((at, index) => window.setTimeout(() => setGrowStep(index), at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [growing]);

  const weights = useMemo(() => Object.fromEntries(vibes.map((vibe) => [vibe.label, vibe.weight])), [vibes]);
  const { loves, avoids } = vibeSummary(weights);

  function setWeight(label: string, weight: number) {
    const clamped = Math.min(1, Math.max(0, weight));
    setHint(false);
    setVibes((current) => current.map((vibe) => (vibe.label === label ? { ...vibe, weight: clamped } : vibe)));
    setSelected((current) => (current && current.label === label ? { ...current, weight: clamped } : current));
    setToast(`${label} · ${Math.round(clamped * 100)}% you`);
  }

  async function grow() {
    if (!draft || growing) return;
    setGrowing(true);
    setGrowStep(0);
    setFault("");
    try {
      const line = vibeLine(weights);
      const created = await createGroup({ name: title.slice(0, 80) || draft.name, prompt: `${draft.prompt} ${line}`.trim(), budgetCents: draft.budgetCents });
      const organizer = created.members.find((member) => member.isOrganizer) ?? created.members[0];
      if (organizer) stageMember(created.group.id, { memberId: organizer.id, name: organizer.name });
      const grown = await growMap(created.group.id);
      stageMap(created.group.id, grown.map);
      router.push(`/g/${created.group.id}`);
    } catch (error) {
      setGrowing(false);
      setFault(error instanceof Error ? error.message : "Couldn’t grow the set. Try again.");
    }
  }

  const { nodes, links } = useMemo(() => {
    const nodeList: SpaceNode[] = [{ id: "root", kind: "root", label: title, color: "#f08a62", weight: 1 }];
    const linkList: SpaceLink[] = [];
    for (const group of GROUPS) {
      const members = vibes.filter((vibe) => vibe.group === group);
      members.forEach((vibe, index) => {
        nodeList.push({ id: `vibe:${vibe.label}`, kind: "theme", label: vibe.label, color: vibe.color, weight: vibe.weight, hint: vibe.hint, parent: "root" });
        linkList.push({ source: "root", target: `vibe:${vibe.label}`, kind: "theme" });
        // Loose threads between vibes of the same kind keep each group drifting together.
        if (index > 0) linkList.push({ source: `vibe:${members[index - 1].label}`, target: `vibe:${vibe.label}`, kind: "fit" });
      });
    }
    return { nodes: nodeList, links: linkList };
  }, [vibes, title]);

  if (!draft) return <div className="space-page" />;

  return (
    <div className="space-page vibe-page">
      <SpaceGraph nodes={nodes} links={links} selectedId={selected?.id ?? null} focusTheme={null} onSelect={(node) => setSelected(node && node.kind !== "root" ? node : null)} onWeight={(node, weight) => setWeight(node.label, weight)} />

      <header className="space-hud top vibe-top">
        <CreationSteps current={1} />
        <div className="hud-title">
          <span className="hud-mode">{MODE_INFO[mode].label}</span>
          <h1>What’s the vibe?</h1>
          <p className="hud-note"><Sparkles aria-hidden="true" /> Drag what feels like you toward the center. Push away what doesn’t. No wrong answers.</p>
        </div>
      </header>

      <aside className="space-hud priorities vibe-list" aria-label="Your vibe">
        <span className="hud-label">Your vibe</span>
        {vibes.length === 0 ? <p className="vibe-loading"><JarvisMark size={22} live /> Gemini is picking vibes for “{draft.name}”…</p> : null}
        {GROUPS.map((group) => {
          const members = vibes.filter((vibe) => vibe.group === group);
          if (members.length === 0) return null;
          return (
            <div key={group} className="vibe-group">
              <span className="vibe-group-name">{group}</span>
              <ul>
                {members.map((vibe) => (
                  <li key={vibe.label}>
                    <button type="button" className="prio-name" onClick={() => setSelected({ id: `vibe:${vibe.label}`, kind: "theme", label: vibe.label, color: vibe.color, weight: vibe.weight, hint: vibe.hint })}>
                      <i style={{ background: vibe.color }} aria-hidden="true" />
                      {vibe.label}
                    </button>
                    <span className="prio-bar" aria-hidden="true"><b style={{ width: `${Math.round(vibe.weight * 100)}%`, background: vibe.color }} /></span>
                    <button type="button" className="prio-step" aria-label={`Less ${vibe.label}`} onClick={() => setWeight(vibe.label, vibe.weight - 0.2)}><Minus aria-hidden="true" /></button>
                    <button type="button" className="prio-step" aria-label={`More ${vibe.label}`} onClick={() => setWeight(vibe.label, vibe.weight + 0.2)}><Plus aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </aside>

      {hint && vibes.length > 0 ? (
        <div className="space-hint" role="note">
          <Move3d aria-hidden="true" />
          <span><b>Grab a bubble and pull it toward the middle</b> if it’s you, or fling it out if it isn’t. Drag empty space to spin around.</span>
          <button type="button" aria-label="Dismiss tip" onClick={() => setHint(false)}><X aria-hidden="true" /></button>
        </div>
      ) : null}

      {toast ? <div key={toast} className="vibe-toast" role="status">{toast}</div> : null}

      {selected ? (
        <aside className="space-hud detail" aria-label={selected.label}>
          <button type="button" className="detail-close" aria-label="Close" onClick={() => setSelected(null)}><X aria-hidden="true" /></button>
          <span className="hud-label">{vibes.find((vibe) => vibe.label === selected.label)?.group ?? "Vibe"}</span>
          <h2>{selected.label}</h2>
          <p>{selected.hint}</p>
          <div className="detail-meter"><b style={{ width: `${Math.round(selected.weight * 100)}%`, background: selected.color }} /></div>
          <p>{Math.round(selected.weight * 100)}% you</p>
          <div className="detail-actions">
            <button type="button" className="btn btn-glass" onClick={() => setWeight(selected.label, selected.weight - 0.25)}><Minus aria-hidden="true" /> Not me</button>
            <button type="button" className="btn btn-accent" onClick={() => setWeight(selected.label, selected.weight + 0.25)}><Plus aria-hidden="true" /> So me</button>
          </div>
        </aside>
      ) : null}

      <footer className="space-hud bottom">
        <div className="vibe-cta">
          <div className="vibe-read">
            <span className="hud-label">Your set will lean</span>
            <div className="vibe-chips">
              {loves.length ? loves.slice(0, 4).map((label) => <span key={label} className="love"><Check aria-hidden="true" /> {label}</span>) : <span className="muted-chip">Pull a few vibes close</span>}
              {avoids.slice(0, 2).map((label) => <span key={label} className="avoid"><X aria-hidden="true" /> {label}</span>)}
            </div>
          </div>
          <div className="vibe-actions">
            <Link href="/home" className="btn btn-glass"><ArrowLeft aria-hidden="true" /> Chat</Link>
            <button type="button" className="btn btn-accent grow-btn" disabled={vibes.length === 0 || growing} onClick={() => void grow()}>
              Grow my set <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
        {fault ? <p className="space-fault" role="alert">{fault}</p> : null}
      </footer>

      {growing ? (
        <div className="grow-overlay" role="status" aria-live="polite">
          <div className="grow-card">
            <JarvisMark size={52} live />
            <h2>Growing “{title}”</h2>
            <ol>
              {GROW_STEPS.map((label, index) => (
                <li key={label} className={index < growStep ? "done" : index === growStep ? "active" : ""} style={{ "--i": index } as CSSProperties}>
                  <span aria-hidden="true">{index < growStep ? <Check /> : null}</span>
                  {label}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
