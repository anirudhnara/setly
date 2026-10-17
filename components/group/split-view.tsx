"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/components/shared/format";
import { MemberBar } from "@/components/shared/member-bar";
import { readMember } from "@/components/shared/session";
import { usePlan } from "@/components/shared/use-plan";
import { lockGroup } from "@/lib/client";

export function SplitView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState("");

  async function lock() {
    const member = readMember(groupId);
    if (!member) {
      setFault("Choose who you are, or join, before locking the map.");
      return;
    }
    setPending(true);
    setFault("");
    try {
      await lockGroup(groupId, { memberId: member.memberId });
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't lock the map.");
    } finally {
      setPending(false);
    }
  }

  if (!plan.mounted) return <p className="orbit-status">Syncing the group…</p>;
  const data = plan.data;
  return (
    <>
      {plan.isLoading ? <p className="orbit-status">Syncing the group…</p> : null}
      {plan.error ? <p className="fault" role="alert">This group isn't on the ledger.</p> : null}
      {data ? (
        <section className="panel">
          <span className="orbit-label">{data.group.status}</span>
          <h1>The split</h1>
          <p>Shared slots divide evenly. Leftover cents go to the earliest members, so the shares add up to the exact total.</p>
          {!plan.live ? <p className="notice">This group has no stored map, so the ledger split is empty. Open the <Link href="/g/grp_apartment/split">sample plan</Link> to fund a real one.</p> : null}
          <MemberBar groupId={groupId} members={data.members} />
          <div className="share-table">
            {data.shares.length === 0 ? <p className="orbit-status">No shares yet. Lock the map once people have joined.</p> : null}
            {data.shares.map((share) => {
              const member = data.members.find((item) => item.id === share.memberId);
              return (
                <div key={share.memberId} className="share-row">
                  <strong>{member?.name ?? share.memberId}</strong>
                  <span>{share.lines.length} lines</span>
                  <b>{formatCents(share.totalCents)}</b>
                </div>
              );
            })}
            <div className="share-row total">
              <strong>Plan total</strong>
              <span />
              <b>{formatCents(data.totalCents)}</b>
            </div>
          </div>
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
          {data.group.status === "editing" ? (
            <button type="button" className="build" disabled={pending || !plan.live} onClick={() => void lock()}>
              {pending ? "Locking…" : "Lock the map"}
            </button>
          ) : (
            <Link className="text-link" href={`/g/${groupId}/checkout`}>Continue to pay</Link>
          )}
        </section>
      ) : null}
    </>
  );
}
