import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceCheckout, approveCheckout, recordGuidedPurchase, resetCheckoutPollsForTests, settleCheckout, startCheckout } from "@/lib/checkout/orchestrator";
import { getGroupState, recordContribution, resetLedgerForTests } from "@/lib/db/ledger";
import { ZINC_FEE_CENTS } from "@/lib/money/buffer";
import { setIssuerForTests } from "@/lib/payments";
import type { GroupState, ShippingAddress } from "@/lib/types";

const address: ShippingAddress = { firstName: "Ani", lastName: "Rao", line1: "4000 15th Ave NE", line2: null, city: "Seattle", state: "WA", postalCode: "98105", phone: "206-555-0100" };
const t0 = new Date("2026-10-18T09:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const fetchSpy = vi.fn(() => Promise.reject(new Error("no network")));

beforeEach(() => {
  process.env.ISSUER = "mock";
  delete process.env.CHECKOUT_ZINC;
  setIssuerForTests(null);
  resetLedgerForTests();
  resetCheckoutPollsForTests();
  vi.stubGlobal("fetch", fetchSpy);
});

/** The seeded demo group, with the last two roommates paying so the card is issued. */
async function fundedDemo() {
  const seeded = await getGroupState("grp_apartment");
  if (!seeded) throw new Error("Seed missing");
  for (const contribution of seeded.contributions.filter((item) => item.status === "pending")) {
    await recordContribution({ groupId: "grp_apartment", memberId: contribution.memberId, amountCents: contribution.amountCents, status: "paid", stripePaymentIntentId: null });
  }
  const funded = await getGroupState("grp_apartment");
  if (!funded?.card) throw new Error("Card was not issued");
  return funded;
}

const byStore = (state: GroupState) => Object.fromEntries(state.storeOrders.map((order) => [order.store, order]));

describe("checkout orchestrator", () => {
  it("runs the demo: protocol places, Quillby pauses, Zinc advances on poll, approve, settle refunds to the cent", async () => {
    const funded = await fundedDemo();
    expect(funded.group.status).toBe("active");
    // Zinc stores are paid from the Zinc wallet, not the card.
    expect(funded.storeLimits.map((limit) => limit.store).sort()).toEqual(["Fernwood Home", "IKEA", "Quillby Lighting", "Tallpine Outfitters"]);

    await expect(startCheckout("grp_apartment", "usr_jules", address, t0)).rejects.toMatchObject({ status: 403 });
    const started = await startCheckout("grp_apartment", "usr_ani", address, t0);
    const orders = byStore(started);
    expect(orders["Fernwood Home"]).toMatchObject({ lane: "protocol", status: "placed" });
    expect(orders["Tallpine Outfitters"]).toMatchObject({ lane: "protocol", status: "placed" });
    expect(orders["Quillby Lighting"]).toMatchObject({ lane: "protocol", status: "needs_approval" });
    expect(orders["Quillby Lighting"]?.error).toMatch(/over the .* cap/);
    expect(orders.Target).toMatchObject({ lane: "zinc", status: "placing" });
    expect(orders["Best Buy"]).toMatchObject({ lane: "zinc", status: "placing" });
    expect(orders.IKEA).toMatchObject({ lane: "guided", status: "placing" });
    expect(started.address).toEqual(address);

    // Starting twice doesn't create a second set of orders.
    expect((await startCheckout("grp_apartment", "usr_ani", address, t0)).storeOrders).toHaveLength(started.storeOrders.length);

    // Polling before the sim finishes keeps Zinc placing; after 6s it's placed.
    const early = await advanceCheckout(started, at(3_000));
    expect(byStore(early).Target?.status).toBe("placing");
    resetCheckoutPollsForTests();
    const later = await advanceCheckout(early, at(7_000));
    expect(byStore(later).Target).toMatchObject({ status: "placed" });
    expect(byStore(later)["Best Buy"]).toMatchObject({ status: "placed" });

    await expect(settleCheckout("grp_apartment", "usr_ani", at(8_000))).rejects.toMatchObject({ status: 409 });

    const quillby = byStore(later)["Quillby Lighting"];
    if (!quillby) throw new Error("Quillby missing");
    const approved = await approveCheckout("grp_apartment", "usr_sam", quillby.id, true, at(8_000));
    expect(byStore(approved)["Quillby Lighting"]).toMatchObject({ status: "placed", finalTotalCents: quillby.quotedCents });

    // A roommate buys the IKEA part with the group card.
    const ikea = byStore(approved).IKEA;
    if (!ikea) throw new Error("IKEA order missing");
    await expect(recordGuidedPurchase("grp_apartment", "usr_nobody", ikea.id, at(10_000))).rejects.toMatchObject({ status: 403 });
    const bought = await recordGuidedPurchase("grp_apartment", "usr_riley", ikea.id, at(10_000));
    expect(byStore(bought).IKEA).toMatchObject({ status: "placed", finalTotalCents: ikea.quotedCents });
    await expect(recordGuidedPurchase("grp_apartment", "usr_riley", ikea.id, at(10_500))).rejects.toMatchObject({ status: 409 });

    const { state: settled, refunds } = await settleCheckout("grp_apartment", "usr_ani", at(11_000));
    expect(settled.group.status).toBe("purchased");
    const spent = settled.storeOrders.reduce((sum, order) => sum + (order.finalTotalCents ?? 0), 0);
    const fees = settled.storeOrders.filter((order) => order.lane === "zinc").length * ZINC_FEE_CENTS;
    const refunded = refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
    expect(refunded).toBe(settled.fundedCents - spent - fees);
    expect(refunded).toBeGreaterThan(0);
    expect(refunds.every((refund) => Number.isInteger(refund.amountCents) && refund.amountCents > 0)).toBe(true);
    expect(new Set(refunds.map((refund) => refund.reason))).toEqual(new Set(["leftover_buffer", "zinc_held"]));

    const again = await settleCheckout("grp_apartment", "usr_ani", at(12_000));
    expect(again.refunds).toEqual([]);
    expect(again.state.refunds).toHaveLength(settled.refunds.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cancels a declined quote and refunds that store in full", async () => {
    await fundedDemo();
    const started = await startCheckout("grp_apartment", "usr_ani", address, t0);
    const quillby = byStore(started)["Quillby Lighting"];
    if (!quillby) throw new Error("Quillby missing");
    const declined = await approveCheckout("grp_apartment", "usr_ani", quillby.id, false, at(1_000));
    expect(byStore(declined)["Quillby Lighting"]).toMatchObject({ status: "canceled" });
    resetCheckoutPollsForTests();
    await advanceCheckout(declined, at(7_000));
    // Nobody buys the IKEA part: settle cancels it rather than wait forever.
    const { state, refunds } = await settleCheckout("grp_apartment", "usr_ani", at(8_000));
    expect(byStore(state).IKEA?.status).toBe("canceled");
    const quillbyRefund = refunds.filter((refund) => refund.storeOrderId === quillby.id);
    expect(quillbyRefund.every((refund) => refund.reason === "store_failed")).toBe(true);
    expect(quillbyRefund.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(quillby.capCents);
  });

  it("approves a Zinc overrun that came back without a total by offering the spare buffer", async () => {
    await fundedDemo();
    const started = await startCheckout("grp_apartment", "usr_ani", address, t0);
    const target = byStore(started).Target;
    if (!target) throw new Error("Target missing");
    // Simulate Zinc's real sandbox answer: order_failed, max_price_exceeded, price_components null.
    const { editGroup } = await import("@/lib/db/ledger");
    await editGroup("grp_apartment", (state) => {
      const order = state.storeOrders.find((item) => item.id === target.id);
      if (order) Object.assign(order, { status: "needs_approval", quotedCents: null });
    });
    const approved = await approveCheckout("grp_apartment", "usr_ani", target.id, true, at(1_000));
    const raised = byStore(approved).Target;
    expect(raised?.status).toBe("placing");
    expect(raised?.attempt).toBe(1);
    expect(raised?.capCents ?? 0).toBeGreaterThan(target.capCents);
  });
});
