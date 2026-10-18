import { describe, expect, it } from "vitest";
import { guidedLane } from "@/lib/checkout/guided";
import type { LaneOrder } from "@/lib/checkout/lane";

const order: LaneOrder = {
  order: { id: "so_ikea", groupId: "grp", store: "IKEA", lane: "guided", status: "placing", subtotalCents: 2000, capCents: 2200, quotedCents: 2000, externalId: null, attempt: 0, error: null, tracking: [], finalTotalCents: null, updatedAt: "2026-10-18T09:00:00.000Z" },
  items: [{ product: { id: "p", slotId: "s", title: "Mugs", store: "IKEA", priceCents: 500, url: "https://www.ikea.com/us/en/p/mugs", imageUrl: "", attributes: {} }, quantity: 4 }],
  address: { firstName: "Ada", lastName: "Park", line1: "1 Main St", line2: null, city: "Seattle", state: "WA", postalCode: "98105", phone: "2065550100" },
  cardId: "card_1",
  authorizations: [],
  now: new Date("2026-10-18T09:00:00.000Z"),
};

describe("guided lane", () => {
  it("links to the store and counts as placed once the card is charged there", async () => {
    expect(await guidedLane.quote(order)).toEqual({ quotedCents: 2000, externalId: null });
    expect((await guidedLane.place(order)).externalId).toBe("https://www.ikea.com/us/en/p/mugs");
    expect((await guidedLane.status(order)).status).toBe("placing");
    const charged = { ...order, authorizations: [{ id: "a", cardId: "card_1", merchant: "IKEA Seattle", amountCents: 2150, approved: true, reason: "", createdAt: "" }] };
    expect(await guidedLane.status(charged)).toMatchObject({ status: "placed", finalTotalCents: 2150 });
  });
});
