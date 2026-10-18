import { describe, expect, it } from "vitest";
import {
  applyPurchase, availableCents, cardStatus, closeOut, decidePurchase, decodeCard, encodeCard, lineSpentCents, parseDollars, refundTransaction, returnedCents,
  type SponsorCard,
} from "@/lib/sponsor/card";

const now = new Date("2026-10-18T12:00:00.000Z");
const later = new Date("2026-12-01T12:00:00.000Z");

function card(patch: Partial<SponsorCard> = {}): SponsorCard {
  return {
    id: "sc_1", kind: "parent", sponsorName: "Priya", sponsorAccount: "Chase ••4417", recipientName: "Ani", recipientEmail: "ani@example.com",
    amountCents: 50_000, perPurchaseCents: 20_000, categories: ["Furniture", "Bedding"], blockedStores: ["GiftCardz"], lines: [], claim: null,
    expiresAt: "2026-11-30T23:59:00.000Z", createdAt: now.toISOString(), sentAt: now.toISOString(), endedAt: null, last4: "8812", transactions: [], sweeps: [],
    ...patch,
  };
}

describe("decidePurchase", () => {
  it("approves an allowed category under the limits", () => {
    expect(decidePurchase(card(), { merchant: "IKEA", category: "Furniture", amountCents: 12_900 }, now)).toMatchObject({ approved: true });
  });

  it("declines with a readable reason: category, store, per-purchase, balance, unsent, expired", () => {
    expect(decidePurchase(card(), { merchant: "Steam", category: "Gaming", amountCents: 1_000 }, now).reason).toBe("Declined: Gaming isn't an allowed category.");
    expect(decidePurchase(card(), { merchant: "GiftCardz Online", category: "Furniture", amountCents: 1_000 }, now).reason).toContain("blocked");
    expect(decidePurchase(card(), { merchant: "IKEA", category: "Furniture", amountCents: 25_000 }, now).reason).toContain("per-purchase limit");
    expect(decidePurchase(card({ amountCents: 5_000 }), { merchant: "IKEA", category: "Furniture", amountCents: 6_000 }, now).reason).toBe("Declined: only $50.00 is left on the card.");
    expect(decidePurchase(card({ sentAt: null }), { merchant: "IKEA", category: "Furniture", amountCents: 100 }, now).approved).toBe(false);
    expect(decidePurchase(card(), { merchant: "IKEA", category: "Furniture", amountCents: 100 }, later).reason).toContain("expired");
  });

  it("matches insurance purchases to claim lines and caps each line", () => {
    const claim = card({ kind: "insurance", amountCents: 200_000, categories: [], perPurchaseCents: 200_000, lines: [{ id: "l1", label: "Sofa, 3-seat", category: "Furniture", allowanceCents: 120_000 }] });
    const first = applyPurchase(claim, { merchant: "Wayfair", category: "Furniture", amountCents: 100_000 }, now, "t1");
    expect(first.transactions[0]).toMatchObject({ approved: true, lineId: "l1" });
    expect(lineSpentCents(first, "l1")).toBe(100_000);
    expect(decidePurchase(first, { merchant: "Wayfair", category: "Furniture", amountCents: 30_000 }, now).reason).toContain("Sofa, 3-seat");
    expect(decidePurchase(first, { merchant: "Best Buy", category: "Electronics", amountCents: 100 }, now).reason).toContain("nothing on this claim covers");
  });
});

describe("money back to the sponsor", () => {
  it("refunds a return to the sponsor's account, not the card", () => {
    const bought = applyPurchase(card(), { merchant: "IKEA", category: "Furniture", amountCents: 12_900 }, now, "t1");
    expect(availableCents(bought)).toBe(37_100);
    const refunded = refundTransaction(bought, "t1", now, "w1");
    expect(returnedCents(refunded)).toBe(12_900);
    expect(availableCents(refunded)).toBe(37_100);
    expect(refundTransaction(refunded, "t1", now, "w2")).toBe(refunded);
  });

  it("sweeps what's left when the card expires, once", () => {
    const bought = applyPurchase(card(), { merchant: "IKEA", category: "Furniture", amountCents: 12_900 }, now, "t1");
    expect(closeOut(bought, now, "w1")).toBe(bought);
    const expired = closeOut(bought, later, "w1");
    expect(cardStatus(expired, later)).toBe("expired");
    expect(expired.sweeps[0]).toMatchObject({ reason: "expired", amountCents: 37_100 });
    expect(availableCents(expired)).toBe(0);
    expect(closeOut(expired, later, "w2")).toBe(expired);
  });

  it("ends a card early and returns the rest", () => {
    const ended = closeOut(card(), now, "w1", true);
    expect(cardStatus(ended, now)).toBe("ended");
    expect(returnedCents(ended)).toBe(50_000);
  });
});

describe("helpers", () => {
  it("parses dollars to cents without floats", () => {
    expect(parseDollars("$1,250.5")).toBe(125_050);
    expect(parseDollars("19.99")).toBe(1_999);
    expect(parseDollars("500")).toBe(50_000);
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
  });

  it("round-trips a card through the claim link, names and all", () => {
    const original = card({ recipientName: "Zoë" });
    expect(decodeCard(encodeCard(original))).toEqual(original);
    expect(decodeCard("not-a-card")).toBeNull();
  });
});
