"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/components/shared/format";
import { usePlan } from "@/components/shared/use-plan";
import { returnItem } from "@/lib/client";

export function SettleView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [pendingId, setPendingId] = useState("");
  const [fault, setFault] = useState("");
  const [note, setNote] = useState("");

  async function refund(productId: string) {
    setPendingId(productId);
    setFault("");
    try {
      const result = await returnItem({ groupId, productId });
      const total = result.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
      setNote(result.refunds.length ? `Returned. ${formatCents(total)} goes back to the people who paid.` : "Nothing to refund on that item.");
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Return didn't go through.");
    } finally {
      setPendingId("");
    }
  }

  if (!plan.mounted) return <p className="orbit-status">Syncing the group…</p>;
  const data = plan.data;
  const products = plan.live && plan.map ? plan.map.products : [];

  return (
    <>
      {plan.isLoading ? <p className="orbit-status">Syncing the group…</p> : null}
      {plan.error ? <p className="fault" role="alert">This group isn't on the ledger.</p> : null}
      {data ? (
        <section className="panel">
          <span className="orbit-label">{data.group.status}</span>
          <h1>Settle a return</h1>
          <p>A returned item refunds the people who paid for it, in proportion to what each paid.</p>
          {!plan.live ? <p className="notice">Returns need the stored sample map. Open <Link href="/g/grp_apartment/settle">the sample plan</Link>.</p> : null}
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
          {note ? <p className="notice">{note}</p> : null}
          <div className="share-table">
            {products.map((product) => (
              <div key={product.id} className="share-row">
                <strong>{product.title}</strong>
                <span>{product.store}</span>
                <button type="button" className="chip" disabled={pendingId === product.id} onClick={() => void refund(product.id)}>
                  {pendingId === product.id ? "Returning…" : `Return ${formatCents(product.priceCents)}`}
                </button>
              </div>
            ))}
          </div>
          {data.refunds.length > 0 ? (
            <ul className="link-list">
              {data.refunds.map((refundLine) => {
                const member = data.members.find((item) => item.id === refundLine.memberId);
                return <li key={refundLine.id}>{member?.name ?? "Member"} receives {formatCents(refundLine.amountCents)}</li>;
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
