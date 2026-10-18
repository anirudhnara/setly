import { describe, expect, it } from "vitest";
import { splitCents } from "@/lib/money/cents";
import { computeRefunds } from "@/lib/money/refunds";
import { bufferCents, capCents, storeSubtotals, ZINC_FEE_CENTS } from "@/lib/money/buffer";
import { contributionsByStore, leftoverRefunds } from "@/lib/money/leftover";
import { computeShares } from "@/lib/money/shares";
import { storeLimitInputs } from "@/lib/payments/limits";
import type { CheckoutLaneName, Contribution, MapData, Member, MemberShare, Product, Slot, StoreOrder } from "@/lib/types";

function member(id: string, joinedAt: string): Member {
  return { id, groupId: "grp", userId: id, name: id, isOrganizer: id === "a", joinedAt };
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

function product(id: string, slotId: string, priceCents: number, store = "IKEA"): Product {
  return {
    id,
    slotId,
    title: id,
    store,
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
    { memberId: "a", totalCents: 60, lines: [{ kind: "item", slotId: "lamp", store: "IKEA", cents: 60 }] },
    { memberId: "b", totalCents: 30, lines: [{ kind: "item", slotId: "lamp", store: "IKEA", cents: 30 }] },
    { memberId: "c", totalCents: 10, lines: [{ kind: "item", slotId: "lamp", store: "IKEA", cents: 10 }] },
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

const lanes: Record<string, CheckoutLaneName> = { "Fernwood Home": "protocol", Target: "zinc", IKEA: "guided" };
const laneOf = (store: string) => lanes[store] ?? "guided";

function order(store: string, patch: Partial<StoreOrder>): StoreOrder {
  return {
    id: `so_${store}`,
    groupId: "grp",
    store,
    lane: laneOf(store),
    status: "placed",
    subtotalCents: 0,
    capCents: 0,
    quotedCents: null,
    externalId: null,
    attempt: 0,
    error: null,
    tracking: [],
    finalTotalCents: null,
    updatedAt: "2026-10-18T07:00:00.000Z",
    ...patch,
  };
}

describe("buffer", () => {
  it("is 10% rounded up to the cent", () => {
    expect(bufferCents(0)).toBe(0);
    expect(bufferCents(1000)).toBe(100);
    expect(bufferCents(1001)).toBe(101);
    expect(bufferCents(1)).toBe(1);
    expect(capCents(54900)).toBe(60390);
  });

  it("totals each store, counting per-person slots once per member", () => {
    const members = [member("a", "1"), member("b", "2")];
    const totals = storeSubtotals(
      map([slot("sofa", "shared", "sofa"), slot("mug", "per_person", "mug", 2)], [product("sofa", "sofa", 500, "Fernwood Home"), product("mug", "mug", 10, "Target")]),
      members,
    );
    expect(totals).toEqual([{ store: "Fernwood Home", subtotalCents: 500 }, { store: "Target", subtotalCents: 40 }]);
  });
});

describe("computeShares with checkout buffers", () => {
  const members = [member("a", "1"), member("b", "2"), member("c", "3")];
  const plan = map(
    [slot("sofa", "shared", "sofa"), slot("rug", "shared", "rug"), slot("lamp", "shared", "lamp"), slot("mug", "per_person", "mug")],
    [product("sofa", "sofa", 1001, "Fernwood Home"), product("rug", "rug", 333, "Target"), product("lamp", "lamp", 101, "IKEA"), product("mug", "mug", 7, "Target")],
  );

  it("sums exactly to items plus every store's buffer plus one fee per Zinc store", () => {
    const shares = computeShares(plan, members, laneOf);
    const total = shares.reduce((sum, share) => sum + share.totalCents, 0);
    const subtotals = storeSubtotals(plan, members);
    const expected = subtotals.reduce((sum, row) => sum + capCents(row.subtotalCents), 0) + ZINC_FEE_CENTS;
    expect(total).toBe(expected);
    for (const share of shares) expect(share.totalCents).toBe(share.lines.reduce((sum, line) => sum + line.cents, 0));
  });

  it("splits odd cents three ways with leftovers to the earliest members", () => {
    const shares = computeShares(plan, members, laneOf);
    const buffers = shares.map((share) => share.lines.find((line) => line.kind === "buffer" && line.store === "Fernwood Home")?.cents);
    // 1001 → 334/334/333 items; buffer 101 → 34/34/33.
    expect(buffers).toEqual([34, 34, 33]);
    const fees = shares.map((share) => share.lines.find((line) => line.kind === "zinc_fee")?.cents);
    expect(fees).toEqual([34, 33, 33]);
    expect(shares.flatMap((share) => share.lines).filter((line) => line.kind !== "item").every((line) => line.slotId === null)).toBe(true);
  });

  it("puts caps on the card for protocol and guided stores, and nothing for Zinc", () => {
    expect(storeLimitInputs(plan, members, laneOf)).toEqual([
      { store: "Fernwood Home", limitCents: capCents(1001) },
      { store: "IKEA", limitCents: capCents(101) },
    ]);
  });
});

describe("leftoverRefunds", () => {
  const members = [member("a", "1"), member("b", "2"), member("c", "3")];
  const plan = map(
    [slot("sofa", "shared", "sofa"), slot("rug", "shared", "rug")],
    [product("sofa", "sofa", 1001, "Fernwood Home"), product("rug", "rug", 333, "Target")],
  );
  const shares = computeShares(plan, members, laneOf);
  const paid = shares.map((share) => contribution(share.memberId, share.totalCents, "paid"));
  const byStore = contributionsByStore(shares, paid);

  it("refunds cap minus final total, split by what each member paid that store", () => {
    const refunds = leftoverRefunds(
      [order("Fernwood Home", { capCents: capCents(1001), finalTotalCents: 1050 }), order("Target", { capCents: capCents(333), finalTotalCents: 361 })],
      byStore,
    );
    const fernwood = refunds.filter((refund) => refund.storeOrderId === "so_Fernwood Home");
    expect(fernwood.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(capCents(1001) - 1050);
    expect(fernwood.map((refund) => refund.amountCents)).toEqual([18, 17, 17]);
    expect(fernwood.every((refund) => refund.reason === "leftover_buffer")).toBe(true);
    const target = refunds.filter((refund) => refund.storeOrderId === "so_Target");
    expect(target.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(capCents(333) - 361);
    expect(target.every((refund) => refund.reason === "zinc_held")).toBe(true);
    expect(refunds.every((refund) => Number.isInteger(refund.amountCents) && refund.productId === null)).toBe(true);
  });

  it("refunds a failed store in full, including the Zinc fee", () => {
    const refunds = leftoverRefunds(
      [order("Fernwood Home", { capCents: capCents(1001), finalTotalCents: capCents(1001) }), order("Target", { status: "failed", capCents: capCents(333) })],
      byStore,
    );
    expect(refunds.every((refund) => refund.reason === "store_failed")).toBe(true);
    expect(refunds.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(capCents(333) + ZINC_FEE_CENTS);
  });

  it("takes an approved overrun out of the other stores' leftovers", () => {
    const refunds = leftoverRefunds(
      [
        order("Fernwood Home", { capCents: capCents(1001), finalTotalCents: 1001 }),
        order("Target", { capCents: capCents(333) + 20, finalTotalCents: capCents(333) + 20 }),
      ],
      byStore,
    );
    expect(refunds.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(bufferCents(1001) - 20);
  });

  it("gives the same ids when settled twice", () => {
    const orders = [order("Fernwood Home", { capCents: capCents(1001), finalTotalCents: 1001 })];
    expect(leftoverRefunds(orders, byStore).map((refund) => refund.id)).toEqual(leftoverRefunds(orders, byStore).map((refund) => refund.id));
  });
});
