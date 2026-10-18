import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { createGroup, editGroup, getGroupState, joinGroup, saveMap, updateSlot } from "@/lib/db/ledger";
import { useDatabaseLedgerForTests } from "@/lib/db/memory-store";
import { pricePoints } from "@/lib/db/schema";
import type { MapData } from "@/lib/types";

const databaseUrl = process.env.DATABASE_URL;

// A remote database takes seconds per locked write, so these get more than the 5s default.
describe.skipIf(!databaseUrl)("ledger against postgres", { timeout: 120_000 }, () => {
  it("serializes joins and keeps price history across map saves", async () => {
    useDatabaseLedgerForTests();
    process.env.ISSUER = "mock";
    const created = await createGroup({ name: "Postgres", prompt: "lamp", budgetCents: 1000 }, { id: "usr_pg", name: "Pg" });
    await Promise.all([
      joinGroup(created.group.id, { id: "usr_pg_1", name: "One" }),
      joinGroup(created.group.id, { id: "usr_pg_2", name: "Two" }),
      joinGroup(created.group.id, { id: "usr_pg_3", name: "Three" }),
      joinGroup(created.group.id, { id: "usr_pg_4", name: "Four" }),
    ]);
    const productId = `pg_lamp_${created.group.id}`;
    await saveMap(created.group.id, priceMap(created.group.id, productId));
    const db = getDb();
    const observedAt = new Date("2026-10-17T18:00:00.000Z");
    await db.insert(pricePoints).values({ productId, priceCents: 100, observedAt });
    await saveMap(created.group.id, priceMap(created.group.id, productId));
    await saveMap(created.group.id, priceMap(created.group.id, productId));
    const rows = await db.select().from(pricePoints).where(eq(pricePoints.productId, productId));
    expect(rows.some((row) => row.observedAt.getTime() === observedAt.getTime())).toBe(true);

    const slots = fourSlots(created.group.id);
    await saveMap(created.group.id, slots);
    await Promise.all(slots.slots.map((slot) => updateSlot(slot.id, { need: `kept-${slot.id}` })));
    const state = await getGroupState(created.group.id);
    expect(state?.members).toHaveLength(5);
    expect(state?.members.filter((member) => member.isOrganizer)).toHaveLength(1);
    expect(state?.map.slots.map((slot) => slot.need).sort()).toEqual(slots.slots.map((slot) => `kept-${slot.id}`).sort());
  });

  it("round-trips checkout store orders, the address, and refunds without a product", async () => {
    useDatabaseLedgerForTests();
    const created = await createGroup({ name: "Postgres checkout", prompt: "lamp", budgetCents: 1000 }, { id: "usr_pg_checkout", name: "Pg" });
    const member = created.members[0];
    if (!member) throw new Error("Organizer missing");
    const updatedAt = "2026-10-18T09:00:00.000Z";
    await editGroup(created.group.id, (state) => {
      state.address = { firstName: "Ada", lastName: "Park", line1: "1 Main St", line2: null, city: "Seattle", state: "WA", postalCode: "98105", phone: "2065550100" };
      state.storeOrders = [
        {
          id: `so_pg_${created.group.id}`,
          groupId: created.group.id,
          store: "Target",
          lane: "zinc",
          status: "placed",
          subtotalCents: 1000,
          capCents: 1100,
          quotedCents: 1000,
          externalId: "zsim_1_x",
          attempt: 1,
          error: null,
          tracking: [{ carrier: "UPS", number: "1ZTEST", url: null }],
          finalTotalCents: 1085,
          updatedAt,
        },
      ];
      state.contributions = [{ id: `con_pg_${created.group.id}`, groupId: created.group.id, memberId: member.id, amountCents: 1100, stripePaymentIntentId: null, status: "paid" }];
      state.refunds = [
        { id: `ref_pg_${created.group.id}`, groupId: created.group.id, productId: null, storeOrderId: `so_pg_${created.group.id}`, memberId: member.id, amountCents: 15, reason: "zinc_held", createdAt: updatedAt },
      ];
    });
    const state = await getGroupState(created.group.id);
    expect(state?.address?.postalCode).toBe("98105");
    expect(state?.storeOrders).toEqual([expect.objectContaining({ lane: "zinc", status: "placed", attempt: 1, finalTotalCents: 1085, updatedAt })]);
    expect(state?.storeOrders[0]?.tracking).toEqual([{ carrier: "UPS", number: "1ZTEST", url: null }]);
    expect(state?.refunds).toEqual([expect.objectContaining({ productId: null, reason: "zinc_held", amountCents: 15 })]);
  });
});

function priceMap(groupId: string, productId: string): MapData {
  return {
    zones: [{ id: `zone_${groupId}`, groupId, name: "Room", sortOrder: 0 }],
    slots: [
      {
        id: `slot_${groupId}`,
        zoneId: `zone_${groupId}`,
        need: "Lamp",
        quantityRule: "per_group",
        quantity: 1,
        budgetCents: 100,
        payType: "shared",
        ownerMemberId: null,
        chosenProductId: productId,
        updatedBy: null,
        updatedAt: "2026-10-17T18:00:00.000Z",
      },
    ],
    products: [
      {
        id: productId,
        slotId: `slot_${groupId}`,
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

function fourSlots(groupId: string): MapData {
  const slots = ["p1", "p2", "p3", "p4"].map((id) => ({
    id: `${groupId}_${id}`,
    zoneId: `zone_${groupId}`,
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
    zones: [{ id: `zone_${groupId}`, groupId, name: "Room", sortOrder: 0 }],
    slots,
    products: [],
    links: [],
    rules: [],
  };
}
