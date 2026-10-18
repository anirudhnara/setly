/**
 * Sponsored cards: a parent (or an insurer) funds a card for someone else, decides what it can buy, watches it
 * being spent, and gets back whatever isn't used. All money is integer cents. Pure: no storage, no network.
 */
export type SponsorKind = "parent" | "insurance";

export interface ClaimLine {
  id: string;
  label: string;
  category: string;
  /** Replacement cost allowed for this line. */
  allowanceCents: number;
}

export interface ClaimInfo {
  number: string;
  policy: string;
  adjuster: string;
  peril: string;
  dateOfLoss: string;
}

export interface SponsorTransaction {
  id: string;
  at: string;
  merchant: string;
  category: string;
  amountCents: number;
  approved: boolean;
  reason: string;
  lineId: string | null;
  refundedCents: number;
}

/** Money going back to the sponsor's own account. */
export interface Sweep {
  id: string;
  at: string;
  amountCents: number;
  reason: "refund" | "expired" | "ended";
  note: string;
}

export interface SponsorCard {
  id: string;
  kind: SponsorKind;
  sponsorName: string;
  /** Where returned money lands ("Chase checking ••4417"). */
  sponsorAccount: string;
  recipientName: string;
  recipientEmail: string;
  amountCents: number;
  perPurchaseCents: number;
  /** Allowed categories. Empty means any category not blocked. */
  categories: string[];
  blockedStores: string[];
  lines: ClaimLine[];
  claim: ClaimInfo | null;
  expiresAt: string;
  createdAt: string;
  sentAt: string | null;
  endedAt: string | null;
  last4: string;
  transactions: SponsorTransaction[];
  sweeps: Sweep[];
}

export type CardStatus = "draft" | "active" | "expired" | "ended";

export function cardStatus(card: SponsorCard, now: Date): CardStatus {
  if (card.endedAt) return "ended";
  if (!card.sentAt) return "draft";
  return now.getTime() >= Date.parse(card.expiresAt) ? "expired" : "active";
}

export function spentCents(card: SponsorCard) {
  return card.transactions.filter((tx) => tx.approved).reduce((sum, tx) => sum + tx.amountCents, 0);
}

export function returnedCents(card: SponsorCard) {
  return card.sweeps.reduce((sum, sweep) => sum + sweep.amountCents, 0);
}

/** What the card can still spend. Refunds go back to the sponsor, not onto the card. */
export function availableCents(card: SponsorCard) {
  const closed = card.sweeps.filter((sweep) => sweep.reason !== "refund").reduce((sum, sweep) => sum + sweep.amountCents, 0);
  return Math.max(0, card.amountCents - spentCents(card) - closed);
}

export function lineSpentCents(card: SponsorCard, lineId: string) {
  return card.transactions.filter((tx) => tx.approved && tx.lineId === lineId).reduce((sum, tx) => sum + tx.amountCents - tx.refundedCents, 0);
}

export interface Purchase {
  merchant: string;
  category: string;
  amountCents: number;
}

export interface Decision {
  approved: boolean;
  reason: string;
  lineId: string | null;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whether the card may make this purchase now, with a reason a person can read either way. */
export function decidePurchase(card: SponsorCard, purchase: Purchase, now: Date): Decision {
  const status = cardStatus(card, now);
  const no = (reason: string): Decision => ({ approved: false, reason, lineId: null });
  if (status === "draft") return no("Declined: the card hasn't been sent yet.");
  if (status === "expired") return no(`Declined: the card expired ${new Date(card.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`);
  if (status === "ended") return no("Declined: the card was ended.");
  if (purchase.amountCents <= 0) return no("Declined: nothing to charge.");
  const store = purchase.merchant.trim().toLowerCase();
  const blocked = card.blockedStores.find((name) => store.includes(name.trim().toLowerCase()));
  if (blocked) return no(`Declined: ${purchase.merchant} is blocked on this card.`);
  if (card.categories.length > 0 && !card.categories.includes(purchase.category)) return no(`Declined: ${purchase.category} isn't an allowed category.`);
  if (purchase.amountCents > card.perPurchaseCents) return no(`Declined: ${money(purchase.amountCents)} is over the ${money(card.perPurchaseCents)} per-purchase limit.`);
  let lineId: string | null = null;
  if (card.lines.length > 0) {
    const line = card.lines.find((item) => item.category === purchase.category && lineSpentCents(card, item.id) + purchase.amountCents <= item.allowanceCents);
    if (!line) {
      const open = card.lines.find((item) => item.category === purchase.category);
      return no(open ? `Declined: over what's left on the "${open.label}" claim line.` : `Declined: nothing on this claim covers ${purchase.category}.`);
    }
    lineId = line.id;
  }
  const left = availableCents(card);
  if (purchase.amountCents > left) return no(`Declined: only ${money(left)} is left on the card.`);
  const line = card.lines.find((item) => item.id === lineId);
  return { approved: true, reason: line ? `Approved: matches claim line "${line.label}".` : `Approved: ${purchase.category} at ${purchase.merchant} is within the limits.`, lineId };
}

export function applyPurchase(card: SponsorCard, purchase: Purchase, now: Date, id: string): SponsorCard {
  const decision = decidePurchase(card, purchase, now);
  const tx: SponsorTransaction = { id, at: now.toISOString(), ...purchase, approved: decision.approved, reason: decision.reason, lineId: decision.lineId, refundedCents: 0 };
  return { ...card, transactions: [tx, ...card.transactions] };
}

/** A returned purchase refunds the sponsor's account, never the card. */
export function refundTransaction(card: SponsorCard, txId: string, now: Date, id: string): SponsorCard {
  const tx = card.transactions.find((item) => item.id === txId);
  if (!tx || !tx.approved) return card;
  const amount = tx.amountCents - tx.refundedCents;
  if (amount <= 0) return card;
  return {
    ...card,
    transactions: card.transactions.map((item) => (item.id === txId ? { ...item, refundedCents: item.amountCents } : item)),
    sweeps: [{ id, at: now.toISOString(), amountCents: amount, reason: "refund", note: `${tx.merchant} return` }, ...card.sweeps],
  };
}

/** Sweeps what's left back to the sponsor once the card expires, or when they end it early. Runs once. */
export function closeOut(card: SponsorCard, now: Date, id: string, end = false): SponsorCard {
  const status = cardStatus(card, now);
  if (!end && status !== "expired") return card;
  if (card.sweeps.some((sweep) => sweep.reason === "expired" || sweep.reason === "ended")) return end && !card.endedAt ? { ...card, endedAt: now.toISOString() } : card;
  const left = availableCents(card);
  const next = end ? { ...card, endedAt: now.toISOString() } : card;
  if (left <= 0) return next;
  const reason = end ? "ended" : "expired";
  return { ...next, sweeps: [{ id, at: now.toISOString(), amountCents: left, reason, note: end ? "Card ended early" : "Card expired" }, ...next.sweeps] };
}

/** "$1,250.50" or "1250.5" → 125050 cents, without floating point. Null when it isn't a money amount. */
export function parseDollars(text: string): number | null {
  const match = text.replace(/[$,\s]/g, "").match(/^(\d{1,7})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

/** The claim link carries the card itself, so the recipient sees it on any device. */
export function encodeCard(card: SponsorCard): string {
  const bytes = new TextEncoder().encode(JSON.stringify(card));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCard(token: string): SponsorCard | null {
  try {
    const binary = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!value || typeof value !== "object") return null;
    const card = value as Partial<SponsorCard>;
    if (typeof card.id !== "string" || (card.kind !== "parent" && card.kind !== "insurance") || typeof card.amountCents !== "number" || !Number.isInteger(card.amountCents)) return null;
    if (!Array.isArray(card.transactions) || !Array.isArray(card.sweeps) || !Array.isArray(card.categories) || !Array.isArray(card.lines)) return null;
    return card as SponsorCard;
  } catch {
    return null;
  }
}
