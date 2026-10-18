"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, ArrowUp, Check, CircleCheck, ExternalLink, Heart, Plus, Shuffle, Sparkles, ThumbsDown, Trash2, UserPlus, X, Palette,
} from "lucide-react";
import { formatBudget, formatCents } from "@/components/shared/format";
import { Avatar } from "@/components/shared/group-header";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { ProductImage } from "@/components/shared/product-image";
import { readTaste, stageMap, stageTaste, type Taste } from "@/components/shared/session";
import { useMe } from "@/components/shared/use-me";
import { usePlan } from "@/components/shared/use-plan";
import { parseMemberCount } from "@/lib/ai/parse";
import { addIdea, chooseProduct, deleteSlot, generateMap, getSlotOptions, growMap, recolorSet, refineMap, suggestIdeas } from "@/lib/client";
import { colorChoices, productColor, SWATCH } from "@/lib/catalog/product-color";
import type { Idea } from "@/lib/ai/suggest";
import { parseVibeLine, vibeSummary } from "@/lib/catalog/vibes";
import { chargedCentsForSlot, planTotalCents } from "@/lib/rules/check";
import type { MapData, Product, Rule, Slot, Zone } from "@/lib/types";

interface Leaf {
  slot: Slot;
  product: Product | null;
  issues: Rule[];
  index: number;
}
interface Branch {
  zone: Zone;
  leaves: Leaf[];
  index: number;
}
interface Edge {
  id: string;
  from: string;
  to: string;
  delay: number;
  kind: "trunk" | "branch" | "alt" | "idea";
}
interface DrawnEdge extends Edge {
  d: string;
}

const STYLE_HINT = /\b(cozy|minimal(?:ist)?|modern|mid-century|scandinavian|boho|industrial|rustic|warm|calm|bright|outdoorsy|rugged|premium|neutral|colorful|vintage|japandi|coastal|farmhouse|practical)\b/i;

/** Seconds. Trunks reach each zone, then branches reach each leaf, so the set visibly grows outward. */
const zoneDelay = (index: number) => 0.15 + index * 0.12;
const leafDelay = (zoneIndex: number, leafIndex: number) => zoneDelay(zoneIndex) + 0.45 + leafIndex * 0.07;

export function PlanView({ groupId }: { groupId: string }) {
  const router = useRouter();
  const plan = usePlan(groupId);
  const me = useMe(plan.data);
  const [local, setLocal] = useState<MapData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [altFor, setAltFor] = useState<string | null>(null);
  const [ideasFor, setIdeasFor] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Record<string, Idea[]>>({});
  const [loadingIdeas, setLoadingIdeas] = useState<string | null>(null);
  const [addingIdea, setAddingIdea] = useState<string | null>(null);
  const refineInput = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<Record<string, Product[]>>({});
  const [loadingAlt, setLoadingAlt] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  // Read once on the client; the tree only renders after mount, so server HTML never depends on it.
  const [taste, setTaste] = useState<Taste>(() => readTaste(groupId));
  const [draft, setDraft] = useState("");
  const [refining, setRefining] = useState(false);
  const [reply, setReply] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
  const [generation, setGeneration] = useState(0);
  const [fault, setFault] = useState("");
  const [recoloring, setRecoloring] = useState(false);
  const started = useRef(false);
  const seenSlots = useRef<Map<string, string> | null>(null);

  const map = plan.live ? plan.map : (local ?? plan.map);

  // A poll that changes a slot this browser did not just edit flashes that slot for everyone else watching.
  useEffect(() => {
    if (!plan.live || !map) return;
    const next = new Map(map.slots.map((slot) => [slot.id, slotSignature(slot)]));
    const previous = seenSlots.current;
    seenSlots.current = next;
    if (!previous) return;
    const mine = me.member?.id;
    const remote = map.slots
      .filter((slot) => previous.get(slot.id) !== next.get(slot.id) && !(mine && slot.updatedBy === mine))
      .map((slot) => key(slot.need));
    if (remote.length === 0) return;
    setFresh(remote);
    window.setTimeout(() => setFresh((current) => (current === remote ? [] : current)), 4200);
  }, [plan.live, map, me.member?.id]);

  useEffect(() => {
    if (plan.data && me.user && !me.member) router.replace(`/g/${groupId}/join`);
  }, [plan.data, me.user, me.member, groupId, router]);

  // A group without a saved set grows one on the server (shared with every member). If that fails, a preview
  // is generated in the browser so the page still shows something; that preview can't be refined or saved.
  useEffect(() => {
    if (!plan.hydrated || !plan.data || plan.live || (plan.map?.slots.length ?? 0) > 0 || started.current) return;
    started.current = true;
    const { prompt: groupPrompt, budgetCents: groupBudget } = plan.data.group;
    void growMap(groupId)
      .then(() => plan.mutate())
      .catch(() =>
        generateMap({ prompt: groupPrompt, budgetCents: groupBudget || undefined }).then((next) => {
          stageMap(groupId, next);
          setLocal(next);
        }),
      )
      .catch(() => setFault("Couldn't grow this set. Start a new one from the chat."));
  }, [plan, groupId]);

  const saveTaste = useCallback(
    (next: Taste) => {
      setTaste(next);
      stageTaste(groupId, next);
    },
    [groupId],
  );

  const data = plan.data;
  const prompt = data?.group.prompt ?? "";
  const people = Math.max(data?.members.length ?? 0, parseMemberCount(prompt) ?? 1, 1);
  const budgetRule = map?.rules.find((rule) => rule.type === "budget");
  const budgetCents = typeof budgetRule?.params.maxCents === "number" ? budgetRule.params.maxCents : data?.group.budgetCents || 0;

  const branches = useMemo<Branch[]>(() => {
    if (!map) return [];
    let count = 0;
    return [...map.zones]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((zone) => ({
        zone,
        leaves: map.slots
          .filter((slot) => slot.zoneId === zone.id)
          .map((slot) => ({
            slot,
            product: map.products.find((item) => item.id === slot.chosenProductId) ?? map.products.find((item) => item.slotId === slot.id) ?? null,
            issues: map.rules.filter((rule) => rule.slotIds.includes(slot.id) && (rule.status === "broken" || rule.status === "warning")),
            index: count++,
          })),
      }))
      .filter((branch) => branch.leaves.length > 0)
      .map((branch, index) => ({ ...branch, index }));
  }, [map]);

  if (!plan.mounted || (plan.isLoading && !data) || (data && me.loading)) return <SkeletonTree label="Finding your set…" />;
  if (data && me.user && !me.member) return <SkeletonTree label="Sending you to join…" />;
  if (plan.error || !data) {
    return (
      <div className="set-missing">
        <JarvisMark size={48} />
        <h1>This set isn’t here anymore.</h1>
        <p>Links to demo groups reset when the server restarts. Start a new set — it takes a minute.</p>
        <Link className="btn btn-accent" href="/home">Start a new set <ArrowRight aria-hidden="true" /></Link>
      </div>
    );
  }
  if (!map || map.slots.length === 0) return <SkeletonTree label={fault || "Growing your set from real stores…"} title={data.group.name} />;

  const activeMap = map;
  const total = planTotalCents(activeMap, people);
  const stores = new Set(activeMap.products.map((product) => product.store)).size;
  const editable = data.group.status === "editing";
  const brokenRules = activeMap.rules.filter((rule) => rule.status === "broken");
  const style = prompt.match(STYLE_HINT)?.[1];
  const loved = branches.flatMap((branch) => branch.leaves).filter((leaf) => taste.loved.includes(key(leaf.slot.need)));

  function applyLocal(next: MapData) {
    stageMap(groupId, next);
    setLocal(next);
  }

  async function openAlternatives(slot: Slot) {
    setSelectedId(slot.id);
    if (altFor === slot.id) {
      setAltFor(null);
      return;
    }
    setAltFor(slot.id);
    if (options[slot.id]) return;
    setLoadingAlt(slot.id);
    try {
      const body = await getSlotOptions(slot.id);
      setOptions((current) => ({ ...current, [slot.id]: body.products }));
    } catch {
      setOptions((current) => ({ ...current, [slot.id]: [] }));
    } finally {
      setLoadingAlt(null);
    }
  }

  async function choose(slot: Slot, product: Product) {
    setFault("");
    setBusySlot(slot.id);
    try {
      if (plan.live) {
        await chooseProduct({ groupId, slotId: slot.id, productId: product.id });
        await plan.mutate();
      } else {
        applyLocal({
          ...activeMap,
          slots: activeMap.slots.map((item) => (item.id === slot.id ? { ...item, chosenProductId: product.id } : item)),
          products: [...activeMap.products.filter((item) => item.slotId !== slot.id), product],
        });
      }
      setAltFor(null);
      flash([key(slot.need)]);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't swap that item.");
    } finally {
      setBusySlot(null);
    }
  }

  async function shuffleColors() {
    setFault("");
    setRecoloring(true);
    try {
      const result = await recolorSet({ groupId });
      await plan.mutate();
      setOptions({});
      setAltFor(null);
      setReply(result.changed > 0 ? `New colors for ${result.changed} ${result.changed === 1 ? "item" : "items"}, each at about the same price.` : "No other colors at a similar price right now.");
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't shuffle colors.");
    } finally {
      setRecoloring(false);
    }
  }

  async function remove(slot: Slot) {
    setFault("");
    setBusySlot(slot.id);
    try {
      if (plan.live) {
        await deleteSlot(slot.id);
        await plan.mutate();
      } else {
        applyLocal({
          ...activeMap,
          slots: activeMap.slots.filter((item) => item.id !== slot.id),
          products: activeMap.products.filter((product) => product.slotId !== slot.id),
          links: activeMap.links.filter((link) => link.fromSlotId !== slot.id && link.toSlotId !== slot.id),
        });
      }
      setSelectedId(null);
      setAltFor(null);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't remove that item.");
    } finally {
      setBusySlot(null);
    }
  }

  function toggleLove(slot: Slot) {
    const need = key(slot.need);
    const lovedNow = taste.loved.includes(need);
    saveTaste({ ...taste, loved: lovedNow ? taste.loved.filter((item) => item !== need) : [...taste.loved, need], passed: taste.passed.filter((item) => item !== need) });
  }

  function pass(slot: Slot) {
    const need = key(slot.need);
    if (!taste.passed.includes(need)) saveTaste({ ...taste, passed: [...taste.passed, need], loved: taste.loved.filter((item) => item !== need) });
    if (altFor !== slot.id) void openAlternatives(slot);
  }

  function flash(needs: string[]) {
    setFresh(needs);
    window.setTimeout(() => setFresh([]), 4200);
  }

  async function refine(message: string) {
    const clean = message.trim();
    const passedIds = activeMap.slots.filter((slot) => taste.passed.includes(key(slot.need))).map((slot) => slot.id);
    if ((!clean && passedIds.length === 0) || refining) return;
    if (!plan.live) {
      setFault("This set isn't saved to a group, so it can't regrow. Start a new set from the chat.");
      return;
    }
    setDraft("");
    setFault("");
    setRefining(true);
    setReply("");
    try {
      const result = await refineMap({
        groupId,
        message: clean,
        history: taste.history,
        liked: activeMap.slots.filter((slot) => taste.loved.includes(key(slot.need))).map((slot) => slot.id),
        disliked: passedIds,
      });
      await plan.mutate();
      saveTaste({ ...taste, passed: [], history: clean ? [...taste.history, clean].slice(-20) : taste.history });
      setReply(result.reply);
      setAltFor(null);
      setSelectedId(null);
      setOptions({});
      setGeneration((current) => current + 1);
      flash([...result.changes.added, ...result.changes.changed].map(key));
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't regrow the set.");
    } finally {
      setRefining(false);
    }
  }

  /** Tap a branch: Gemini proposes what it's missing, each with a real product, shown as ghost leaves. */
  async function toggleIdeas(zone: Zone) {
    if (!editable) return;
    if (ideasFor === zone.id) {
      setIdeasFor(null);
      return;
    }
    setIdeasFor(zone.id);
    setAltFor(null);
    if (!plan.live || ideas[zone.id]) return;
    setLoadingIdeas(zone.id);
    try {
      const result = await suggestIdeas({ groupId, zoneId: zone.id });
      setIdeas((current) => ({ ...current, [zone.id]: result.ideas }));
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't grow ideas for that branch.");
      setIdeas((current) => ({ ...current, [zone.id]: [] }));
    } finally {
      setLoadingIdeas(null);
    }
  }

  async function addFromIdea(zone: Zone, idea: Idea) {
    setAddingIdea(idea.product.id);
    setFault("");
    try {
      await addIdea({ groupId, zoneId: zone.id, need: idea.need, searchQuery: idea.searchQuery, productId: idea.product.id });
      await plan.mutate();
      setIdeas((current) => ({ ...current, [zone.id]: (current[zone.id] ?? []).filter((entry) => entry.product.id !== idea.product.id) }));
      flash([key(idea.need)]);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't add that.");
    } finally {
      setAddingIdea(null);
    }
  }

  function startBranch() {
    setDraft("Add a branch for ");
    window.setTimeout(() => refineInput.current?.focus(), 0);
  }

  const vibeLoves = vibeSummary(parseVibeLine(prompt)).loves;
  const passedCount = activeMap.slots.filter((slot) => taste.passed.includes(key(slot.need))).length;
  const firstLeaf = branches[0]?.leaves.find((leaf) => leaf.product)?.slot.need;
  const suggestions = [
    passedCount > 0 ? `Replace the ${passedCount} I passed on` : "",
    budgetCents && total > budgetCents ? "Get it under budget" : "Make it cheaper",
    style && !/minimal/i.test(style) ? "More minimal" : "Warmer and cozier",
    firstLeaf ? `Different ${firstLeaf.toLowerCase()}` : "",
    "Add something we’re missing",
  ].filter(Boolean).slice(0, 4);

  return (
    <div className="set-page">
      <header className="set-head">
        <div className="set-title">
          <span className="orbit-label">Your set · {branches.reduce((sum, branch) => sum + branch.leaves.length, 0)} items · {stores} {stores === 1 ? "store" : "stores"}</span>
          <h1>{data.group.name}</h1>
          <div className="taste-row" aria-label="What Setly is tuned to">
            <span className="taste-label">Tuned to</span>
            <span className="taste">{people} {people === 1 ? "person" : "people"}</span>
            {budgetCents ? <span className="taste">{formatBudget(budgetCents)} budget</span> : null}
            {vibeLoves.length ? vibeLoves.slice(0, 4).map((label) => <span key={label} className="taste vibe">{label}</span>) : style ? <span className="taste">{style.toLowerCase()}</span> : null}
            {loved.length ? <span className="taste loved"><Heart aria-hidden="true" /> {loved.length} loved</span> : null}
            {taste.history.slice(-2).map((said) => <span key={said} className="taste said">“{said}”</span>)}
          </div>
          <ul className="set-people" aria-label="People in this set">
            {data.members.map((person, index) => (
              <li key={person.id} className={person.id === me.member?.id ? "you" : undefined}>
                <Avatar name={person.name} tone={index} size={28} />
                <span>{person.name}{person.id === me.member?.id ? " (you)" : ""}{person.isOrganizer ? " · organizer" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="set-summary">
          <div className="set-total">
            <span>Set total</span>
            <strong>{formatCents(total)}</strong>
            {budgetCents ? <BudgetMeter total={total} budget={budgetCents} /> : null}
          </div>
          <div className="set-actions">
            {editable && plan.live ? (
              <button type="button" className="btn btn-ghost" disabled={recoloring} onClick={() => void shuffleColors()}>
                <Palette aria-hidden="true" /> {recoloring ? "Shuffling…" : "Shuffle colors"}
              </button>
            ) : null}
            <Link className="btn btn-ghost" href={`/g/${groupId}/join`}><UserPlus aria-hidden="true" /> Invite</Link>
            <Link className="btn btn-accent" href={`/g/${groupId}/split`}>Split &amp; pay <ArrowRight aria-hidden="true" /></Link>
          </div>
        </div>
      </header>

      {brokenRules.length > 0 ? (
        <ul className="rule-alerts" aria-label="Checks that need attention">
          {brokenRules.map((rule) => (
            <li key={rule.id}><AlertTriangle aria-hidden="true" /> {rule.message || "A rule on this set is broken."}</li>
          ))}
        </ul>
      ) : null}

      {editable ? (
        <ul className="tree-tips" aria-label="How to shape your set">
          <li><span>1</span> Tap an item to see other options</li>
          <li><span>2</span> Tap a branch name to grow more ideas</li>
          <li><span>3</span> Type below to change anything</li>
        </ul>
      ) : null}

      <TreeCanvas
        key={generation}
        branches={branches}
        altFor={altFor}
        altCount={altFor ? (options[altFor]?.length ?? 0) : 0}
        ideasFor={ideasFor}
        ideaCount={ideasFor ? (loadingIdeas === ideasFor ? 3 : (ideas[ideasFor]?.length ?? 0)) : 0}
        className={refining ? "is-regrowing" : ""}
        root={
          <div className="tree-root" data-node="root">
            <JarvisMark size={40} live={refining} />
            <span className="orbit-label">The set</span>
            <strong>{formatCents(total)}</strong>
            <small>{people} {people === 1 ? "person" : "people"} · {formatCents(Math.ceil(total / people))} each</small>
            {editable ? <button type="button" className="root-add" onClick={startBranch}><Plus aria-hidden="true" /> Add a branch</button> : null}
          </div>
        }
        renderZone={(branch) => (
          <button
            type="button"
            className={`zone-node${ideasFor === branch.zone.id ? " open" : ""}`}
            data-node={`zone:${branch.zone.id}`}
            style={{ "--d": `${zoneDelay(branch.index) + 0.3}s` } as CSSProperties}
            aria-expanded={ideasFor === branch.zone.id}
            disabled={!editable}
            onClick={() => void toggleIdeas(branch.zone)}
          >
            <strong>{branch.zone.name}</strong>
            <span>{branch.leaves.length} {branch.leaves.length === 1 ? "item" : "items"} · {formatCents(branch.leaves.reduce((sum, leaf) => sum + chargedCentsForSlot(leaf.slot, leaf.product, people), 0))}</span>
            {editable ? <em className="zone-grow"><Sparkles aria-hidden="true" /> {ideasFor === branch.zone.id ? "Hide ideas" : "More ideas"}</em> : null}
          </button>
        )}
        renderIdeas={(branch) =>
          ideasFor === branch.zone.id ? (
            <div className="ideas" aria-label={`Ideas for ${branch.zone.name}`}>
              {loadingIdeas === branch.zone.id ? [0, 1, 2].map((index) => <div key={index} className="idea skeleton" data-node={`idea:${branch.zone.id}:${index}`} />) : null}
              {loadingIdeas !== branch.zone.id && (ideas[branch.zone.id]?.length ?? 0) === 0 ? <p className="alts-empty">{plan.live ? "This branch looks complete. Type below to add something specific." : "Ideas need a saved set."}</p> : null}
              {(loadingIdeas === branch.zone.id ? [] : (ideas[branch.zone.id] ?? [])).map((idea, index) => (
                <div key={idea.product.id} className="idea" data-node={`idea:${branch.zone.id}:${index}`} style={{ "--d": `${0.15 + index * 0.08}s` } as CSSProperties}>
                  <ProductImage product={idea.product} need={idea.need} className="alt-image" />
                  <span className="alt-text">
                    <span className="leaf-need">{idea.need}</span>
                    <strong>{idea.product.title}</strong>
                    <span><b>{formatCents(idea.product.priceCents)}</b> {idea.product.store}</span>
                    <small className="idea-why">{idea.why}</small>
                  </span>
                  <button type="button" className="alt-use add" disabled={addingIdea !== null} onClick={() => void addFromIdea(branch.zone, idea)} aria-label={`Add ${idea.need} to the set`}>
                    <Plus aria-hidden="true" /> {addingIdea === idea.product.id ? "Adding" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          ) : null
        }
        renderLeaf={(branch, leaf, leafIndex) => {
          const need = key(leaf.slot.need);
          const owned = leaf.slot.payType === "already_owned";
          const isLoved = taste.loved.includes(need);
          const isPassed = taste.passed.includes(need);
          const selected = selectedId === leaf.slot.id;
          const alts = (options[leaf.slot.id] ?? []).filter((product) => product.id !== leaf.product?.id);
          const editor = data.members.find((person) => person.id === leaf.slot.updatedBy);
          const editorLabel = editor ? (editor.id === me.member?.id ? "Edited by you" : `Edited by ${editor.name}`) : null;
          return (
            <div className="leaf-row" key={leaf.slot.id}>
              <article
                key={leaf.product?.id ?? "empty"}
                data-node={leaf.slot.id}
                className={`leaf${selected ? " selected" : ""}${owned ? " owned" : ""}${isLoved ? " loved" : ""}${isPassed ? " passed" : ""}${fresh.includes(need) ? " fresh" : ""}${busySlot === leaf.slot.id ? " busy" : ""}`}
                style={{ "--d": `${leafDelay(branch.index, leafIndex) + 0.3}s` } as CSSProperties}
              >
                <button
                  type="button"
                  className="leaf-main"
                  aria-pressed={selected}
                  aria-label={`${leaf.slot.need}: ${leaf.product ? `${leaf.product.title}, ${formatCents(leaf.product.priceCents)} at ${leaf.product.store}` : owned ? "already owned" : "no pick yet"}. Show other options.`}
                  aria-expanded={altFor === leaf.slot.id}
                  onClick={() => {
                    setSelectedId(leaf.slot.id);
                    setIdeasFor(null);
                    if (!owned && editable) void openAlternatives(leaf.slot);
                  }}
                >
                  <ProductImage product={leaf.product} need={leaf.slot.need} className="leaf-image" />
                  <span className="leaf-text">
                    <span className="leaf-need">
                      {leaf.slot.need}
                      {leaf.slot.payType === "per_person" ? ` · ${people}×` : leaf.slot.quantity > 1 ? ` · ${leaf.slot.quantity}×` : ""}
                    </span>
                    <strong>{owned ? "You already own this" : (leaf.product?.title ?? "No match yet")}</strong>
                    {owned ? (
                      <span className="leaf-meta"><CircleCheck aria-hidden="true" /> Free · not bought</span>
                    ) : leaf.product ? (
                      <span className="leaf-meta"><b>{formatCents(leaf.product.priceCents)}</b> {leaf.product.store}</span>
                    ) : (
                      <span className="leaf-meta">Open alternatives to pick one</span>
                    )}
                    {editorLabel ? <span className="leaf-editor">{editorLabel}</span> : null}
                  </span>
                  {isLoved ? <Heart className="leaf-badge" aria-label="Loved" fill="currentColor" /> : null}
                </button>
                {editable ? <button type="button" className="leaf-remove" aria-label={`Remove ${leaf.slot.need}`} title="Remove" onClick={() => void remove(leaf.slot)}><X aria-hidden="true" /></button> : null}
                {leaf.issues.length ? (
                  <p className={`leaf-issue ${leaf.issues.some((rule) => rule.status === "broken") ? "broken" : "warning"}`}>
                    <AlertTriangle aria-hidden="true" /> {leaf.issues[0].message || "Check this item"}
                  </p>
                ) : null}
                {!owned ? (
                  <div className="leaf-actions" role="group" aria-label={`Actions for ${leaf.slot.need}`}>
                    <IconAction label={isLoved ? "Loved — keeps it when the set regrows" : "Love it"} pressed={isLoved} onClick={() => toggleLove(leaf.slot)}>
                      <Heart fill={isLoved ? "currentColor" : "none"} />
                    </IconAction>
                    <IconAction label="Not for me" pressed={isPassed} disabled={!editable} onClick={() => pass(leaf.slot)}><ThumbsDown /></IconAction>
                    <IconAction label="See alternatives" pressed={altFor === leaf.slot.id} disabled={!editable} onClick={() => void openAlternatives(leaf.slot)}><Shuffle /></IconAction>
                    {leaf.product ? (
                      <a className="icon-action" href={leaf.product.url} target="_blank" rel="noreferrer" aria-label={`View at ${leaf.product.store}`} title={`View at ${leaf.product.store}`}>
                        <ExternalLink aria-hidden="true" />
                      </a>
                    ) : null}
                    <IconAction label="Remove from set" disabled={!editable} onClick={() => void remove(leaf.slot)}><Trash2 /></IconAction>
                  </div>
                ) : null}
              </article>

              {altFor === leaf.slot.id ? (
                <div className="alts" aria-label={`Alternatives for ${leaf.slot.need}`}>
                  <div className="alts-head">
                    <span className="orbit-label">Other {leaf.slot.need.toLowerCase()} picks</span>
                    <button type="button" className="icon-action" aria-label="Close alternatives" onClick={() => setAltFor(null)}><X aria-hidden="true" /></button>
                  </div>
                  {(() => {
                    const colors = loadingAlt === leaf.slot.id ? [] : colorChoices(leaf.product, alts);
                    if (colors.length < 2) return null;
                    const now = leaf.product ? productColor(leaf.product) : null;
                    return (
                      <div className="swatches" role="group" aria-label={`Colors for ${leaf.slot.need}`}>
                        <span className="swatches-label">Color</span>
                        {colors.map(({ color, product }) => (
                          <button
                            key={color}
                            type="button"
                            className={`swatch${color === now ? " on" : ""}`}
                            style={{ "--swatch": SWATCH[color] } as CSSProperties}
                            aria-pressed={color === now}
                            aria-label={`${color}${product.id === leaf.product?.id ? " (current)" : `, ${formatCents(product.priceCents)}`}`}
                            title={`${color[0]?.toUpperCase()}${color.slice(1)}${product.id === leaf.product?.id ? "" : ` · ${formatCents(product.priceCents)}`}`}
                            disabled={busySlot === leaf.slot.id || product.id === leaf.product?.id}
                            onClick={() => void choose(leaf.slot, product)}
                          />
                        ))}
                      </div>
                    );
                  })()}
                  {loadingAlt === leaf.slot.id ? [0, 1, 2].map((item) => <div key={item} className="alt skeleton" data-node={`alt:${leaf.slot.id}:${item}`} />) : null}
                  {loadingAlt !== leaf.slot.id && alts.length === 0 ? <p className="alts-empty">No other matches from the stores right now.</p> : null}
                  {alts.slice(0, 5).map((product, altIndex) => {
                    const delta = leaf.product ? product.priceCents - leaf.product.priceCents : 0;
                    return (
                      <div key={product.id} className="alt" data-node={`alt:${leaf.slot.id}:${altIndex}`} style={{ "--d": `${0.22 + altIndex * 0.07}s` } as CSSProperties}>
                        <ProductImage product={product} need={leaf.slot.need} className="alt-image" />
                        <span className="alt-text">
                          <strong>{product.title}</strong>
                          <span>
                            <b>{formatCents(product.priceCents)}</b> {product.store}
                            {delta !== 0 ? <em className={delta < 0 ? "cheaper" : ""}>{delta < 0 ? "−" : "+"}{formatCents(Math.abs(delta))}</em> : null}
                          </span>
                        </span>
                        <button type="button" className="alt-use" disabled={busySlot === leaf.slot.id} onClick={() => void choose(leaf.slot, product)} aria-label={`Use ${product.title}`}>
                          <Check aria-hidden="true" /> Use
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        }}
      />

      <section className={`refine-dock${refining ? " is-busy" : ""}`} aria-label="Refine the set">
        {reply || refining || fault ? (
          <div className={`refine-reply${fault ? " is-fault" : ""}`} role={fault ? "alert" : "status"}>
            <JarvisMark size={26} live={refining} />
            <p>{fault || (refining ? "Regrowing your set with that in mind…" : reply)}</p>
            {!refining ? <button type="button" className="icon-action" aria-label="Dismiss" onClick={() => { setReply(""); setFault(""); }}><X aria-hidden="true" /></button> : null}
          </div>
        ) : null}
        {editable ? (
          <>
            <div className="refine-chips" role="group" aria-label="Suggestions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className="chip" disabled={refining} onClick={() => (suggestion.startsWith("Add something") ? setDraft("Add ") : void refine(suggestion.startsWith("Replace the") ? "" : suggestion))}>
                  {suggestion}
                </button>
              ))}
            </div>
            <form className="refine-bar" onSubmit={(event) => { event.preventDefault(); void refine(draft); }}>
              <label className="sr-only" htmlFor="refine-input">Tell Setly what to change</label>
              <input id="refine-input" ref={refineInput} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell Setly what to change — “add a TV”, “no rug”, “under $900”…" disabled={refining} autoComplete="off" />
              <button type="submit" className="icon-btn send-btn" aria-label="Regrow the set" disabled={refining || (!draft.trim() && passedCount === 0)}>
                <ArrowUp aria-hidden="true" />
              </button>
            </form>
          </>
        ) : (
          <p className="refine-locked">The set is locked while the group pays. <Link href={`/g/${groupId}/checkout`}>Go to checkout →</Link></p>
        )}
      </section>
    </div>
  );
}

/** Lays out root → zones → leaves (→ alternatives) and draws measured, animated branches between them. */
function TreeCanvas({
  branches,
  altFor,
  altCount,
  ideasFor = null,
  ideaCount = 0,
  root,
  renderZone,
  renderLeaf,
  renderIdeas,
  className,
}: {
  branches: Branch[];
  altFor: string | null;
  altCount: number;
  ideasFor?: string | null;
  ideaCount?: number;
  root: ReactNode;
  renderZone: (branch: Branch) => ReactNode;
  renderLeaf: (branch: Branch, leaf: Leaf, leafIndex: number) => ReactNode;
  renderIdeas?: (branch: Branch) => ReactNode;
  className: string;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<DrawnEdge[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = [];
    for (const branch of branches) {
      list.push({ id: `t:${branch.zone.id}`, from: "root", to: `zone:${branch.zone.id}`, delay: zoneDelay(branch.index), kind: "trunk" });
      branch.leaves.forEach((leaf, leafIndex) => {
        list.push({ id: `b:${leaf.slot.id}`, from: `zone:${branch.zone.id}`, to: leaf.slot.id, delay: leafDelay(branch.index, leafIndex), kind: "branch" });
      });
    }
    if (altFor) {
      for (let index = 0; index < Math.max(altCount, 3); index += 1) {
        list.push({ id: `a:${altFor}:${index}`, from: altFor, to: `alt:${altFor}:${index}`, delay: index * 0.07, kind: "alt" });
      }
    }
    if (ideasFor) {
      for (let index = 0; index < ideaCount; index += 1) {
        list.push({ id: `i:${ideasFor}:${index}`, from: `zone:${ideasFor}`, to: `idea:${ideasFor}:${index}`, delay: index * 0.08, kind: "idea" });
      }
    }
    return list;
  }, [branches, altFor, altCount, ideasFor, ideaCount]);

  const measure = useCallback(() => {
    const host = canvas.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    // Wide screens: zones spread in a row under the root. Narrow screens: everything stacks, indented by level.
    const stacked = window.matchMedia("(max-width: 900px)").matches;
    const rect = (id: string) => {
      const node = host.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const left = r.left - box.left + host.scrollLeft;
      const top = r.top - box.top + host.scrollTop;
      return { left, top, bottom: top + r.height, cx: left + r.width / 2, cy: top + r.height / 2 };
    };
    const drawn: DrawnEdge[] = [];
    for (const edge of edges) {
      const a = rect(edge.from);
      const b = rect(edge.to);
      if (!a || !b) continue;
      let d: string;
      if (edge.kind === "trunk" && !stacked) {
        // Root to zone: a smooth S-curve down from the root's base to the top of each zone.
        const dy = Math.max(18, (b.top - a.bottom) / 2);
        d = `M${a.cx} ${a.bottom} C${a.cx} ${a.bottom + dy} ${b.cx} ${b.top - dy} ${b.cx} ${b.top}`;
      } else {
        // Parent to child: down the parent's left spine, then a rounded elbow into the child.
        const x1 = a.left + 22;
        const y1 = a.bottom;
        const x2 = b.left;
        const y2 = b.cy;
        const r = Math.max(0, Math.min(14, x2 - x1, y2 - y1));
        d = `M${x1} ${y1} V${y2 - r} Q${x1} ${y2} ${x1 + r} ${y2} H${x2}`;
      }
      drawn.push({ ...edge, d });
    }
    setPaths(drawn);
    setSize({ width: host.scrollWidth, height: host.scrollHeight });
  }, [edges]);

  useLayoutEffect(() => {
    measure();
    const host = canvas.current;
    if (!host) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    host.querySelectorAll("[data-node]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!altFor) return;
    const node = canvas.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(`alt:${altFor}:0`)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [altFor, altCount]);

  return (
    <section className={`tree-wrap ${className}`} aria-label="Your set as a tree">
      <div className="tree" ref={canvas}>
        <svg className="tree-links" width={size.width} height={size.height} aria-hidden="true">
          {paths.map((edge) => (
            <path key={edge.id} d={edge.d} pathLength={1} className={`link ${edge.kind}`} style={{ "--d": `${edge.delay}s` } as CSSProperties} />
          ))}
        </svg>
        {root}
        <div className="tree-branches" style={{ "--cols": Math.max(1, branches.length) } as CSSProperties}>
          {branches.map((branch) => (
            <div className="branch-row" key={branch.zone.id}>
              {renderZone(branch)}
              <div className="leaves">
                {branch.leaves.map((leaf, leafIndex) => renderLeaf(branch, leaf, leafIndex))}
                {renderIdeas?.(branch)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function IconAction({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="icon-action" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function BudgetMeter({ total, budget }: { total: number; budget: number }) {
  const ratio = budget > 0 ? total / budget : 0;
  const state = ratio > 1 ? "over" : ratio >= 0.95 ? "near" : "ok";
  const label = state === "over" ? `${formatCents(total - budget)} over budget` : `${formatCents(budget - total)} under budget`;
  return (
    <span className={`budget-meter ${state}`}>
      <span className="budget-track" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></span>
      <small>{state === "over" ? <AlertTriangle aria-hidden="true" /> : <CircleCheck aria-hidden="true" />} {label}</small>
    </span>
  );
}

const SKELETON_ZONES = [3, 4, 3];

/** Placeholder tree while the set grows: real branch animation, shimmering rooms and leaves. */
function SkeletonTree({ label, title }: { label: string; title?: string }) {
  const now = new Date(0).toISOString();
  let count = 0;
  const branches: Branch[] = SKELETON_ZONES.map((leaves, zoneIndex) => ({
    index: zoneIndex,
    zone: { id: `sk${zoneIndex}`, groupId: "", name: "", sortOrder: zoneIndex },
    leaves: Array.from({ length: leaves }, (_, leafIndex) => ({
      index: count++,
      product: null,
      issues: [],
      slot: { id: `sk${zoneIndex}-${leafIndex}`, zoneId: `sk${zoneIndex}`, need: "", quantityRule: "per_group", quantity: 1, budgetCents: 0, payType: "shared", ownerMemberId: null, chosenProductId: null, updatedBy: null, updatedAt: now },
    })),
  }));
  return (
    <div className="set-page skeleton-set" role="status" aria-live="polite">
      <header className="set-head">
        <div className="set-title">
          <span className="orbit-label">Your set</span>
          <h1>{title ?? <span className="sk-line wide" />}</h1>
          <p className="skeleton-label">{label}</p>
        </div>
      </header>
      <TreeCanvas
        branches={branches}
        altFor={null}
        altCount={0}
        className=""
        root={
          <div className="tree-root" data-node="root">
            <JarvisMark size={40} live />
            <span className="orbit-label">Growing</span>
            <strong><span className="sk-line dark" /></strong>
            <small>Searching real stores</small>
          </div>
        }
        renderZone={(branch) => (
          <div className="zone-node sk" data-node={`zone:${branch.zone.id}`} style={{ "--d": `${zoneDelay(branch.index) + 0.3}s` } as CSSProperties}>
            <span className="sk-line" /><span className="sk-line short" />
          </div>
        )}
        renderLeaf={(branch, leaf, leafIndex) => (
          <div className="leaf-row" key={leaf.slot.id}>
            <article data-node={leaf.slot.id} className="leaf sk" style={{ "--d": `${leafDelay(branch.index, leafIndex) + 0.3}s` } as CSSProperties}>
              <div className="leaf-main">
                <span className="product-image leaf-image sk-block" />
                <span className="leaf-text"><span className="sk-line short" /><span className="sk-line" /><span className="sk-line short" /></span>
              </div>
            </article>
          </div>
        )}
      />
    </div>
  );
}

function key(need: string) {
  return need.trim().toLowerCase().replace(/\s+/g, " ");
}

function slotSignature(slot: Slot) {
  return [slot.need, slot.chosenProductId ?? "", String(slot.quantity), slot.payType, slot.updatedAt].join("\0");
}
