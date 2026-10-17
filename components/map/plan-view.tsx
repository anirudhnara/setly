"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/components/shared/format";
import { readMember, stageMap } from "@/components/shared/session";
import { usePlan } from "@/components/shared/use-plan";
import { generateMap, getSlotOptions, lockGroup, payShare } from "@/lib/client";
import type { MapData, Product, Slot } from "@/lib/types";

export function PlanView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [local, setLocal] = useState<MapData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [options, setOptions] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [paid, setPaid] = useState(false);
  const [fault, setFault] = useState("");
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
    if (!openId) return;
    let cancel = false;
    setLoadingOptions(true);
    getSlotOptions(openId)
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
  }, [openId]);

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <div className="orbit frame" />;
  if (plan.error || !plan.data) {
    return (
      <div className="orbit frame">
        <a className="send" href="/home">Start again</a>
      </div>
    );
  }
  if (!map) return <div className="orbit frame" />;

  const picks = map.slots
    .map((slot) => ({ slot, product: productFor(map, slot) }))
    .filter((item): item is { slot: Slot; product: Product } => Boolean(item.product) && item.slot.payType !== "already_owned");
  const total = picks.reduce((sum, item) => sum + item.product.priceCents * item.slot.quantity, 0);
  const open = picks.find((item) => item.slot.id === openId) ?? null;

  function swap(slot: Slot, product: Product) {
    const base = local ?? map;
    if (!base) return;
    const next: MapData = {
      ...base,
      slots: base.slots.map((item) => (item.id === slot.id ? { ...item, chosenProductId: product.id } : item)),
      products: base.products.some((item) => item.id === product.id) ? base.products : [...base.products, product],
    };
    stageMap(groupId, next);
    setLocal(next);
    setOpenId(null);
  }

  async function checkout() {
    const memberId = readMember(groupId)?.memberId;
    if (!memberId) {
      setFault("Start again from the chat.");
      return;
    }
    setFault("");
    try {
      let amount = plan.data?.shares.find((item) => item.memberId === memberId)?.totalCents ?? 0;
      if (plan.data?.group.status === "editing") {
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
      <div className="orbit frame checkout">
        <div className="film">
          {picks.map(({ product }) => (
            <Shot key={product.id} product={product} />
          ))}
        </div>
        <div className="checkout-bar">
          <strong>{formatCents(plan.live && plan.data ? plan.data.totalCents || total : total)}</strong>
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
        <span>setly</span>
        <strong>{formatCents(total)}</strong>
        <button type="button" onClick={() => setCheckingOut(true)} disabled={picks.length === 0}>Checkout</button>
      </header>
      <div className="set">
        {picks.map(({ slot, product }) => (
          <Shot key={slot.id} product={product} selected={openId === slot.id} onClick={() => setOpenId(openId === slot.id ? null : slot.id)} />
        ))}
      </div>
      {open ? (
        <div className="branch" aria-label={`Other ${open.slot.need} options`}>
          {loadingOptions ? <span className="orbit-status"> </span> : null}
          {options
            .filter((product) => product.title !== open.product.title)
            .map((product) => (
              <Shot key={product.id} product={product} compact onClick={() => swap(open.slot, product)} />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function productFor(map: MapData, slot: Slot) {
  return map.products.find((product) => product.id === slot.chosenProductId) ?? map.products.find((product) => product.slotId === slot.id);
}

function Shot({ product, selected, compact, onClick }: { product: Product; selected?: boolean; compact?: boolean; onClick?: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = typeof product.imageUrl === "string" && product.imageUrl.startsWith("http") ? product.imageUrl : "";
  if (!onClick) {
    return (
      <div className={`shot ${compact ? "compact" : ""}`}>
        {src && !broken ? <img src={src} alt={product.title} onError={() => setBroken(true)} /> : <span className="shot-fallback" aria-hidden="true">{product.title.slice(0, 1)}</span>}
        <span className="shot-meta"><strong>{product.title}</strong><em>{formatCents(product.priceCents)}</em></span>
      </div>
    );
  }
  return (
    <button type="button" className={`shot ${selected ? "selected" : ""} ${compact ? "compact" : ""}`} onClick={onClick}>
      {src && !broken ? <img src={src} alt={product.title} onError={() => setBroken(true)} /> : <span className="shot-fallback" aria-hidden="true">{product.title.slice(0, 1)}</span>}
      <span className="shot-meta">
        <strong>{product.title}</strong>
        <em>{formatCents(product.priceCents)}</em>
      </span>
    </button>
  );
}
