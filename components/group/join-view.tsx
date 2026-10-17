"use client";

import { useState } from "react";
import { MemberBar } from "@/components/shared/member-bar";
import { stageMember } from "@/components/shared/session";
import { usePlan } from "@/components/shared/use-plan";
import { joinGroup } from "@/lib/client";

export function JoinView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [fault, setFault] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    const clean = name.trim();
    if (!clean) {
      setFault("Add your name first.");
      return;
    }
    setPending(true);
    setFault("");
    try {
      const joined = await joinGroup(groupId, { name: clean });
      stageMember(groupId, { memberId: joined.member.id, name: joined.member.name });
      setNote(`${joined.member.name} is in${joined.member.isOrganizer ? " as the organizer" : ""}.`);
      setName("");
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't join.");
    } finally {
      setPending(false);
    }
  }

  if (!plan.mounted) return <p className="orbit-status">Syncing the group…</p>;
  return (
    <>
      {plan.isLoading ? <p className="orbit-status">Syncing the group…</p> : null}
      {plan.error ? <p className="fault" role="alert">This group isn't on the ledger.</p> : null}
      {plan.data ? (
        <section className="panel narrow">
          <span className="orbit-label">{plan.data.group.name}</span>
          <h1>Join with a name</h1>
          <p>No account. The first person in becomes the organizer. Anyone already here can keep acting as themselves.</p>
          {plan.data.group.status !== "editing" ? <p className="notice">This map is already locked, so a new name can’t join. Act as someone who’s already in, or start a fresh brief from the console.</p> : null}
          <MemberBar groupId={groupId} members={plan.data.members} />
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="join-name">Your name</label>
            <input id="join-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ani" autoComplete="nickname" />
            {fault ? <p className="fault" role="alert">{fault}</p> : null}
            {note ? <p className="notice">{note}</p> : null}
            <button type="submit" className="build" disabled={pending}>{pending ? "Joining…" : "Join the group"}</button>
          </form>
          <ul className="people">
            {plan.data.members.map((member) => (
              <li key={member.id}>{member.name}{member.isOrganizer ? " · organizer" : ""}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
