"use client";

import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ArrowRight, Ban, Check, Clock, Gift, ShieldCheck } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { useCards } from "@/components/sponsor/store";
import { availableCents, cardStatus, decodeCard, lineSpentCents, type SponsorCard } from "@/lib/sponsor/card";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Where a claim link lands: the card joins this account, then shows what it can buy and until when. */
const noSubscribe = () => () => {};

export function RecipientView() {
  const [cards, setCards] = useCards("received");
  const token = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).get("c") ?? "", () => "");
  const incoming = useMemo(() => (token ? decodeCard(token) : null), [token]);
  const arrived = incoming?.id ?? null;
  const fault = token && !incoming ? "That card link is incomplete. Ask whoever sent it to copy it again." : "";

  // The link's copy of the card replaces any older copy, so reopening a newer link shows the latest.
  useEffect(() => {
    if (incoming) setCards((current) => [incoming, ...current.filter((item) => item.id !== incoming.id)]);
  }, [incoming, setCards]);

  const now = new Date();
  return (
    <div className="sp-page sp-parent sp-recipient">
      <header className="sp-head">
        <div>
          <span className="orbit-label">Your cards</span>
          <h1>{arrived ? "A card just landed" : "Cards sent to you"}</h1>
          <p className="muted">Spend them on a Setly set. Each card only works where its sender allows, and it stops on its expiry date.</p>
        </div>
      </header>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      {cards.length === 0 && !fault ? <p className="muted">No cards yet. When a parent or insurer sends you one, open their link and it shows up here.</p> : null}
      <div className="sp-received">
        {cards.map((card) => <ReceivedCard key={card.id} card={card} now={now} fresh={card.id === arrived} />)}
      </div>
    </div>
  );
}

function ReceivedCard({ card, now, fresh }: { card: SponsorCard; now: Date; fresh: boolean }) {
  const status = cardStatus(card, now);
  const active = status === "active";
  const insurer = card.kind === "insurance";
  return (
    <section className={`sp-panel sp-received-card${fresh ? " fresh" : ""}`}>
      <div className={`vcard${active ? " live" : ""} sp-vcard`}>
        <div className="vcard-top">
          <span className="vcard-brand">setly</span>
          <span className="vcard-status">{active ? "Active" : status === "expired" ? "Expired" : "Ended"}</span>
        </div>
        <span className="vcard-chip" aria-hidden="true" />
        <span className="vcard-number">•••• •••• •••• {card.last4}</span>
        <div className="vcard-bottom">
          <span>From {card.sponsorName}</span>
          <strong>{formatCents(availableCents(card))}</strong>
        </div>
      </div>
      <div className="sp-rules">
        <p className="sp-from">{fresh ? <Gift aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />} {card.sponsorName} sent you {formatCents(card.amountCents)}{insurer && card.claim ? ` for claim ${card.claim.number}` : ""}.</p>
        <ul>
          <li><Check aria-hidden="true" /> Up to {formatCents(card.perPurchaseCents)} per purchase</li>
          <li><Check aria-hidden="true" /> {insurer ? `Claim items only: ${card.lines.map((line) => `${line.label} (${formatCents(line.allowanceCents - lineSpentCents(card, line.id))} left)`).join(", ")}` : `Works for ${card.categories.join(", ")}`}</li>
          {card.blockedStores.length ? <li><Ban aria-hidden="true" /> Not at {card.blockedStores.join(", ")}</li> : null}
          <li><Clock aria-hidden="true" /> Expires {shortDate(card.expiresAt)}; anything left goes back to {card.sponsorName}</li>
        </ul>
        {active ? <Link className="btn btn-accent" href="/home">Start a set with it <ArrowRight aria-hidden="true" /></Link> : null}
      </div>
      {card.transactions.length > 0 ? (
        <ul className="sp-feed compact">
          {card.transactions.slice(0, 5).map((tx) => (
            <li key={tx.id} className={tx.approved ? "ok" : "no"}>
              <span className="auth-icon" aria-hidden="true">{tx.approved ? <Check /> : <Ban />}</span>
              <span><strong>{tx.merchant}</strong><small>{tx.reason}</small></span>
              <b>{formatCents(tx.amountCents)}</b>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
