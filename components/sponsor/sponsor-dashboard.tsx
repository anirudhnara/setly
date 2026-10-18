"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import { Ban, Check, Clock, Copy, CreditCard, Download, Plus, RotateCcw, Send, ShieldCheck, Undo2, X } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { CATEGORIES, COPY, MERCHANTS, PARENT_DEFAULTS, SAMPLE_CLAIM, SAMPLE_LINES } from "@/components/sponsor/presets";
import { useCards } from "@/components/sponsor/store";
import {
  applyPurchase, availableCents, cardStatus, closeOut, encodeCard, lineSpentCents, parseDollars, refundTransaction, returnedCents, spentCents,
  type ClaimLine, type SponsorCard, type SponsorKind,
} from "@/lib/sponsor/card";

const DAY_MS = 86_400_000;
const noSubscribe = () => () => {};
const dateInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const endOfDay = (value: string) => new Date(`${value}T23:59:00`).toISOString();
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dollars = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

/** Ticks once a minute, so countdowns move and an expired card sweeps its money back on its own. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function SponsorDashboard({ kind }: { kind: SponsorKind }) {
  const [allCards, setCards] = useCards("sent");
  const cards = useMemo(() => allCards.filter((card) => card.kind === kind), [allCards, kind]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [sent, setSent] = useState<SponsorCard | null>(null);
  const now = useNow();
  const insurer = kind === "insurance";
  const copy = COPY[kind];
  const selected = cards.find((card) => card.id === selectedId) ?? cards[0] ?? null;
  const showComposer = composing || cards.length === 0;

  // Expired cards return what's left to the sponsor, once, as soon as anyone looks.
  useEffect(() => {
    if (!cards.some((card) => cardStatus(card, now) === "expired" && !card.sweeps.some((sweep) => sweep.reason === "expired"))) return;
    setCards((current) => current.map((card) => (card.kind === kind ? closeOut(card, now, `sw_${nanoid(8)}`) : card)));
  }, [cards, now, kind, setCards]);

  function save(next: SponsorCard) {
    setCards((current) => current.map((card) => (card.id === next.id ? next : card)));
  }

  function send(card: SponsorCard) {
    setCards((current) => [card, ...current]);
    setSelectedId(card.id);
    setComposing(false);
    setSent(card);
    window.setTimeout(() => setSent(null), 2_400);
  }

  const totals = cards.reduce(
    (sum, card) => ({ funded: sum.funded + card.amountCents, spent: sum.spent + spentCents(card), returned: sum.returned + returnedCents(card), open: sum.open + (cardStatus(card, now) === "active" ? availableCents(card) : 0) }),
    { funded: 0, spent: 0, returned: 0, open: 0 },
  );
  const declined = cards.flatMap((card) => card.transactions.filter((tx) => !tx.approved));

  return (
    <div className={`sp-page ${insurer ? "sp-claims" : "sp-parent"}`}>
      <header className="sp-head">
        <div>
          <span className="orbit-label">{insurer ? `${copy.sponsor} · Claims` : "Family"}</span>
          <h1>{insurer ? "Replacement cards" : "Cards for your family"}</h1>
          <p className="muted">
            {insurer
              ? "Fund a claim in full on day one. The card only buys items on the claim, each line is capped, and anything unspent comes back to the carrier on the expiry date."
              : "Send money as a card that only works where you say. Set limits, watch every purchase, and get back anything returned or left over."}
          </p>
        </div>
        <dl className="sp-kpis">
          <div><dt>{insurer ? "Disbursed" : "Sent"}</dt><dd>{formatCents(totals.funded)}</dd></div>
          <div><dt>Spent</dt><dd>{formatCents(totals.spent)}</dd></div>
          <div><dt>{insurer ? "Returned to carrier" : "Back to you"}</dt><dd>{formatCents(totals.returned)}</dd></div>
          <div><dt>{insurer ? "Open exposure" : "Still on cards"}</dt><dd>{formatCents(totals.open)}</dd></div>
          {insurer ? <div><dt>Leakage blocked</dt><dd>{formatCents(declined.reduce((sum, tx) => sum + tx.amountCents, 0))}</dd></div> : null}
        </dl>
      </header>

      {cards.length > 0 ? (
        <nav className="sp-cards" aria-label={insurer ? "Claim cards" : "Your cards"}>
          {cards.map((card) => {
            const status = cardStatus(card, now);
            return (
              <button key={card.id} type="button" className={`sp-card-tab${!showComposer && selected?.id === card.id ? " on" : ""}`} onClick={() => { setSelectedId(card.id); setComposing(false); }}>
                <strong>{insurer ? (card.claim?.number ?? card.recipientName) : card.recipientName}</strong>
                <small>{formatCents(availableCents(card))} left · {status === "active" ? "Active" : status === "expired" ? "Expired" : status === "ended" ? "Ended" : "Draft"}</small>
              </button>
            );
          })}
          <button type="button" className={`sp-card-tab new${showComposer ? " on" : ""}`} onClick={() => setComposing(true)}>
            <Plus aria-hidden="true" /> {insurer ? "New claim card" : "New card"}
          </button>
        </nav>
      ) : null}

      {showComposer ? <Composer kind={kind} now={now} onSend={send} onCancel={cards.length > 0 ? () => setComposing(false) : null} /> : selected ? <CardDetail card={selected} now={now} onChange={save} /> : null}

      {sent ? (
        <div className="sp-sent" role="status" aria-live="polite">
          <div className="sp-sent-inner">
            <span className="sp-sent-card" aria-hidden="true"><CreditCard /></span>
            <span className="sp-sent-check" aria-hidden="true"><Check /></span>
            <strong>Sent!</strong>
            <span>{formatCents(sent.amountCents)} to {sent.recipientName}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Composer({ kind, now, onSend, onCancel }: { kind: SponsorKind; now: Date; onSend: (card: SponsorCard) => void; onCancel: (() => void) | null }) {
  const insurer = kind === "insurance";
  const copy = COPY[kind];
  const [recipientName, setRecipientName] = useState(copy.recipient);
  const [recipientEmail, setRecipientEmail] = useState(insurer ? "jordan.lee@example.com" : "ani@example.com");
  const [amount, setAmount] = useState(PARENT_DEFAULTS.amount);
  const [perPurchase, setPerPurchase] = useState(insurer ? "1200" : PARENT_DEFAULTS.perPurchase);
  const [categories, setCategories] = useState<string[]>(PARENT_DEFAULTS.categories);
  const [blocked, setBlocked] = useState(insurer ? "GiftCardz" : PARENT_DEFAULTS.blocked);
  const [expires, setExpires] = useState(dateInput(new Date(now.getTime() + (insurer ? 90 : PARENT_DEFAULTS.days) * DAY_MS)));
  const [lines, setLines] = useState<ClaimLine[]>(SAMPLE_LINES);
  const [claimNumber, setClaimNumber] = useState(SAMPLE_CLAIM.number);
  const [fault, setFault] = useState("");
  const claimTotal = lines.reduce((sum, line) => sum + line.allowanceCents, 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = insurer ? claimTotal : parseDollars(amount);
    const perPurchaseCents = parseDollars(perPurchase);
    if (!recipientName.trim()) return setFault("Add who the card is for.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) return setFault("Add an email the claim link can go to.");
    if (!amountCents || amountCents <= 0) return setFault(insurer ? "Add at least one claim line." : "Add an amount to send.");
    if (!perPurchaseCents || perPurchaseCents <= 0) return setFault("Add a per-purchase limit.");
    if (Date.parse(endOfDay(expires)) <= now.getTime()) return setFault("Pick an expiration date in the future.");
    if (!insurer && categories.length === 0) return setFault("Allow at least one category.");
    const stamp = now.toISOString();
    onSend({
      id: `sc_${nanoid(10)}`,
      kind,
      sponsorName: copy.sponsor,
      sponsorAccount: copy.account,
      recipientName: recipientName.trim(),
      recipientEmail: recipientEmail.trim(),
      amountCents,
      perPurchaseCents: Math.min(perPurchaseCents, amountCents),
      categories: insurer ? [...new Set(lines.map((line) => line.category))] : categories,
      blockedStores: blocked.split(",").map((store) => store.trim()).filter(Boolean),
      lines: insurer ? lines : [],
      claim: insurer ? { ...SAMPLE_CLAIM, number: claimNumber.trim() || SAMPLE_CLAIM.number } : null,
      expiresAt: endOfDay(expires),
      createdAt: stamp,
      sentAt: stamp,
      endedAt: null,
      last4: String(1000 + Math.floor(Math.random() * 9000)),
      transactions: [],
      sweeps: [],
    });
  }

  return (
    <form className="sp-panel sp-composer" onSubmit={submit}>
      <div className="sp-section-head">
        <span className="sp-step">{insurer ? "01" : ""}</span>
        <h2>{insurer ? "Fund a replacement card" : "Send a card"}</h2>
        {onCancel ? <button type="button" className="icon-action" aria-label="Close" onClick={onCancel}><X aria-hidden="true" /></button> : null}
      </div>

      <div className="sp-fields">
        {insurer ? (
          <label className="sp-field">
            <span>Claim number</span>
            <input value={claimNumber} onChange={(event) => setClaimNumber(event.target.value)} maxLength={40} required />
          </label>
        ) : null}
        <label className="sp-field">
          <span>{insurer ? "Policyholder" : "Who it's for"}</span>
          <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={60} autoComplete="off" required />
        </label>
        <label className="sp-field">
          <span>Their email</span>
          <input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} maxLength={120} autoComplete="off" required />
        </label>
        {!insurer ? (
          <label className="sp-field">
            <span>Amount</span>
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby="sp-amount-help" required />
            <small id="sp-amount-help">Dollars. Moves from {copy.account}.</small>
          </label>
        ) : null}
        <label className="sp-field">
          <span>Per-purchase limit</span>
          <input inputMode="decimal" value={perPurchase} onChange={(event) => setPerPurchase(event.target.value)} required />
        </label>
        <label className="sp-field">
          <span>Expires</span>
          <input type="date" value={expires} min={dateInput(new Date(now.getTime() + DAY_MS))} onChange={(event) => setExpires(event.target.value)} required />
          <small>Whatever is left returns to {insurer ? "the carrier" : "you"} that night.</small>
        </label>
        <label className="sp-field wide">
          <span>Blocked stores</span>
          <input value={blocked} onChange={(event) => setBlocked(event.target.value)} placeholder="Comma-separated" />
        </label>
      </div>

      {insurer ? (
        <LinesEditor lines={lines} onChange={setLines} total={claimTotal} />
      ) : (
        <fieldset className="sp-chips">
          <legend>What it can buy</legend>
          {CATEGORIES.map((category) => {
            const on = categories.includes(category);
            return (
              <button key={category} type="button" className={`sp-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setCategories((current) => (on ? current.filter((item) => item !== category) : [...current, category]))}>
                {on ? <Check aria-hidden="true" /> : null}{category}
              </button>
            );
          })}
        </fieldset>
      )}

      {fault ? <p className="fault" role="alert">{fault}</p> : null}
      <button type="submit" className="btn btn-accent sp-send">
        <Send aria-hidden="true" /> Send {formatCents(insurer ? claimTotal : (parseDollars(amount) ?? 0))} to {recipientName.trim().split(" ")[0] || "them"}
      </button>
    </form>
  );
}

function LinesEditor({ lines, onChange, total }: { lines: ClaimLine[]; onChange: (lines: ClaimLine[]) => void; total: number }) {
  return (
    <div className="sp-lines">
      <table>
        <caption>Claim lines · replacement cost value</caption>
        <thead>
          <tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col" className="num">Allowance</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.label}</td>
              <td>{line.category}</td>
              <td className="num">
                <input
                  aria-label={`Allowance for ${line.label}`}
                  inputMode="decimal"
                  defaultValue={dollars(line.allowanceCents)}
                  onBlur={(event) => {
                    const cents = parseDollars(event.target.value);
                    if (cents !== null) onChange(lines.map((item) => (item.id === line.id ? { ...item, allowanceCents: cents } : item)));
                  }}
                />
              </td>
              <td><button type="button" className="icon-action" aria-label={`Remove ${line.label}`} onClick={() => onChange(lines.filter((item) => item.id !== line.id))}><X aria-hidden="true" /></button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th scope="row" colSpan={2}>Total funded</th><td className="num">{formatCents(total)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

function CardDetail({ card, now, onChange }: { card: SponsorCard; now: Date; onChange: (card: SponsorCard) => void }) {
  const insurer = card.kind === "insurance";
  const status = cardStatus(card, now);
  const active = status === "active";
  const available = availableCents(card);
  const daysLeft = Math.max(0, Math.ceil((Date.parse(card.expiresAt) - now.getTime()) / DAY_MS));
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState("");
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const link = origin ? `${origin}/card?c=${encodeCard(card)}` : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="sp-detail">
      <section className="sp-panel sp-card-panel">
        <div className={`vcard${active ? " live" : ""} sp-vcard`}>
          <div className="vcard-top">
            <span className="vcard-brand">setly</span>
            <span className="vcard-status">{active ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : status === "expired" ? "Expired" : "Ended"}</span>
          </div>
          <span className="vcard-chip" aria-hidden="true" />
          <span className="vcard-number">•••• •••• •••• {card.last4}</span>
          <div className="vcard-bottom">
            <span>{card.recipientName}</span>
            <strong>{formatCents(available)}</strong>
          </div>
        </div>

        <dl className="sp-facts">
          {insurer && card.claim ? (
            <>
              <div><dt>Claim</dt><dd>{card.claim.number}</dd></div>
              <div><dt>Policy</dt><dd>{card.claim.policy}</dd></div>
              <div><dt>Loss</dt><dd>{card.claim.peril} · {shortDate(card.claim.dateOfLoss)}</dd></div>
              <div><dt>Adjuster</dt><dd>{card.claim.adjuster}</dd></div>
            </>
          ) : null}
          <div><dt>{insurer ? "Policyholder" : "Sent to"}</dt><dd>{card.recipientName} · {card.recipientEmail}</dd></div>
          <div><dt>Funded</dt><dd>{formatCents(card.amountCents)} on {shortDate(card.sentAt ?? card.createdAt)}</dd></div>
          <div><dt>Expires</dt><dd>{shortDate(card.expiresAt)} · unspent returns to {card.sponsorAccount}</dd></div>
        </dl>

        <div className="sp-share">
          <span className="orbit-label">{insurer ? "Policyholder link" : "Their claim link"}</span>
          <div className="sp-share-row">
            <input readOnly value={link} aria-label="Card link" onFocus={(event) => event.target.select()} />
            <button type="button" className="btn btn-ghost" onClick={() => void copyLink()}>{copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy</>}</button>
          </div>
          <small className="muted">They sign in, open it, and the card is in their Setly account.</small>
        </div>
      </section>

      {/* Keyed by the saved limits, so the form starts from them again after any change. */}
      <Controls key={`${card.id}:${card.perPurchaseCents}:${card.expiresAt}:${card.blockedStores.join("|")}`} card={card} now={now} saved={saved} onSaved={setSaved} onChange={onChange} />
      {insurer ? <Coverage card={card} /> : null}
      <Activity card={card} now={now} onChange={onChange} />
      <MoneyBack card={card} now={now} onChange={onChange} />
    </div>
  );
}

function Controls({ card, now, saved, onSaved: setSaved, onChange }: { card: SponsorCard; now: Date; saved: string; onSaved: (message: string) => void; onChange: (card: SponsorCard) => void }) {
  const insurer = card.kind === "insurance";
  const active = cardStatus(card, now) === "active";
  const [perPurchase, setPerPurchase] = useState(dollars(card.perPurchaseCents));
  const [expires, setExpires] = useState(dateInput(new Date(card.expiresAt)));
  const [blocked, setBlocked] = useState(card.blockedStores.join(", "));

  function apply(event: FormEvent) {
    event.preventDefault();
    const cents = parseDollars(perPurchase);
    if (!cents || cents <= 0 || Date.parse(endOfDay(expires)) <= now.getTime()) {
      setSaved("Use a limit above $0 and a future date.");
      return;
    }
    onChange({ ...card, perPurchaseCents: cents, expiresAt: endOfDay(expires), blockedStores: blocked.split(",").map((store) => store.trim()).filter(Boolean) });
    setSaved("Saved. The card follows the new limits right away.");
  }

  function toggle(category: string) {
    const on = card.categories.includes(category);
    onChange({ ...card, categories: on ? card.categories.filter((item) => item !== category) : [...card.categories, category] });
  }

  return (
    <form className="sp-panel" onSubmit={apply}>
      <div className="sp-section-head"><span className="sp-step">{insurer ? "02" : ""}</span><h2>Limits</h2></div>
      <div className="sp-fields">
        <label className="sp-field"><span>Per-purchase limit</span><input inputMode="decimal" value={perPurchase} disabled={!active} onChange={(event) => setPerPurchase(event.target.value)} /></label>
        <label className="sp-field"><span>Expires</span><input type="date" value={expires} disabled={!active} onChange={(event) => setExpires(event.target.value)} /></label>
        <label className="sp-field wide"><span>Blocked stores</span><input value={blocked} disabled={!active} onChange={(event) => setBlocked(event.target.value)} /></label>
      </div>
      {!insurer ? (
        <fieldset className="sp-chips" disabled={!active}>
          <legend>What it can buy</legend>
          {CATEGORIES.map((category) => {
            const on = card.categories.includes(category);
            return (
              <button key={category} type="button" className={`sp-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(category)}>
                {on ? <Check aria-hidden="true" /> : null}{category}
              </button>
            );
          })}
        </fieldset>
      ) : (
        <p className="muted sp-note">Only categories on the claim are allowed: {card.categories.join(", ")}.</p>
      )}
      <div className="sp-actions">
        <button type="submit" className="btn btn-ghost" disabled={!active}>Save limits</button>
        {saved ? <span className="muted" role="status">{saved}</span> : null}
      </div>
    </form>
  );
}

function Coverage({ card }: { card: SponsorCard }) {
  return (
    <section className="sp-panel">
      <div className="sp-section-head"><span className="sp-step">03</span><h2>Coverage by claim line</h2></div>
      <div className="sp-lines">
        <table>
          <thead>
            <tr><th scope="col">Item</th><th scope="col" className="num">Allowance</th><th scope="col" className="num">Spent</th><th scope="col" className="num">Remaining</th><th scope="col">Used</th></tr>
          </thead>
          <tbody>
            {card.lines.map((line) => {
              const spent = lineSpentCents(card, line.id);
              const used = line.allowanceCents ? Math.min(100, Math.round((spent / line.allowanceCents) * 100)) : 0;
              return (
                <tr key={line.id}>
                  <td>{line.label}<small>{line.category}</small></td>
                  <td className="num">{formatCents(line.allowanceCents)}</td>
                  <td className="num">{formatCents(spent)}</td>
                  <td className="num">{formatCents(line.allowanceCents - spent)}</td>
                  <td><span className="sp-bar" aria-label={`${used}% used`}><i style={{ width: `${used}%` }} /></span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Activity({ card, now, onChange }: { card: SponsorCard; now: Date; onChange: (card: SponsorCard) => void }) {
  const insurer = card.kind === "insurance";
  const [merchant, setMerchant] = useState(MERCHANTS[0]?.name ?? "IKEA");
  const [amount, setAmount] = useState("129");
  const [fault, setFault] = useState("");
  const category = MERCHANTS.find((item) => item.name === merchant)?.category ?? "Furniture";

  function test(event: FormEvent) {
    event.preventDefault();
    const cents = parseDollars(amount);
    if (!cents) return setFault("Type an amount in dollars.");
    setFault("");
    onChange(applyPurchase(card, { merchant, category, amountCents: cents }, new Date(), `tx_${nanoid(8)}`));
  }

  function exportCsv() {
    const rows = [["date", "merchant", "category", "amount", "decision", "reason", "claim_line", "refunded"], ...card.transactions.map((tx) => [tx.at, tx.merchant, tx.category, dollars(tx.amountCents), tx.approved ? "approved" : "declined", tx.reason, card.lines.find((line) => line.id === tx.lineId)?.label ?? "", dollars(tx.refundedCents)])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${card.claim?.number ?? card.recipientName}-activity.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="sp-panel">
      <div className="sp-section-head">
        <span className="sp-step">{insurer ? "04" : ""}</span>
        <h2>{insurer ? "Transactions" : "Spending"}</h2>
        {insurer ? <button type="button" className="btn btn-ghost sp-export" onClick={exportCsv}><Download aria-hidden="true" /> Export CSV</button> : null}
      </div>

      <form className="sp-test" onSubmit={test} aria-label="Test a purchase">
        <span className="orbit-label">Test a purchase</span>
        <label className="sp-field"><span>Store</span>
          <select value={merchant} onChange={(event) => setMerchant(event.target.value)}>
            {MERCHANTS.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.category}</option>)}
          </select>
        </label>
        <label className="sp-field"><span>Amount</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <button type="submit" className="btn btn-accent" disabled={cardStatus(card, now) === "draft"}><CreditCard aria-hidden="true" /> Charge card</button>
        {fault ? <p className="fault" role="alert">{fault}</p> : null}
      </form>

      {card.transactions.length === 0 ? <p className="muted">No purchases yet. Every charge, approved or declined, shows up here with the reason.</p> : null}
      <ul className="sp-feed">
        {card.transactions.map((tx, index) => (
          <li key={tx.id} className={tx.approved ? "ok" : "no"} style={{ "--i": index } as CSSProperties}>
            <span className="auth-icon" aria-hidden="true">{tx.approved ? <Check /> : <Ban />}</span>
            <span>
              <strong>{tx.merchant}</strong>
              <small>{tx.reason}</small>
              <small>{new Date(tx.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {tx.category}</small>
            </span>
            <b>{formatCents(tx.amountCents)}</b>
            {tx.approved ? (
              tx.refundedCents > 0 ? (
                <span className="pill ok"><Undo2 aria-hidden="true" /> Refunded to {insurer ? "carrier" : "you"}</span>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => onChange(refundTransaction(card, tx.id, new Date(), `sw_${nanoid(8)}`))}>
                  <RotateCcw aria-hidden="true" /> Return
                </button>
              )
            ) : (
              <span className="pill bad"><X aria-hidden="true" /> Declined</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MoneyBack({ card, now, onChange }: { card: SponsorCard; now: Date; onChange: (card: SponsorCard) => void }) {
  const insurer = card.kind === "insurance";
  const active = cardStatus(card, now) === "active";
  const available = availableCents(card);
  return (
    <section className="sp-panel">
      <div className="sp-section-head"><span className="sp-step">{insurer ? "05" : ""}</span><h2>{insurer ? "Settlement" : "Money back to you"}</h2></div>
      <p className="muted sp-note">
        Returns and anything unspent go to <strong>{card.sponsorAccount}</strong>, never back onto the card.
        {active ? ` On ${shortDate(card.expiresAt)}, the ${formatCents(available)} still on the card comes back automatically.` : ""}
      </p>
      {card.sweeps.length > 0 ? (
        <ul className="sp-sweeps">
          {card.sweeps.map((sweep) => (
            <li key={sweep.id}>
              <span className="auth-icon" aria-hidden="true">{sweep.reason === "refund" ? <Undo2 /> : sweep.reason === "expired" ? <Clock /> : <ShieldCheck />}</span>
              <span><strong>{sweep.note}</strong><small>{shortDate(sweep.at)} · to {card.sponsorAccount}</small></span>
              <b>+{formatCents(sweep.amountCents)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {active ? (
        <button type="button" className="btn btn-ghost" onClick={() => onChange(closeOut(card, new Date(), `sw_${nanoid(8)}`, true))}>
          <Ban aria-hidden="true" /> End card now and return {formatCents(available)}
        </button>
      ) : null}
    </section>
  );
}
