"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ArrowRight, Check, Clock, CreditCard, Lock, ShieldCheck, X } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { Avatar, GroupHeader } from "@/components/shared/group-header";
import { GroupLoading, GroupMissing } from "@/components/group/group-states";
import { useMe } from "@/components/shared/use-me";
import { usePlan } from "@/components/shared/use-plan";
import { payShare, runDemoCheckout } from "@/lib/client";

export function CheckoutView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const me = useMe(plan.data);
  const [pending, setPending] = useState<"pay" | "run" | null>(null);
  const [note, setNote] = useState("");
  const [fault, setFault] = useState("");

  async function pay(amountCents: number) {
    setPending("pay");
    setFault("");
    setNote("");
    try {
      const result = await payShare({ groupId, amountCents });
      await plan.mutate();
      setNote(result.contribution.status === "paid" ? `Paid ${formatCents(amountCents)} with a Stripe test card.` : "Stripe is still confirming the payment. It updates here on its own.");
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Payment didn’t go through.");
    } finally {
      setPending(null);
    }
  }

  async function run() {
    setPending("run");
    setFault("");
    setNote("");
    try {
      const result = await runDemoCheckout({ groupId });
      await plan.mutate();
      const approved = result.authorizations.filter((item) => item.approved).length;
      setNote(`Checkout ran: ${approved} store ${approved === 1 ? "charge" : "charges"} approved, anything off-plan declined.`);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Checkout didn’t run.");
    } finally {
      setPending(null);
    }
  }

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <GroupLoading />;
  const data = plan.data;
  if (!data) return <GroupMissing />;

  const editing = data.group.status === "editing";
  const funded = data.totalCents > 0 ? Math.min(100, Math.round((data.fundedCents / data.totalCents) * 100)) : 0;
  const myShare = me.member ? data.shares.find((share) => share.memberId === me.member?.id) : undefined;
  const myContribution = me.member ? data.contributions.find((item) => item.memberId === me.member?.id) : undefined;
  const iPaid = myContribution?.status === "paid" || myContribution?.status === "refunded_partial";
  const card = data.card;
  const purchased = data.authorizations.length > 0;

  return (
    <div className="group-page">
      <GroupHeader
        state={data}
        step="pay"
        title={card ? "Your group card is live" : "Fund the set"}
        lede="Everyone pays their own share. The moment the set is fully funded, Setly issues one virtual card that only works at the stores in this set, up to each store’s total."
      />

      {editing ? (
        <section className="g-card callout">
          <Lock aria-hidden="true" />
          <div><strong>Lock the split first.</strong><p className="muted">Payments open once the set is locked, so everyone pays the same numbers.</p></div>
          <Link className="btn btn-accent" href={`/g/${groupId}/split`}>Review the split <ArrowRight aria-hidden="true" /></Link>
        </section>
      ) : null}

      <div className="group-grid">
        <section className="g-card">
          <div className={`vcard${card ? " live" : ""}`}>
            <div className="vcard-top">
              <span className="vcard-brand">setly</span>
              <span className="vcard-status">{card ? (card.status === "active" ? "Active" : card.status) : `${funded}% funded`}</span>
            </div>
            <span className="vcard-chip" aria-hidden="true" />
            <span className="vcard-number">•••• •••• •••• {card?.last4 ?? "····"}</span>
            <div className="vcard-bottom">
              <span>{data.group.name}</span>
              <strong>{formatCents(card?.limitCents ?? data.totalCents)}</strong>
            </div>
            {!card ? <div className="vcard-lock"><Lock aria-hidden="true" /> Unlocks at 100%</div> : null}
          </div>

          <div className="fund-meter" aria-label={`${funded}% funded`}>
            <span className="fund-track"><i style={{ width: `${funded}%` }} /></span>
            <span className="muted">{formatCents(data.fundedCents)} of {formatCents(data.totalCents)} funded</span>
          </div>

          <ul className="payers">
            {data.members.map((person, index) => {
              const share = data.shares.find((item) => item.memberId === person.id);
              const contribution = data.contributions.find((item) => item.memberId === person.id);
              const paid = contribution?.status === "paid" || contribution?.status === "refunded_partial";
              return (
                <li key={person.id} style={{ "--i": index } as CSSProperties}>
                  <Avatar name={person.name} tone={index} />
                  <span>{person.name}{person.id === me.member?.id ? <em> (you)</em> : null}</span>
                  <b>{share ? formatCents(share.totalCents) : "—"}</b>
                  <span className={`pill ${paid ? "ok" : ""}`}>{paid ? <><Check aria-hidden="true" /> Paid</> : <><Clock aria-hidden="true" /> Waiting</>}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="g-card action-card">
          {!card ? (
            <>
              <span className="orbit-label">Your share</span>
              <strong className="big-number">{myShare ? formatCents(myShare.totalCents) : "—"}</strong>
              <p className="muted">Test mode: Stripe charges a test Visa, no real money moves.</p>
              <button type="button" className="btn btn-accent wide-btn" disabled={editing || pending !== null || !myShare || myShare.totalCents <= 0 || iPaid} onClick={() => myShare && void pay(myShare.totalCents)}>
                <CreditCard aria-hidden="true" /> {iPaid ? "You’ve paid" : pending === "pay" ? "Paying…" : "Pay my share"}
              </button>
            </>
          ) : (
            <>
              <span className="orbit-label">Store limits</span>
              <ul className="limits">
                {data.storeLimits.map((limit) => (
                  <li key={limit.store}>
                    <span>{limit.store}</span>
                    <span className="limit-bar"><i style={{ width: `${limit.limitCents ? Math.round((limit.spentCents / limit.limitCents) * 100) : 0}%` }} /></span>
                    <small>{formatCents(limit.spentCents)} / {formatCents(limit.limitCents)}</small>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-accent wide-btn" disabled={pending !== null || purchased} onClick={() => void run()}>
                <ShieldCheck aria-hidden="true" /> {purchased ? "Checkout complete" : pending === "run" ? "Buying from every store…" : "Run checkout"}
              </button>
            </>
          )}
          {note ? <p className="notice" role="status">{note}</p> : null}
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
          {purchased ? <Link className="btn btn-ghost wide-btn" href={`/g/${groupId}/settle`}>Returns &amp; refunds <ArrowRight aria-hidden="true" /></Link> : null}
        </aside>
      </div>

      {data.authorizations.length > 0 ? (
        <section className="g-card">
          <span className="orbit-label">Card activity</span>
          <ul className="auth-feed">
            {data.authorizations.map((entry, index) => (
              <li key={entry.id} className={entry.approved ? "ok" : "no"} style={{ "--i": index } as CSSProperties}>
                <span className="auth-icon" aria-hidden="true">{entry.approved ? <Check /> : <X />}</span>
                <span><strong>{entry.merchant}</strong><small>{entry.reason}</small></span>
                <b>{formatCents(entry.amountCents)}</b>
                <span className={`pill ${entry.approved ? "ok" : "bad"}`}>{entry.approved ? "Approved" : "Declined"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
