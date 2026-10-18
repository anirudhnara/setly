"use client";

import Link from "next/link";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Check, Copy, Crown } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { Avatar, GroupHeader } from "@/components/shared/group-header";
import { GroupMissing, GroupLoading } from "@/components/group/group-states";
import { ProductImage } from "@/components/shared/product-image";
import { stageMember } from "@/components/shared/session";
import { useMe } from "@/components/shared/use-me";
import { usePlan } from "@/components/shared/use-plan";
import { joinGroup } from "@/lib/client";
import { planTotalCents } from "@/lib/rules/check";

export function JoinView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const me = useMe(plan.data);
  const [name, setName] = useState("");
  const [fault, setFault] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  // Client-only value; the page renders a loading state until mounted, so server HTML never includes it.
  const [link] = useState(() => (typeof window === "undefined" ? "" : `${window.location.origin}/g/${groupId}/join`));
  const [localOnly] = useState(() => typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname.endsWith(".localhost")));

  async function join() {
    setPending(true);
    setFault("");
    try {
      const joined = await joinGroup(groupId, name.trim() ? { name: name.trim() } : {});
      stageMember(groupId, { memberId: joined.member.id, name: joined.member.name });
      await plan.mutate();
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Couldn't join this group.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFault("Couldn't copy. Select the link and copy it instead.");
    }
  }

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <GroupLoading />;
  const data = plan.data;
  if (!data) return <GroupMissing />;

  const map = data.map;
  const photos = map.products.slice(0, 6);
  const total = planTotalCents(map, Math.max(1, data.members.length));
  const member = me.member;
  const locked = data.group.status !== "editing";

  return (
    <div className="group-page">
      <GroupHeader
        state={data}
        step="invite"
        title={member ? "Bring your group in" : `Join ${data.group.name}`}
        lede={member ? "Share the link or QR code. Everyone who joins can love, swap, and regrow the set, then pays only their share." : "You’ve been invited to shape this set together and split the cost."}
      />

      <div className="group-grid">
        <section className="g-card set-preview">
          <div className="photo-grid">
            {photos.length ? photos.map((product, index) => (
              <ProductImage key={product.id} product={product} need={product.title} className={`photo p${index}`} />
            )) : <p className="muted">The set is still growing.</p>}
          </div>
          <div className="set-preview-foot">
            <div>
              <span className="orbit-label">The set</span>
              <strong className="big-number">{formatCents(total)}</strong>
              <span className="muted">{map.slots.length} items · {new Set(map.products.map((product) => product.store)).size} stores</span>
            </div>
            <Link className="btn btn-ghost" href={`/g/${groupId}`}>See the set <ArrowRight aria-hidden="true" /></Link>
          </div>
        </section>

        <section className="g-card">
          {member ? (
            <>
              <span className="orbit-label">{localOnly ? "Local preview link" : "Invite link"}</span>
              {localOnly ? <p className="muted" role="status">This set was created in your local app. The link only opens on this computer, and the hosted app has a separate set of groups. To share with others, create the set on your deployed Setly site.</p> : null}
              <div className="invite-row">
                <input readOnly value={link} aria-label={localOnly ? "Local preview link" : "Invite link"} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" className="btn" onClick={() => void copy()} disabled={localOnly || !link}>{copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy</>}</button>
              </div>
              {link && !localOnly ? (
                <div className="qr">
                  <QRCodeSVG value={link} size={148} bgColor="#ffffff" fgColor="#1c1a17" level="M" />
                  <p className="muted">Scan to join from a phone.</p>
                </div>
              ) : null}
            </>
          ) : (
            <form className="join-form" onSubmit={(event) => { event.preventDefault(); void join(); }}>
              <span className="orbit-label">Join as</span>
              <label htmlFor="join-name">Display name <span className="muted">(optional)</span></label>
              <input id="join-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={me.user?.name ?? "Your name"} autoComplete="nickname" />
              <button type="submit" className="btn btn-accent wide-btn" disabled={pending || locked}>{pending ? "Joining…" : "Join the set"} <ArrowRight aria-hidden="true" /></button>
              {locked ? <p className="muted">This set is locked for payment, so new people can’t join now.</p> : null}
            </form>
          )}
          {fault ? <p className="fault" role="alert">{fault}</p> : null}

          <div className="people-list">
            <span className="orbit-label">{data.members.length} in this set</span>
            <ul>
              {data.members.map((person, index) => (
                <li key={person.id} style={{ animationDelay: `${index * 0.06}s` }}>
                  <Avatar name={person.name} tone={index} />
                  <span>{person.name}{person.id === member?.id ? <em> (you)</em> : null}</span>
                  {person.isOrganizer ? <span className="pill"><Crown aria-hidden="true" /> Organizer</span> : null}
                </li>
              ))}
            </ul>
          </div>
          {member && !locked ? <Link className="btn btn-accent wide-btn" href={`/g/${groupId}/split`}>Everyone’s in — split it <ArrowRight aria-hidden="true" /></Link> : null}
        </section>
      </div>
    </div>
  );
}
