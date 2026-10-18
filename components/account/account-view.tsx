"use client";

import Link from "next/link";
import useSWR from "swr";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Ban, Boxes, Check, CreditCard, MessageCircle, Receipt, RotateCcw, ShieldCheck, Store, Undo2 } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { ProductImage } from "@/components/shared/product-image";
import { getCurrentUser, getGroup, listMyGroups } from "@/lib/client";
import { planTotalCents } from "@/lib/rules/check";
import type { GroupState, GroupStatus } from "@/lib/types";

type Tab = "sets" | "purchases" | "protection";

const STATUS: Record<GroupStatus, { label: string; tone: string }> = {
  editing: { label: "Shaping", tone: "" },
  funding: { label: "Funding", tone: "warn" },
  active: { label: "Card live", tone: "ok" },
  purchased: { label: "Purchased", tone: "ok" },
  settled: { label: "Settled", tone: "ok" },
};

export function AccountView() {
  const me = useSWR("/api/me", () => getCurrentUser(), { revalidateOnFocus: false });
  const groups = useSWR("/api/groups", () => listMyGroups(), { revalidateOnFocus: false });
  const ids = (groups.data?.groups ?? []).map((group) => group.id);
  // Every set's full state, so history and purchases show real photos, totals, charges, and refunds.
  const states = useSWR(ids.length ? ["states", ...ids] : null, async () => (await Promise.allSettled(ids.map((id) => getGroup(id)))).flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])), { revalidateOnFocus: false });
  const [tab, setTab] = useState<Tab>("sets");

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash === "purchases" || hash === "protection" || hash === "sets") setTab(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const user = me.data?.user;
  const all = [...(states.data ?? [])].sort((a, b) => b.group.createdAt.localeCompare(a.group.createdAt));
  const charges = all.flatMap((state) => state.authorizations.map((entry) => ({ entry, state })));
  const approved = charges.filter(({ entry }) => entry.approved);
  const declined = charges.filter(({ entry }) => !entry.approved);
  const spent = approved.reduce((sum, { entry }) => sum + entry.amountCents, 0);
  const refunds = all.flatMap((state) => state.refunds.map((refund) => ({ refund, state })));
  const refunded = refunds.reduce((sum, { refund }) => sum + refund.amountCents, 0);
  const loading = groups.isLoading || (ids.length > 0 && states.isLoading);

  function pick(next: Tab) {
    setTab(next);
    history.replaceState(null, "", `#${next}`);
  }

  return (
    <div className="account-page">
      <header className="account-head">
        <span className="avatar-dot t1 account-avatar" aria-hidden="true">{(user?.name ?? "·").slice(0, 1).toUpperCase()}</span>
        <div>
          <span className="orbit-label">Your account</span>
          <h1>{user ? `Hi, ${user.name.split(" ")[0]}` : "Your account"}</h1>
          <p className="muted">{user?.email}{user ? ` · member since ${new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}</p>
        </div>
        <div className="account-stats">
          <Stat icon={<Boxes />} label="Sets" value={String(ids.length)} />
          <Stat icon={<CreditCard />} label="Spent" value={formatCents(spent)} />
          <Stat icon={<Undo2 />} label="Refunded" value={formatCents(refunded)} />
          <Stat icon={<Ban />} label="Blocked" value={String(declined.length)} />
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Account sections">
        {(["sets", "purchases", "protection"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => pick(key)}>
            {key === "sets" ? <Boxes aria-hidden="true" /> : key === "purchases" ? <Receipt aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            {key === "sets" ? "Your sets" : key === "purchases" ? "Purchases" : "Protection"}
          </button>
        ))}
      </div>

      {tab === "sets" ? (
        <section role="tabpanel" className="sets-grid">
          <article className="set-card new-card">
            <span className="orbit-label">Start something</span>
            <h2>New set</h2>
            <div className="new-actions">
              <Link className="btn btn-accent" href="/home"><MessageCircle aria-hidden="true" /> Start a set</Link>
              <span className="new-steps">Chat → pick your vibe → your set</span>
            </div>
          </article>
          {loading ? [0, 1, 2].map((index) => <article key={index} className="set-card skeleton-card" />) : null}
          {all.map((state, index) => <SetCard key={state.group.id} state={state} index={index} />)}
          {!loading && all.length === 0 ? <p className="muted empty-note">No sets yet. Your first one takes about a minute.</p> : null}
        </section>
      ) : null}

      {tab === "purchases" ? (
        <section role="tabpanel" className="g-card">
          <div className="ledger-head">
            <div><span className="orbit-label">Bought with Setly cards</span><strong className="big-number">{formatCents(spent - refunded)}</strong><span className="muted">{formatCents(spent)} charged · {formatCents(refunded)} refunded</span></div>
          </div>
          {approved.length === 0 && refunds.length === 0 ? <p className="muted">Nothing bought yet. When a set is funded and checks out, every charge shows up here.</p> : null}
          <ul className="ledger">
            {[...approved.map(({ entry, state }) => ({ key: entry.id, at: entry.createdAt, kind: "charge" as const, label: entry.merchant, sub: state.group.name, cents: entry.amountCents, groupId: state.group.id })),
              ...refunds.map(({ refund, state }) => ({ key: refund.id, at: refund.createdAt, kind: "refund" as const, label: state.map.products.find((product) => product.id === refund.productId)?.title ?? "Returned item", sub: state.group.name, cents: refund.amountCents, groupId: state.group.id }))]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((row, index) => (
                <li key={row.key} style={{ "--i": index } as CSSProperties}>
                  <span className={`ledger-icon ${row.kind}`} aria-hidden="true">{row.kind === "charge" ? <Store /> : <RotateCcw />}</span>
                  <span><strong>{row.label}</strong><small>{row.sub} · {new Date(row.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></span>
                  <b className={row.kind}>{row.kind === "refund" ? "+" : "−"}{formatCents(row.cents)}</b>
                  <Link href={`/g/${row.groupId}/checkout`} aria-label={`Open ${row.sub}`}><ArrowRight aria-hidden="true" /></Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {tab === "protection" ? <Protection blocked={declined.map(({ entry, state }) => ({ id: entry.id, merchant: entry.merchant, reason: entry.reason, cents: entry.amountCents, set: state.group.name }))} refunded={refunded} /> : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="stat">
      <span aria-hidden="true">{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function SetCard({ state, index }: { state: GroupState; index: number }) {
  const status = STATUS[state.group.status];
  const total = state.totalCents || planTotalCents(state.map, Math.max(1, state.members.length));
  const photos = state.map.products.slice(0, 4);
  return (
    <Link href={`/g/${state.group.id}`} className="set-card" style={{ "--i": index } as CSSProperties}>
      <div className="set-photos">
        {photos.length ? photos.map((product) => <ProductImage key={product.id} product={product} need={product.title} className="set-photo" />) : <span className="muted">Still growing</span>}
      </div>
      <div className="set-card-body">
        <span className={`pill ${status.tone}`}>{status.tone === "ok" ? <Check aria-hidden="true" /> : null}{status.label}</span>
        <h2>{state.group.name}</h2>
        <span className="muted">{state.map.slots.length} items · {state.members.length} {state.members.length === 1 ? "person" : "people"} · {new Date(state.group.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <strong className="set-card-total">{formatCents(total)}</strong>
      </div>
    </Link>
  );
}

/** Setly Shield: what protects the money, explained with the person's own numbers. */
function Protection({ blocked, refunded }: { blocked: Array<{ id: string; merchant: string; reason: string; cents: number; set: string }>; refunded: number }) {
  return (
    <section role="tabpanel" className="shield">
      <div className="shield-hero g-card">
        <span className="shield-badge" aria-hidden="true"><ShieldCheck /></span>
        <div>
          <span className="orbit-label">Setly Shield</span>
          <h2>Every dollar can only buy the plan.</h2>
          <p className="muted">Each set gets its own virtual card. It works only at the set’s stores, only up to each store’s total, and only after everyone has paid in. Nobody fronts money, and nobody can spend it on anything else.</p>
        </div>
      </div>
      <div className="shield-grid">
        <article className="g-card">
          <Store aria-hidden="true" />
          <h3>Locked to the plan</h3>
          <p className="muted">Charges are approved only at stores in your set, up to that store’s subtotal. Everything else is declined with a reason.</p>
        </article>
        <article className="g-card">
          <RotateCcw aria-hidden="true" />
          <h3>Automatic refunds</h3>
          <p className="muted">Return an item and the money goes back to whoever paid for it, split by what each paid. {refunded > 0 ? `${formatCents(refunded)} returned to you so far.` : ""}</p>
        </article>
        <article className="g-card insurer">
          <ShieldCheck aria-hidden="true" />
          <h3>Insurance claims</h3>
          <p className="muted">After a fire or flood, insurers usually pay the depreciated value first and the rest only after you buy replacements and send receipts. With a claim set, the insurer funds the full claim up front, the card only buys items on the claim, and every charge matches a claim line — so you get everything you’re owed without fronting cash.</p>
          <Link className="btn btn-ghost" href="/#modes">Start a claim set <ArrowRight aria-hidden="true" /></Link>
        </article>
      </div>
      <div className="g-card">
        <span className="orbit-label">Blocked by your cards</span>
        {blocked.length === 0 ? <p className="muted">Nothing blocked yet. When something off-plan tries to charge a Setly card, it shows up here.</p> : null}
        <ul className="ledger">
          {blocked.map((row, index) => (
            <li key={row.id} style={{ "--i": index } as CSSProperties}>
              <span className="ledger-icon blocked" aria-hidden="true"><Ban /></span>
              <span><strong>{row.merchant}</strong><small>{row.reason} · {row.set}</small></span>
              <b>{formatCents(row.cents)}</b>
              <span className="pill bad">Declined</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
