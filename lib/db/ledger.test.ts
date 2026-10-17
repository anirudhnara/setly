import { beforeEach, describe, expect, it } from "vitest";
import {
  LedgerError,
  createGroup,
  getGroupState,
  joinGroup,
  lockGroup,
  recordContribution,
  resetLedgerForTests,
  returnItem,
  runCheckout,
  saveMap,
  updateSlot,
} from "@/lib/db/ledger";
import type { MapData } from "@/lib/types";

beforeEach(() => {
  process.env.ISSUER = "mock";
  resetLedgerForTests();
});

describe("ledger", () => {
  it("keeps the seeded apartment totals", async () => {
    const state = await getGroupState("grp_apartment");
    expect(state?.fundedCents).toBe(52384);
    expect(state?.totalCents).toBe(104759);
  });

  it("funds a plan, checks the card, and refunds to the cent", async () => {
    const created = await createGroup({ name: "Room", prompt: "lamp", budgetCents: 1000 });
    const first = await joinGroup(created.group.id, "A");
    const second = await joinGroup(created.group.id, "B");
    const third = await joinGroup(created.group.id, "C");
    const members = [first.member, second.member, third.member];
    await saveMap(created.group.id, lampMap(created.group.id));
    const locked = await lockGroup(created.group.id, first.member.id);
    expect(locked.group.status).toBe("funding");
    expect(locked.shares.reduce((sum, share) => sum + share.totalCents, 0)).toBe(100);
    expect(locked.card).toBeNull();

    const firstShare = locked.shares.find((share) => share.memberId === first.member.id);
    await expect(updateSlot("lamp", { need: "Lamp shade" })).rejects.toBeInstanceOf(LedgerError);
    await expect(recordContribution({
      groupId: created.group.id,
      memberId: first.member.id,
      amountCents: (firstShare?.totalCents ?? 0) + 1,
      status: "paid",
      stripePaymentIntentId: null,
    })).rejects.toThrow(/Share is/);

    for (const member of members) {
      const share = locked.shares.find((item) => item.memberId === member.id);
      await recordContribution({
        groupId: created.group.id,
        memberId: member.id,
        amountCents: share?.totalCents ?? 0,
        status: "paid",
        stripePaymentIntentId: null,
      });
    }
    const funded = await getGroupState(created.group.id);
    expect(funded?.group.status).toBe("active");
    expect(funded?.card?.status).toBe("active");
    expect(funded?.fundedCents).toBe(100);

    const again = await recordContribution({
      groupId: created.group.id,
      memberId: first.member.id,
      amountCents: firstShare?.totalCents ?? 0,
      status: "paid",
      stripePaymentIntentId: null,
    });
    expect(again.created).toBe(false);
    const afterAgain = await getGroupState(created.group.id);
    expect(afterAgain?.contributions.filter((contribution) => contribution.memberId === first.member.id)).toHaveLength(1);

    const checkout = await runCheckout(created.group.id);
    expect(checkout.authorizations.map((authorization) => authorization.approved)).toEqual([true, false]);
    expect(checkout.authorizations[1]?.reason).toContain("GiftCardz is not in this plan");
    const replay = await runCheckout(created.group.id);
    expect(replay.authorizations).toHaveLength(2);

    const returned = await returnItem(created.group.id, "lamp");
    expect(returned.created).toBe(true);
    expect(returned.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(100);
    const repeat = await returnItem(created.group.id, "lamp");
    expect(repeat.created).toBe(false);
    expect(repeat.refunds.map((refund) => refund.id)).toEqual(returned.refunds.map((refund) => refund.id));
    const settled = await getGroupState(created.group.id);
    expect(settled?.group.status).toBe("settled");
    expect(settled?.fundedCents).toBe(100);
    expect(settled?.storeLimits[0]?.spentCents).toBe(100);
  });
});

function lampMap(groupId: string): MapData {
  return {
    zones: [{ id: "zone", groupId, name: "Room", sortOrder: 0 }],
    slots: [
      {
        id: "lamp",
        zoneId: "zone",
        need: "Lamp",
        quantityRule: "per_group",
        quantity: 1,
        budgetCents: 100,
        payType: "shared",
        ownerMemberId: null,
        chosenProductId: "lamp",
        updatedBy: null,
        updatedAt: "2026-10-17T18:00:00.000Z",
      },
    ],
    products: [
      {
        id: "lamp",
        slotId: "lamp",
        title: "Lamp",
        store: "IKEA",
        priceCents: 100,
        url: "https://example.com/lamp",
        imageUrl: "https://example.com/lamp.png",
        attributes: {},
      },
    ],
    links: [],
    rules: [],
  };
}
