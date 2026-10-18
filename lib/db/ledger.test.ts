import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LedgerError,
  createGroup,
  getGroupState,
  joinGroup,
  lockGroup,
  markPaidByCheckoutSession,
  recordContribution,
  replacePendingCheckoutSession,
  resetLedgerForTests,
  returnItem,
  runCheckout,
  saveMap,
  updateSlot,
} from "@/lib/db/ledger";
import { capCents } from "@/lib/money/buffer";
import { setIssuerForTests } from "@/lib/payments";
import { mockIssuer } from "@/lib/payments/mock-issuer";
import type { MapData, Rule } from "@/lib/types";

vi.mock("@/lib/search/options", () => ({
  findSlotOption: async (slotId: string, productId: string) =>
    productId === "lamp_big"
      ? { id: productId, slotId, title: "Big lamp", store: "Fernwood Home", priceCents: 900_00, url: "https://example.com/big", imageUrl: "https://example.com/big.png", attributes: {} }
      : null,
}));

beforeEach(() => {
  process.env.ISSUER = "mock";
  setIssuerForTests(null);
  resetLedgerForTests();
});

describe("ledger", () => {
  it("keeps the seeded apartment totals", async () => {
    const state = await getGroupState("grp_apartment");
    expect(state?.fundedCents).toBe(52384);
    expect(state?.totalCents).toBe(104759);
  });

  it("funds a plan, checks the card, and refunds to the cent", async () => {
    const userA = { id: "usr_a", name: "A" };
    const created = await createGroup({ name: "Room", prompt: "lamp", budgetCents: 1000 }, userA);
    const organizer = created.members[0];
    if (!organizer) throw new Error("Organizer missing");
    const second = await joinGroup(created.group.id, { id: "usr_b", name: "B" });
    const third = await joinGroup(created.group.id, { id: "usr_c", name: "C" });
    const rejoined = await joinGroup(created.group.id, { id: "usr_b", name: "B" });
    expect(rejoined.member.id).toBe(second.member.id);
    expect(second.member.isOrganizer).toBe(false);
    const members = [organizer, second.member, third.member];
    await saveMap(created.group.id, lampMap(created.group.id));
    await expect(lockGroup(created.group.id, "usr_b")).rejects.toMatchObject({ status: 403 });
    const locked = await lockGroup(created.group.id, userA.id);
    expect(locked.group.status).toBe("funding");
    // $1.00 lamp at IKEA (guided) plus the 10% buffer.
    expect(locked.shares.reduce((sum, share) => sum + share.totalCents, 0)).toBe(110);
    expect(locked.card).toBeNull();

    const firstShare = locked.shares.find((share) => share.memberId === organizer.id);
    await expect(updateSlot("lamp", { need: "Lamp shade" })).rejects.toBeInstanceOf(LedgerError);
    await expect(recordContribution({
      groupId: created.group.id,
      memberId: organizer.id,
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
    expect(funded?.fundedCents).toBe(110);
    expect(funded?.storeLimits).toMatchObject([{ store: "IKEA", limitCents: 110 }]);

    const again = await recordContribution({
      groupId: created.group.id,
      memberId: organizer.id,
      amountCents: firstShare?.totalCents ?? 0,
      status: "paid",
      stripePaymentIntentId: null,
    });
    expect(again.created).toBe(false);
    const afterAgain = await getGroupState(created.group.id);
    expect(afterAgain?.contributions.filter((contribution) => contribution.memberId === organizer.id)).toHaveLength(1);

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
    expect(settled?.fundedCents).toBe(110);
    expect(settled?.storeLimits[0]?.spentCents).toBe(110);
  });

  it("marks a hosted Checkout payment paid only for its matching member and amount", async () => {
    const created = await createGroup({ name: "Room", prompt: "lamp", budgetCents: 1000 }, { id: "usr_pay", name: "Pay" });
    const member = created.members[0];
    if (!member) throw new Error("Organizer missing");
    await saveMap(created.group.id, lampMap(created.group.id));
    const locked = await lockGroup(created.group.id, "usr_pay");
    const amountCents = locked.shares[0]?.totalCents ?? 0;
    await recordContribution({
      groupId: created.group.id,
      memberId: member.id,
      amountCents,
      status: "pending",
      stripePaymentIntentId: "cs_test_session",
    });

    await expect(markPaidByCheckoutSession({
      sessionId: "cs_test_session",
      paymentIntentId: "pi_test_payment",
      groupId: created.group.id,
      memberId: member.id,
      amountCents: amountCents + 1,
    })).resolves.toBeNull();

    const replaced = await replacePendingCheckoutSession({
      groupId: created.group.id,
      memberId: member.id,
      amountCents,
      previousReference: "cs_test_session",
      sessionId: "cs_test_retry",
    });
    expect(replaced.contribution.stripePaymentIntentId).toBe("cs_test_retry");

    const paid = await markPaidByCheckoutSession({
      sessionId: "cs_test_retry",
      paymentIntentId: "pi_test_payment",
      groupId: created.group.id,
      memberId: member.id,
      amountCents,
    });
    expect(paid?.contributions[0]).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_test_payment" });
    expect(paid?.card?.status).toBe("active");

  });

  it("serializes parallel joins and slot edits", async () => {
    const created = await createGroup({ name: "Room", prompt: "shared", budgetCents: 1000 }, { id: "usr_org", name: "Org" });
    await Promise.all([
      joinGroup(created.group.id, { id: "usr_1", name: "One" }),
      joinGroup(created.group.id, { id: "usr_2", name: "Two" }),
      joinGroup(created.group.id, { id: "usr_3", name: "Three" }),
      joinGroup(created.group.id, { id: "usr_4", name: "Four" }),
    ]);
    await saveMap(created.group.id, lampMap(created.group.id, 102));
    const state = await getGroupState(created.group.id);
    expect(state?.members).toHaveLength(5);
    expect(state?.members.filter((member) => member.isOrganizer)).toHaveLength(1);
    expect(state?.shares.reduce((sum, share) => sum + share.totalCents, 0)).toBe(102 + 11);
    const ordered = [...(state?.members ?? [])].sort((left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.id.localeCompare(right.id));
    const itemCents = (memberId: string) =>
      state?.shares.find((share) => share.memberId === memberId)?.lines.filter((line) => line.kind === "item").reduce((sum, line) => sum + line.cents, 0) ?? 0;
    const amounts = ordered.map((member) => itemCents(member.id));
    expect(amounts).toEqual([21, 21, 20, 20, 20]);

    const slots = fourSlotMap(created.group.id);
    await saveMap(created.group.id, slots);
    await Promise.all(slots.slots.map((slot) => updateSlot(slot.id, { need: `kept-${slot.id}` })));
    const after = await getGroupState(created.group.id);
    expect(after?.map.slots.map((slot) => slot.need).sort()).toEqual(["kept-s1", "kept-s2", "kept-s3", "kept-s4"]);
  });

  it("refreshes budget rules on save and slot edits", async () => {
    const created = await createGroup({ name: "Room", prompt: "budget", budgetCents: 1000 }, { id: "usr_org", name: "Org" });
    const over = await saveMap(created.group.id, lampMap(created.group.id, 100, budgetRule(created.group.id, 50)));
    expect(over.map.rules[0]?.status).toBe("broken");
    expect(over.map.zones[0]?.groupId).toBe(created.group.id);
    expect(over.map.rules[0]?.groupId).toBe(created.group.id);

    const under = await saveMap(created.group.id, lampMap(created.group.id, 40, budgetRule(created.group.id, 50)));
    expect(under.map.rules[0]?.status).toBe("ok");
    const raised = await updateSlot("lamp", { quantity: 2 });
    expect(raised.quantity).toBe(2);
    const broken = await getGroupState(created.group.id);
    expect(broken?.map.rules[0]?.status).toBe("broken");
    await updateSlot("lamp", { quantity: 1 });
    const restored = await getGroupState(created.group.id);
    expect(restored?.map.rules[0]?.status).toBe("ok");
  });

  it("saves a swapped-in option so the shares charge its price", async () => {
    const created = await createGroup({ name: "Room", prompt: "swap", budgetCents: 0 }, { id: "usr_org", name: "Org" });
    const before = await saveMap(created.group.id, lampMap(created.group.id, 100));
    await updateSlot("lamp", { chosenProductId: "lamp_big" });
    const after = await getGroupState(created.group.id);
    expect(after?.map.products.map((product) => product.id)).toEqual(["lamp_big"]);
    expect((after?.totalCents ?? 0) - before.totalCents).toBe(capCents(900_00) - capCents(100));
    await expect(updateSlot("lamp", { chosenProductId: "made_up" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a lock while a budget rule is broken", async () => {
    const created = await createGroup({ name: "Room", prompt: "budget", budgetCents: 1000 }, { id: "usr_org", name: "Org" });
    const saved = await saveMap(created.group.id, lampMap(created.group.id, 100, budgetRule(created.group.id, 50)));
    const message = saved.map.rules[0]?.message ?? "";
    await expect(lockGroup(created.group.id, "usr_org")).rejects.toMatchObject({ status: 409, message });
    const state = await getGroupState(created.group.id);
    expect(state?.group.status).toBe("editing");
  });

  it("activates the group with a mock card when issuing throws", async () => {
    setIssuerForTests({
      ...mockIssuer,
      async createCard() {
        throw new Error("Issuing is not enabled");
      },
    });
    const created = await createGroup({ name: "Room", prompt: "lamp", budgetCents: 1000 }, { id: "usr_a", name: "A" });
    const organizer = created.members[0];
    if (!organizer) throw new Error("Organizer missing");
    await saveMap(created.group.id, lampMap(created.group.id));
    const locked = await lockGroup(created.group.id, "usr_a");
    await recordContribution({
      groupId: created.group.id,
      memberId: organizer.id,
      amountCents: locked.shares[0]?.totalCents ?? 0,
      status: "paid",
      stripePaymentIntentId: null,
    });
    const funded = await getGroupState(created.group.id);
    expect(funded?.group.status).toBe("active");
    expect(funded?.card).not.toBeNull();
    expect(funded?.card?.status).toBe("active");
  });
});

function budgetRule(groupId: string, maxCents: number): Rule[] {
  return [
    {
      id: "rule_budget",
      groupId,
      type: "budget",
      slotIds: [],
      params: { maxCents },
      status: "not_checked",
      message: "",
    },
  ];
}

function lampMap(_groupId: string, priceCents = 100, rules: Rule[] = []): MapData {
  return {
    zones: [{ id: "zone", groupId: "other-group", name: "Room", sortOrder: 0 }],
    slots: [
      {
        id: "lamp",
        zoneId: "zone",
        need: "Lamp",
        quantityRule: "per_group",
        quantity: 1,
        budgetCents: priceCents,
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
        priceCents,
        url: "https://example.com/lamp",
        imageUrl: "https://example.com/lamp.png",
        attributes: {},
      },
    ],
    links: [],
    rules: rules.map((rule) => ({ ...rule, groupId: "other-group" })),
  };
}

function fourSlotMap(groupId: string): MapData {
  const slots = ["s1", "s2", "s3", "s4"].map((id) => ({
    id,
    zoneId: "zone",
    need: id,
    quantityRule: "per_group" as const,
    quantity: 1,
    budgetCents: 10,
    payType: "already_owned" as const,
    ownerMemberId: null,
    chosenProductId: null,
    updatedBy: null,
    updatedAt: "2026-10-17T18:00:00.000Z",
  }));
  return {
    zones: [{ id: "zone", groupId, name: "Room", sortOrder: 0 }],
    slots,
    products: [],
    links: [],
    rules: [],
  };
}

