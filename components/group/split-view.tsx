"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ArrowRight, ChevronDown, Lock } from "lucide-react";
import { formatCents, payLabel } from "@/components/shared/format";
import { Avatar, GroupHeader } from "@/components/shared/group-header";
import { GroupLoading, GroupMissing } from "@/components/group/group-states";
import { ProductImage } from "@/components/shared/product-image";
import { useMe } from "@/components/shared/use-me";
import { usePlan } from "@/components/shared/use-plan";
import { lockGroup } from "@/lib/client";
import { computeShares } from "@/lib/money/shares";

export function SplitView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const me = useMe(plan.data);
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  async function lock() {
    setPending(true);
    setFault("");
    try {
      await lockGroup(groupId);
      await plan.mutate();
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't lock the set.");
    } finally {
      setPending(false);
    }
  }

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <GroupLoading />;
  const data = plan.data;
  if (!data) return <GroupMissing />;

  const editing = data.group.status === "editing";
  // Before the lock the split is a live preview from the same pure money code the server uses.
  const shares = editing || data.shares.length === 0 ? computeShares(data.map, data.members) : data.shares;
  const total = shares.reduce((sum, share) => sum + share.totalCents, 0);
  const largest = Math.max(1, ...shares.map((share) => share.totalCents));
  const slotById = new Map(data.map.slots.map((slot) => [slot.id, slot]));

  return (
    <div className="group-page">
      <GroupHeader
        state={data}
        step="split"
        title={editing ? "Here’s how it splits" : "The split is locked"}
        lede="Shared items split evenly, per-person items charge each person for their own, and things you already own cost nothing. Leftover cents go to the earliest members, so it always adds up exactly."
      />

      <div className="group-grid">
        <section className="g-card">
          <div className="split-total">
            <div>
              <span className="orbit-label">Set total</span>
              <strong className="big-number">{formatCents(total)}</strong>
            </div>
            <div>
              <span className="orbit-label">People</span>
              <strong className="big-number">{data.members.length}</strong>
            </div>
          </div>
          <ul className="share-cards">
            {shares.map((share, index) => {
              const person = data.members.find((member) => member.id === share.memberId);
              const mine = person?.id === me.member?.id;
              const expanded = open === share.memberId;
              return (
                <li key={share.memberId} className={`share-card${mine ? " mine" : ""}`} style={{ "--i": index } as CSSProperties}>
                  <button type="button" className="share-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : share.memberId)}>
                    <Avatar name={person?.name ?? "?"} tone={index} />
                    <span className="share-name">{person?.name ?? "Member"}{mine ? <em> (you)</em> : null}<small>{share.lines.filter((line) => line.kind === "item").length} items</small></span>
                    <strong>{formatCents(share.totalCents)}</strong>
                    <ChevronDown className="chev" aria-hidden="true" />
                  </button>
                  <span className="share-bar" aria-hidden="true"><i style={{ width: `${Math.round((share.totalCents / largest) * 100)}%` }} /></span>
                  {expanded ? (
                    <ul className="share-lines">
                      {share.lines.filter((line) => line.cents > 0).map((line, lineIndex) => {
                        const slot = line.slotId ? slotById.get(line.slotId) : undefined;
                        const product = data.map.products.find((item) => item.id === slot?.chosenProductId) ?? null;
                        return (
                          <li key={line.slotId ?? `${line.kind}-${line.store}-${lineIndex}`}>
                            <ProductImage product={product} need={slot?.need ?? ""} className="line-image" />
                            <span>
                              {line.kind === "buffer" ? `Buffer · ${line.store ?? "store"}` : line.kind === "zinc_fee" ? `Order fee · ${line.store ?? "store"}` : (slot?.need ?? "Item")}
                              <small>{line.kind === "buffer" ? "Covers tax and shipping, refunded if unused" : line.kind === "zinc_fee" ? "Zinc’s $1 per order, split evenly" : slot ? payLabel(slot.payType) : ""}</small>
                            </span>
                            <b>{formatCents(line.cents)}</b>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="g-card action-card">
          <span className="orbit-label">{editing ? "Next" : "Locked"}</span>
          <h2>{editing ? "Lock it in" : "Time to pay"}</h2>
          <p className="muted">
            {editing
              ? "Locking freezes the set so everyone pays the same numbers. Make sure everyone has joined first — people can’t join after."
              : "Each person pays their share. When the set is fully funded, Setly issues one card that only works at these stores."}
          </p>
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
          {editing ? (
            <button type="button" className="btn btn-accent wide-btn" disabled={pending || data.map.slots.length === 0 || !me.member} onClick={() => void lock()}>
              <Lock aria-hidden="true" /> {pending ? "Locking…" : "Lock the set & split"}
            </button>
          ) : (
            <Link className="btn btn-accent wide-btn" href={`/g/${groupId}/checkout`}>Go to payment <ArrowRight aria-hidden="true" /></Link>
          )}
          {editing ? <Link className="btn btn-ghost wide-btn" href={`/g/${groupId}/join`}>Invite more people</Link> : null}
        </aside>
      </div>
    </div>
  );
}
