"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, Clock, CreditCard, Lock, ShieldCheck, X } from "lucide-react";
import { AddressForm, StoreOrderList } from "@/components/checkout/store-orders";
import { formatCents } from "@/components/shared/format";
import { Avatar, GroupHeader } from "@/components/shared/group-header";
import { GroupLoading, GroupMissing } from "@/components/group/group-states";
import { useMe } from "@/components/shared/use-me";
import { usePlan } from "@/components/shared/use-plan";
import { approveCheckout, payShare, recordGuidedPurchase, settleCheckout, startCheckout } from "@/lib/client";
import type { ShippingAddress, StoreOrder } from "@/lib/types";

export function CheckoutView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const me = useMe(plan.data);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [fault, setFault] = useState("");
  const confirmedSession = useRef<string | null>(null);
  const data = plan.data;
  const myShare = me.member && data ? data.shares.find((share) => share.memberId === me.member?.id) : undefined;
  const myShareCents = myShare?.totalCents;
  const myContribution = me.member && data ? data.contributions.find((item) => item.memberId === me.member?.id) : undefined;
  const refreshPlan = plan.mutate;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment !== "success" || !sessionId) return;
    if (myContribution?.status === "paid" || myContribution?.status === "refunded_partial") return;
    if (!myShareCents || myContribution?.status !== "pending" || confirmedSession.current === sessionId) return;

    confirmedSession.current = sessionId;
    void payShare({ groupId, amountCents: myShareCents })
      .then(async (result) => {
        await refreshPlan();
        if (result.contribution.status === "paid") setNote("Your Stripe test payment is confirmed.");
      })
      .catch((error: unknown) => {
        setFault(error instanceof Error ? error.message : "Setly couldn’t confirm the Stripe payment yet.");
      });
  }, [groupId, myContribution?.status, myShareCents, refreshPlan]);

  async function pay(amountCents: number) {
    setPending("pay");
    setFault("");
    setNote("");
    try {
      const result = await payShare({ groupId, amountCents });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      await plan.mutate();
      setNote(result.contribution.status === "paid" ? `Paid ${formatCents(amountCents)} in demo mode.` : "Stripe is still confirming the payment. It updates here on its own.");
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Payment didn’t go through.");
    } finally {
      setPending(null);
    }
  }

  /** Runs one checkout action, then refreshes the plan; the 1s poll keeps moving orders after that. */
  async function act(key: string, work: () => Promise<string | void>) {
    setPending(key);
    setFault("");
    setNote("");
    try {
      const message = await work();
      await plan.mutate();
      if (message) setNote(message);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "That didn’t go through.");
    } finally {
      setPending(null);
    }
  }

  function start(address: ShippingAddress) {
    void act("start", async () => {
      const state = await startCheckout({ groupId, address });
      const paused = state.storeOrders.filter((order) => order.status === "needs_approval").length;
      return paused ? `Checkout started. ${paused} store${paused === 1 ? " needs" : "s need"} the group’s OK.` : "Checkout started at every store.";
    });
  }

  function approve(order: StoreOrder, yes: boolean) {
    void act(`${yes ? "approve" : "decline"}:${order.id}`, async () => {
      await approveCheckout({ groupId, storeOrderId: order.id, approve: yes });
      return yes ? `${order.store} approved.` : `${order.store} canceled. Its share comes back at settle.`;
    });
  }

  function bought(order: StoreOrder) {
    void act(`bought:${order.id}`, async () => {
      const state = await recordGuidedPurchase({ groupId, storeOrderId: order.id });
      const charged = state.storeOrders.find((item) => item.id === order.id)?.finalTotalCents;
      return `${order.store} charged ${formatCents(charged ?? order.quotedCents ?? order.subtotalCents)} on the group card.`;
    });
  }

  function settle() {
    void act("settle", async () => {
      const before = plan.data?.refunds.length ?? 0;
      const state = await settleCheckout({ groupId });
      const added = state.refunds.slice(before);
      const total = added.reduce((sum, refund) => sum + refund.amountCents, 0);
      return total > 0 ? `Done. ${formatCents(total)} of unused buffer went back to the people who paid it.` : "Done. Every store used its full amount.";
    });
  }

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <GroupLoading />;
  if (!data) return <GroupMissing />;

  const editing = data.group.status === "editing";
  const funded = data.totalCents > 0 ? Math.min(100, Math.round((data.fundedCents / data.totalCents) * 100)) : 0;
  const iPaid = myContribution?.status === "paid" || myContribution?.status === "refunded_partial";
  const card = data.card;
  const orders = data.storeOrders;
  const purchased = data.group.status === "purchased" || data.group.status === "settled";
  const myMember = data.members.find((member) => member.id === me.member?.id);
  const organizer = data.members.find((member) => member.isOrganizer);
  const finished = (order: StoreOrder) => order.status === "placed" || order.status === "failed" || order.status === "canceled";
  // Guided stores nobody bought get canceled and refunded at settle, so they don't block it.
  const canSettle = orders.length > 0 && !purchased && orders.every((order) => finished(order) || (order.lane === "guided" && order.status === "placing"));
  const placedCount = orders.filter((order) => order.status === "placed").length;
  const leftoverCents = data.refunds.filter((refund) => refund.productId === null).reduce((sum, refund) => sum + refund.amountCents, 0);

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
              <p className="muted">Stripe test mode, so no real money moves. Use 4242 4242 4242 4242, any future expiry, and any CVC.</p>
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
              {orders.length === 0 && !purchased ? (
                myMember?.isOrganizer ? (
                  <AddressForm name={myMember.name} busy={pending === "start"} onSubmit={start} />
                ) : (
                  <p className="notice">Waiting for {organizer?.name ?? "the organizer"} to check out. Every store&rsquo;s order shows up here live.</p>
                )
              ) : null}
              {orders.length > 0 ? (
                <>
                  <span className="orbit-label">Checkout</span>
                  <strong className="big-number">{placedCount} of {orders.length}</strong>
                  <p className="muted">{purchased ? "Every store is done." : "stores placed. This updates on its own."}</p>
                  {!purchased ? (
                    <button type="button" className="btn btn-accent wide-btn" disabled={pending !== null || !canSettle} onClick={settle}>
                      <ShieldCheck aria-hidden="true" /> {pending === "settle" ? "Settling…" : "Finish and refund leftovers"}
                    </button>
                  ) : leftoverCents > 0 ? (
                    <p className="notice">{formatCents(leftoverCents)} of unused buffer was refunded to the people who paid it.</p>
                  ) : null}
                  {!canSettle && !purchased ? <p className="muted small">Finish opens when every store is placed, approved, or declined.</p> : null}
                </>
              ) : null}
            </>
          )}
          {note ? <p className="notice" role="status">{note}</p> : null}
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
          {purchased ? <Link className="btn btn-ghost wide-btn" href={`/g/${groupId}/settle`}>Returns &amp; refunds <ArrowRight aria-hidden="true" /></Link> : null}
        </aside>
      </div>

      {orders.length > 0 ? (
        <section className="g-card">
          <span className="orbit-label">Store by store</span>
          <p className="muted">Each store is bought its own way. Every one is capped at its subtotal plus a 10% buffer for tax and shipping, and whatever isn&rsquo;t used is refunded.</p>
          <StoreOrderList orders={orders} busy={pending} onApprove={approve} onBought={bought} />
        </section>
      ) : null}

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
