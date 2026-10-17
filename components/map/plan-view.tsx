"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatCents } from "@/components/shared/format";
import { readMember, stageMap } from "@/components/shared/session";
import { usePlan } from "@/components/shared/use-plan";
import { generateMap, getSlotOptions, lockGroup, payShare } from "@/lib/client";
import type { MapData, Product, Slot } from "@/lib/types";

type PositionedPick = { slot: Slot; product: Product; x: number; y: number };

export function PlanView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [local, setLocal] = useState<MapData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [options, setOptions] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [paid, setPaid] = useState(false);
  const [fault, setFault] = useState("");
  const [liked, setLiked] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const started = useRef(false);

  const map = local ?? (plan.mounted ? plan.map : null);

  useEffect(() => {
    if (!plan.hydrated || !plan.data || plan.live || (plan.map?.slots.length ?? 0) > 0 || started.current) return;
    started.current = true;
    void generateMap({ prompt: plan.data.group.prompt, budgetCents: plan.data.group.budgetCents || undefined }).then((next) => {
      stageMap(groupId, next);
      setLocal(next);
    });
  }, [plan.hydrated, plan.data, plan.live, plan.map, groupId]);

  useEffect(() => {
    if (!replaceId) return;
    let cancel = false;
    setLoadingOptions(true);
    setOptions([]);
    getSlotOptions(replaceId)
      .then((body) => {
        if (!cancel) setOptions(body.products);
      })
      .catch(() => {
        if (!cancel) setOptions([]);
      })
      .finally(() => {
        if (!cancel) setLoadingOptions(false);
      });
    return () => {
      cancel = true;
    };
  }, [replaceId]);

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <div className="orbit frame map-loading" />;
  if (plan.error || !plan.data) {
    return (
      <div className="orbit frame map-loading">
        <a className="send" href="/home">Start again</a>
      </div>
    );
  }
  if (!map) return <div className="orbit frame map-loading" />;
  const activeMap = map;
  const data = plan.data;

  const picks = positionPicks(activeMap.slots
    .map((slot) => ({ slot, product: productFor(activeMap, slot) }))
    .filter((item): item is { slot: Slot; product: Product } => Boolean(item.product) && item.slot.payType !== "already_owned"));
  const total = picks.reduce((sum, item) => sum + item.product.priceCents * item.slot.quantity, 0);
  const selected = picks.find((item) => item.slot.id === selectedId) ?? null;
  const replacing = picks.find((item) => item.slot.id === replaceId) ?? null;

  function update(next: MapData) {
    stageMap(groupId, next);
    setLocal(next);
  }

  function swap(slot: Slot, product: Product) {
    update({
      ...activeMap,
      slots: activeMap.slots.map((item) => (item.id === slot.id ? { ...item, chosenProductId: product.id } : item)),
      products: activeMap.products.some((item) => item.id === product.id) ? activeMap.products : [...activeMap.products, product],
    });
    setReplaceId(null);
    setSelectedId(slot.id);
  }

  function remove(slot: Slot) {
    const next: MapData = {
      ...activeMap,
      slots: activeMap.slots.filter((item) => item.id !== slot.id),
      products: activeMap.products.filter((product) => product.slotId !== slot.id),
      links: activeMap.links.filter((link) => link.fromSlotId !== slot.id && link.toSlotId !== slot.id),
      rules: activeMap.rules
        .map((rule) => ({ ...rule, slotIds: rule.slotIds.filter((id) => id !== slot.id) }))
        .filter((rule) => rule.slotIds.length > 0),
    };
    update(next);
    setSelectedId(null);
    setReplaceId(null);
  }

  async function checkout() {
    const memberId = readMember(groupId)?.memberId;
    if (!memberId) {
      setFault("Start again from the chat.");
      return;
    }
    setFault("");
    try {
      let amount = data.shares.find((item) => item.memberId === memberId)?.totalCents ?? 0;
      if (data.group.status === "editing") {
        const locked = await lockGroup(groupId, { memberId });
        amount = locked.shares.find((item) => item.memberId === memberId)?.totalCents ?? amount;
      }
      if (amount > 0) await payShare({ groupId, memberId, amountCents: amount });
      setPaid(true);
    } catch {
      setFault("Try again.");
    }
  }

  if (checkingOut) {
    return (
      <div className="orbit frame checkout map-checkout">
        <div className="film">
          {picks.map(({ product }) => <Shot key={product.id} product={product} />)}
        </div>
        <div className="checkout-bar">
          <strong>{formatCents(plan.live ? data.totalCents || total : total)}</strong>
          {paid ? <span>Ready</span> : <button type="button" onClick={() => void checkout()}>Pay</button>}
          {fault ? <span className="fault">{fault}</span> : null}
          {!paid ? <button type="button" className="back" onClick={() => setCheckingOut(false)}>Back</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="orbit frame map-screen">
      <header className="map-bar">
        <div className="map-heading">
          <span className="map-eyebrow">YOUR GROUP PLAN</span>
          <strong>{formatCents(total)}</strong>
        </div>
        <button type="button" onClick={() => setCheckingOut(true)} disabled={picks.length === 0}>Checkout <span aria-hidden="true">→</span></button>
      </header>
      <section className="map-map-wrap" aria-label="Interactive plan map">
        <div className="map-map-canvas">
          <svg className="map-connections" viewBox="0 0 1000 640" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="map-link" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="rgba(108, 235, 189, .32)" />
                <stop offset="1" stopColor="rgba(108, 235, 189, .78)" />
              </linearGradient>
            </defs>
            {picks.map(({ slot, x, y }) => (
              <line key={slot.id} x1="500" y1="320" x2={x * 10} y2={y * 6.4} className="map-connection" />
            ))}
          </svg>
          <div className="map-hub">
            <span className="map-hub-flame" aria-hidden="true">✦</span>
            <strong>Your plan</strong>
            <span>{picks.length} {picks.length === 1 ? "item" : "items"}</span>
          </div>
          {picks.map(({ slot, product, x, y }) => (
            <article
              key={slot.id}
              className={`map-node ${selectedId === slot.id ? "map-node-selected" : ""}`}
              style={{ "--node-x": `${x}%`, "--node-y": `${y}%` } as CSSProperties}
              onMouseEnter={() => setSelectedId(slot.id)}
              onMouseLeave={() => setSelectedId((current) => current === slot.id && replaceId !== slot.id ? null : current)}
            >
              <button
                type="button"
                className="map-node-card"
                aria-label={`${slot.need}: ${product.title}, ${formatCents(product.priceCents)}. Show actions.`}
                aria-pressed={selectedId === slot.id}
                onFocus={() => setSelectedId(slot.id)}
                onClick={() => {
                  setSelectedId(slot.id);
                  setReplaceId(null);
                }}
              >
                <ProductImage product={product} />
                <span className="map-node-text">
                  <span className="map-need">{slot.need}</span>
                  <strong>{product.title}</strong>
                  <span className="map-price">{formatCents(product.priceCents)} <small>· {product.store}</small></span>
                </span>
              </button>
              {selectedId === slot.id ? (
                <div className="map-actions" aria-label={`Actions for ${slot.need}`}>
                  <button type="button" aria-pressed={liked.includes(slot.id)} onClick={() => setLiked((current) => toggle(current, slot.id))}>
                    <Heart filled={liked.includes(slot.id)} />{liked.includes(slot.id) ? "Liked" : "Like"}
                  </button>
                  <button type="button" onClick={() => { setReplaceId(slot.id); setSelectedId(slot.id); }}><ReplaceIcon />Replace</button>
                  <button type="button" onClick={() => remove(slot)}><TrashIcon />Delete</button>
                  <a href={product.url} target="_blank" rel="noreferrer"><ExternalIcon />Visit site</a>
                  <button type="button" aria-pressed={favorites.includes(slot.id)} onClick={() => setFavorites((current) => toggle(current, slot.id))}>
                    <Star filled={favorites.includes(slot.id)} />{favorites.includes(slot.id) ? "Saved" : "Favorite"}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {picks.length === 0 ? <p className="map-empty">Your plan is empty. Go back to the chat to add a few things.</p> : null}
          <div className="map-map-hint">SELECT A NODE TO LIKE, REPLACE, OR SAVE AN ITEM</div>
        </div>
      </section>
      {replacing ? (
        <section className="map-replace-panel" aria-label={`Other ${replacing.slot.need} options`}>
          <div className="map-replace-heading">
            <div><span className="map-eyebrow">MORE OPTIONS</span><h2>Replace {replacing.slot.need}</h2></div>
            <button type="button" onClick={() => setReplaceId(null)} aria-label="Close replacement options">×</button>
          </div>
          {loadingOptions ? <p className="map-option-status">Finding alternatives…</p> : null}
          {!loadingOptions && options.length === 0 ? <p className="map-option-status">No alternatives found yet.</p> : null}
          <div className="map-option-list">
            {options.filter((product) => product.id !== replacing.product.id).map((product) => (
              <button key={product.id} type="button" className="map-option" onClick={() => swap(replacing.slot, product)}>
                <ProductImage product={product} />
                <span><strong>{product.title}</strong><small>{product.store} · {formatCents(product.priceCents)}</small></span>
                <span className="map-option-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {fault ? <p className="map-fault" role="alert">{fault}</p> : null}
    </div>
  );
}

function productFor(map: MapData, slot: Slot) {
  return map.products.find((product) => product.id === slot.chosenProductId) ?? map.products.find((product) => product.slotId === slot.id);
}

function positionPicks(items: Array<{ slot: Slot; product: Product }>): PositionedPick[] {
  return items.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(items.length, 1);
    return { ...item, x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 };
  });
}

function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function ProductImage({ product }: { product: Product }) {
  const [broken, setBroken] = useState(false);
  const src = typeof product.imageUrl === "string" && product.imageUrl.startsWith("http") ? product.imageUrl : "";
  return src && !broken
    ? <img className="map-image" src={src} alt="" onError={() => setBroken(true)} />
    : <span className="map-image-fallback" aria-hidden="true">{product.title.slice(0, 1)}</span>;
}

function Heart({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17s-6.5-3.9-6.5-8.2A3.7 3.7 0 0 1 10 6.7a3.7 3.7 0 0 1 6.5 2.1C16.5 13.1 10 17 10 17Z" fill={filled ? "currentColor" : "none"} /></svg>;
}

function Star({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.8L10 2Z" fill={filled ? "currentColor" : "none"} /></svg>;
}

function ReplaceIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12l-2.5-2.5M16 14H4l2.5 2.5" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m3 0-.7 10H5.7L5 6m3 3v4m4-4v4" /></svg>;
}

function ExternalIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5m0-5-7 7" /><path d="M14 11v4H5V6h4" /></svg>;
}

function Shot({ product }: { product: Product }) {
  return (
    <div className="shot">
      <ProductImage product={product} />
      <span className="shot-meta"><strong>{product.title}</strong><em>{formatCents(product.priceCents)}</em></span>
    </div>
  );
}
