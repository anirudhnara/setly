"use client";

import { useEffect, useState } from "react";
import type { Member } from "@/lib/types";
import { readMember, stageMember, type SessionMember } from "@/components/shared/session";

export function MemberBar({ groupId, members }: { groupId: string; members: Member[] }) {
  const [who, setWho] = useState<SessionMember | null>(null);

  useEffect(() => {
    setWho(readMember(groupId));
  }, [groupId]);

  function choose(member: Member) {
    const next = { memberId: member.id, name: member.name };
    stageMember(groupId, next);
    setWho(next);
  }

  return (
    <section className="member-bar">
      <div>
        <span className="orbit-label">Acting as</span>
        <strong>{who ? who.name : "No one yet"}</strong>
      </div>
      <div className="chip-row" role="group" aria-label="Choose a member">
        {members.map((member) => (
          <button key={member.id} type="button" className={who?.memberId === member.id ? "chip on" : "chip"} onClick={() => choose(member)}>
            {member.name}
            {member.isOrganizer ? " · organizer" : ""}
          </button>
        ))}
      </div>
    </section>
  );
}
