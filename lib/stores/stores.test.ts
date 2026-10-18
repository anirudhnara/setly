import { beforeEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/stores/[slug]/checkout_sessions/route";
import { createGroup, lockGroup, recordContribution, resetLedgerForTests, saveMap } from "@/lib/db/ledger";
import { capCents } from "@/lib/money/buffer";
import { setIssuerForTests } from "@/lib/payments";
import { demoStore } from "@/lib/stores/catalog";
import { cancelSession, completeSession, createSession, getSession, updateSession } from "@/lib/stores/server";
import { decodeSession, sessionTotal, type CheckoutSession } from "@/lib/stores/session";
import type { MapData } from "@/lib/types";

const address = { name: "Ada Park", line_one: "1 Main St", city: "Seattle", state: "WA", postal_code: "98105", country: "US" };
const sofa = demoStore("fernwood-home")?.items[0];

beforeEach(() => {
  process.env.ISSUER = "mock";
  setIssuerForTests(null);
  resetLedgerForTests();
});

function body(result: { body: unknown }) {
  return result.body as CheckoutSession;
}

async function fundedCard(store: string, priceCents: number) {
  const created = await createGroup({ name: "Room", prompt: "sofa", budgetCents: 0 }, { id: "usr_org", name: "Org" });
  const map: MapData = {
    zones: [{ id: "zone", groupId: created.group.id, name: "Living room", sortOrder: 0 }],
    slots: [{ id: "sofa", zoneId: "zone", need: "Sofa", quantityRule: "per_group", quantity: 1, budgetCents: 0, payType: "shared", ownerMemberId: null, chosenProductId: "sofa_p", updatedBy: null, updatedAt: "2026-10-18T07:00:00.000Z" }],
    products: [{ id: "sofa_p", slotId: "sofa", title: "Sofa", store, priceCents, url: "/api/stores/fernwood-home", imageUrl: "", attributes: {} }],
    links: [],
    rules: [],
  };
  await saveMap(created.group.id, map);
  const locked = await lockGroup(created.group.id, "usr_org");
  const member = locked.members[0];
  const funded = await recordContribution({ groupId: created.group.id, memberId: member.id, amountCents: locked.shares[0].totalCents, status: "paid", stripePaymentIntentId: null });
  const card = funded.state.card;
  if (!card) throw new Error("Card missing");
  return card.id;
}

describe("demo store checkout sessions", () => {
  it("prices a session from the catalog and stays stateless across reads", () => {
    if (!sofa) throw new Error("Fixture missing");
    const created = createSession("fernwood-home", { items: [{ id: sofa.id, quantity: 1 }] });
    expect(created.status).toBe(201);
    expect(body(created).status).toBe("not_ready_for_payment");
    const updated = updateSession("fernwood-home", body(created).id, { fulfillment_address: address });
    const ready = body(updated);
    expect(ready.status).toBe("ready_for_payment");
    const tax = Math.round(sofa.priceCents * 0.06);
    expect(sessionTotal(ready)).toBe(sofa.priceCents + tax);
    expect(body(getSession("fernwood-home", ready.id))).toEqual(ready);
    expect(decodeSession(ready.id)?.items).toEqual([{ id: sofa.id, quantity: 1 }]);
    expect(body(cancelSession("fernwood-home", ready.id)).status).toBe("canceled");
    expect(getSession("quillby-lighting", ready.id).status).toBe(404);
  });

  it("flags an item the store doesn't sell instead of pricing it", () => {
    const result = body(createSession("fernwood-home", { items: [{ id: "made_up", quantity: 1 }], fulfillment_address: address }));
    expect(result.status).toBe("not_ready_for_payment");
    expect(result.messages[0]?.code).toBe("invalid_item");
  });

  it("quotes Quillby's surprise shipping past the buffer", () => {
    const lamp = demoStore("quillby-lighting")?.items[0];
    if (!lamp) throw new Error("Fixture missing");
    const result = body(createSession("quillby-lighting", { items: [{ id: lamp.id, quantity: 1 }], fulfillment_address: address }));
    expect(sessionTotal(result)).toBeGreaterThan(capCents(lamp.priceCents) + 1700);
  });

  it("charges the group card within the store's cap and declines anything else", async () => {
    if (!sofa) throw new Error("Fixture missing");
    const cardId = await fundedCard("Fernwood Home", sofa.priceCents);
    const ready = body(createSession("fernwood-home", { items: [{ id: sofa.id, quantity: 1 }], fulfillment_address: address }));
    const done = await completeSession("fernwood-home", ready.id, { payment_data: { token: cardId, provider: "setly" } });
    expect(done.status).toBe(200);
    expect(body(done).order?.id).toMatch(/^ord_/);

    const twice = await completeSession("fernwood-home", ready.id, { payment_data: { token: cardId, provider: "setly" } });
    expect(twice.status).toBe(402);
    expect(JSON.stringify(twice.body)).toContain("exceeds the remaining limit for Fernwood Home");

    const offPlan = body(createSession("tallpine-outfitters", { items: [{ id: "demo_tallpine_table_trail", quantity: 1 }], fulfillment_address: address }));
    const declined = await completeSession("tallpine-outfitters", offPlan.id, { payment_data: { token: cardId, provider: "setly" } });
    expect(declined.status).toBe(402);
    expect(JSON.stringify(declined.body)).toContain("Tallpine Outfitters is not in this plan");
  });

  it("serves the same session over HTTP", async () => {
    if (!sofa) throw new Error("Fixture missing");
    const response = await createRoute(
      new Request("http://localhost/api/stores/fernwood-home/checkout_sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ id: sofa.id, quantity: 2 }], fulfillment_address: address }),
      }),
      { params: Promise.resolve({ slug: "fernwood-home" }) },
    );
    expect(response.status).toBe(201);
    const json = (await response.json()) as CheckoutSession;
    expect(json.line_items[0]?.base_amount).toBe(sofa.priceCents * 2);
    expect(json.totals.map((total) => total.type)).toEqual(["items_base_amount", "subtotal", "tax", "fulfillment", "total"]);
  });
});
