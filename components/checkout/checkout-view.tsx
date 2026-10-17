"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/components/shared/format";
import { MemberBar } from "@/components/shared/member-bar";
import { readMember } from "@/components/shared/session";
import { usePlan } from "@/components/shared/use-plan";
import { payShare, runDemoCheckout } from "@/lib/client";

export function CheckoutView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [pending, setPending] = useState<"pay" | "demo" | null>(null);
  const [note, setNote] = useState("");
  const [fault, setFault] = useState("");

  async function pay() {
    const data = plan.data;
    const member = readMember(groupId);
    if (!data || !member) {
      setFault("Choose who you are before paying.");
      return;
    }
    const share = data.shares.find((item) => item.memberId === member.memberId);
    if (!share || share.totalCents <= 0) {
      setFault("There's no share to pay for that person.");
      return;
    }
    setPending("pay");
    setFault("");
    try {
      const result = await payShare({ groupId, memberId: member.memberId, amountCents: share.totalCents });
      setNote(result.clientSecret ? "Stripe has a test payment ready." : `${member.name}'s ${formatCents(share.totalCents)} is recorded.`);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Payment didn't go through.");
    } finally {
      setPending(null);
    }
  }

  async function demo() {
    setPending("demo");
    setFault("");
    try {
      const result = await runDemoCheckout({ groupId });
      const approved = result.authorizations.filter((item) => item.approved).length;
      setNote(`Demo checkout finished. ${approved} charge${approved === 1 ? "" : "s"} approved, card ···· ${result.card.last4}.`);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Demo checkout didn't run.");
    } finally {
      setPending(null);
    }
  }

  if (!plan.mounted) return <p className="orbit-status">Syncing the group…</p>;
  const data = plan.data;
  const funded = data ? Math.min(100, data.totalCents === 0 ? 0 : Math.round((data.fundedCents / data.totalCents) * 100)) : 0;

  return (
    <>
      {plan.isLoading ? <p className="orbit-status">Syncing the group…</p> : null}
      {plan.error ? <p className="fault" role="alert">This group isn't on the ledger.</p> : null}
      {data ? (
        <section className="panel">
          <span className="orbit-label">Group card</span>
          <h1>{data.card ? `Active ···· ${data.card.last4}` : "Card waits until the plan is funded"}</h1>
          <p>The card is issued only when paid contributions equal the plan total, and it can only spend at stores on the map.</p>
          {!plan.live ? <p className="notice">Funding needs a map stored on the group. Use the <Link href="/g/grp_apartment/checkout">sample plan</Link>.</p> : null}
          <div className="meter" aria-label="Funded amount">
            <span style={{ width: `${funded}%` }} />
          </div>
          <p className="meter-caption">{formatCents(data.fundedCents)} funded of {formatCents(data.totalCents)}</p>
          <MemberBar groupId={groupId} members={data.members} />
          <div className="share-table">
            {data.contributions.map((contribution) => {
              const member = data.members.find((item) => item.id === contribution.memberId);
              return (
                <div key={contribution.id} className="share-row">
                  <strong>{member?.name ?? contribution.memberId}</strong>
                  <span>{contribution.status}</span>
                  <b>{formatCents(contribution.amountCents)}</b>
                </div>
              );
            })}
          </div>
          {data.storeLimits.length > 0 ? (
            <ul className="link-list">
              {data.storeLimits.map((limit) => (
                <li key={limit.store}>{limit.store}: {formatCents(limit.spentCents)} of {formatCents(limit.limitCents)}</li>
              ))}
            </ul>
          ) : null}
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
          {note ? <p className="notice">{note}</p> : null}
          <div className="plan-actions">
            <button type="button" className="build" disabled={pending !== null || !plan.live} onClick={() => void pay()}>
              {pending === "pay" ? "Paying…" : "Pay my share"}
            </button>
            <button type="button" className="chip" disabled={pending !== null || !plan.live} onClick={() => void demo()}>
              {pending === "demo" ? "Running…" : "Run demo checkout"}
            </button>
          </div>
          {data.authorizations.length > 0 ? (
            <ul className="auth-list">
              {data.authorizations.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.approved ? "Approved" : "Declined"}</strong>
                  <span>{entry.merchant} · {formatCents(entry.amountCents)}</span>
                  <small>{entry.reason}</small>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
