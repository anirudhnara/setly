import { describe, expect, it } from "vitest";
import { splitCents } from "@/lib/money/cents";
import { computeRefunds } from "@/lib/money/refunds";
import { computeShares } from "@/lib/money/shares";
import type { Contribution, MapData, Member, MemberShare, Product, Slot } from "@/lib/types";

function member(id: string, joinedAt: string): Member {
  return { id, groupId: "grp", name: id, isOrganizer: id === "a", joinedAt };
}

function slot(id: string, payType: Slot["payType"], chosenProductId: string | null, quantity = 1): Slot {
  return {
    id,
    zoneId: "zone",
    need: id,
    quantityRule: "per_group",
    quantity,
    budgetCents: 0,
    payType,
    ownerMemberId: null,
    chosenProductId,
    updatedBy: null,
    updatedAt: "2026-10-17T18:00:00.000Z",
  };
}

function product(id: string, slotId: string, priceCents: number): Product {
  return {
    id,
    slotId,
    title: id,
    store: "IKEA",
    priceCents,
    url: "https://example.com",
    imageUrl: "https://example.com/image.png",
    attributes: {},
  };
}

function map(slots: Slot[], products: Product[]): MapData {
  return { zones: [], slots, products, links: [], rules: [] };
}

function contribution(memberId: string, amountCents: number, status: Contribution["status"]): Contribution {
  return { id: `con_${memberId}`, groupId: "grp", memberId, amountCents, stripePaymentIntentId: null, status };
}

describe("splitCents", () => {
  it("gives leftover cents to the largest weights and breaks ties toward earlier indexes", () => {
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitCents(10, [1, 5, 1])).toEqual([1, 8, 1]);
  });
});

describe("computeShares", () => {
  const members = [member("a", "2026-10-17T18:00:00.000Z"), member("b", "2026-10-17T18:01:00.000Z"), member("c", "2026-10-17T18:02:00.000Z")];

  it("splits a shared slot evenly across every member", () => {
    const shares = computeShares(map([slot("sofa", "shared", "sofa")], [product("sofa", "sofa", 90)]), members);
    expect(shares.map((share) => share.lines[0]?.cents)).toEqual([30, 30, 30]);
  });

  it("gives leftover cents one each to the earliest members by join order", () => {
    const shares = computeShares(map([slot("lamp", "shared", "lamp")], [product("lamp", "lamp", 100)]), members);
    expect(shares.map((share) => share.totalCents)).toEqual([34, 33, 33]);
  });

  it("returns shares whose lines and totals sum to the exact charged amount", () => {
    const shares = computeShares(
      map(
        [slot("lamp", "shared", "lamp"), slot("mug", "per_person", "mug", 2)],
        [product("lamp", "lamp", 100), product("mug", "mug", 10)],
      ),
      members,
    );
    const lineSum = shares.reduce((sum, share) => sum + share.lines.reduce((lineTotal, line) => lineTotal + line.cents, 0), 0);
    const total = shares.reduce((sum, share) => sum + share.totalCents, 0);
    expect(lineSum).toBe(100 + 20 * members.length);
    expect(total).toBe(lineSum);
  });

  it("charges each member their own item for a per-person slot", () => {
    const shares = computeShares(map([slot("mug", "per_person", "mug", 2)], [product("mug", "mug", 10)]), members.slice(0, 2));
    expect(shares.map((share) => share.totalCents)).toEqual([20, 20]);
  });

  it("charges nothing for an already-owned slot", () => {
    const shares = computeShares(map([slot("rug", "already_owned", "rug")], [product("rug", "rug", 4000)]), members);
    expect(shares.every((share) => share.totalCents === 0 && share.lines.length === 0)).toBe(true);
  });

  it("charges nothing when a slot has no chosen product", () => {
    const shares = computeShares(map([slot("desk", "shared", null)], []), members);
    expect(shares.every((share) => share.totalCents === 0)).toBe(true);
  });
});

describe("computeRefunds", () => {
  const products = [{ id: "lamp", slotId: "lamp" }];
  const shares: MemberShare[] = [
    { memberId: "a", totalCents: 60, lines: [{ slotId: "lamp", cents: 60 }] },
    { memberId: "b", totalCents: 30, lines: [{ slotId: "lamp", cents: 30 }] },
    { memberId: "c", totalCents: 10, lines: [{ slotId: "lamp", cents: 10 }] },
  ];
  const contributions = [contribution("a", 60, "paid"), contribution("b", 30, "paid"), contribution("c", 10, "pending")];

  it("refunds only the members who paid for that item", () => {
    const refunds = computeRefunds("lamp", contributions, shares, products);
    expect(refunds.map((refund) => refund.memberId)).toEqual(["a", "b"]);
  });

  it("splits the refund in proportion to what each payer paid for the item", () => {
    const refunds = computeRefunds("lamp", contributions, shares, products);
    expect(refunds.map((refund) => refund.amountCents)).toEqual([60, 30]);
  });

  it("gives nothing to a member who did not pay for the item", () => {
    const refunds = computeRefunds("lamp", contributions, shares, products);
    expect(refunds.some((refund) => refund.memberId === "c")).toBe(false);
  });

  it("returns integer cents that sum to the amount those payers put toward the item", () => {
    const refunds = computeRefunds("lamp", contributions, shares, products);
    expect(refunds.every((refund) => Number.isInteger(refund.amountCents))).toBe(true);
    expect(refunds.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(90);
  });
});
