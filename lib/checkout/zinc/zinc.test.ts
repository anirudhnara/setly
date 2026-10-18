import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaneOrder } from "@/lib/checkout/lane";
import { buildZincOrder, idempotencyKey, zincBlocker } from "@/lib/checkout/zinc/request";
import { zincLane } from "@/lib/checkout/zinc/lane";
import { simOrderStatus } from "@/lib/checkout/zinc/simulator";
import type { Product, StoreOrder } from "@/lib/types";

const t0 = new Date("2026-10-18T09:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function product(patch: Partial<Product> = {}): Product {
  return { id: "p1", slotId: "s1", title: "Throw pillows", store: "Target", priceCents: 1000, url: "https://www.google.com/search?q=pillows", imageUrl: "", attributes: {}, ...patch };
}

function laneOrder(patch: Partial<StoreOrder> = {}, items = [{ product: product(), quantity: 4 }], now = t0): LaneOrder {
  const order: StoreOrder = {
    id: "so_target",
    groupId: "grp",
    store: "Target",
    lane: "zinc",
    status: "placing",
    subtotalCents: 4000,
    capCents: 4400,
    quotedCents: null,
    externalId: null,
    attempt: 0,
    error: null,
    tracking: [],
    finalTotalCents: null,
    updatedAt: t0.toISOString(),
    ...patch,
  };
  return {
    order,
    items,
    address: { firstName: "Ada", lastName: "Park", line1: "1 Main St", line2: null, city: "Seattle", state: "WA", postalCode: "98105", phone: "206-555-0100" },
    cardId: null,
    authorizations: [],
    now,
  };
}

const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in sim mode")));

beforeEach(() => {
  delete process.env.CHECKOUT_ZINC;
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

describe("Zinc request builder", () => {
  it("sends the cap as max_price, the address in Zinc's shape, and a stable UUID per attempt", () => {
    const body = buildZincOrder(laneOrder());
    expect(body.max_price).toBe(4400);
    expect(body.products).toEqual([{ url: "https://www.google.com/search?q=pillows", quantity: 4 }]);
    expect(body.shipping_address).toMatchObject({ first_name: "Ada", address_line1: "1 Main St", postal_code: "98105", country: "US" });
    expect(body.shipping_address).not.toHaveProperty("address_line2");
    expect(body.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idempotencyKey("so_target", 0)).toBe(body.idempotency_key);
    expect(idempotencyKey("so_target", 1)).not.toBe(body.idempotency_key);
  });

  it("blocks items from another store, and placeholder links when talking to real Zinc", () => {
    expect(zincBlocker(laneOrder({}, [{ product: product({ store: "IKEA" }), quantity: 1 }]), false)).toContain("not Target");
    expect(zincBlocker(laneOrder(), false)).toBeNull();
    expect(zincBlocker(laneOrder(), true)).toContain("doesn't link to Target");
    expect(zincBlocker(laneOrder({}, [{ product: product({ url: "https://www.target.com/p/pillows" }), quantity: 1 }]), true)).toBeNull();
  });
});

describe("Zinc simulator lane", () => {
  it("goes pending to placed in about 6 seconds with tracking at 9, and never fetches", async () => {
    const placed = await zincLane.place(laneOrder());
    expect(placed.status).toBe("placing");
    expect(placed.externalId).toMatch(/^zsim_\d+_/);
    const placing = laneOrder({ externalId: placed.externalId ?? null });
    expect((await zincLane.status({ ...placing, now: at(1_000) })).status).toBe("placing");
    expect((await zincLane.status({ ...placing, now: at(4_000) })).status).toBe("placing");
    const done = await zincLane.status({ ...placing, now: at(6_500) });
    expect(done).toMatchObject({ status: "placed", finalTotalCents: 4000 + 340, tracking: [] });
    const tracked = await zincLane.status({ ...placing, now: at(9_500) });
    expect(tracked.tracking?.[0]?.number).toMatch(/^1ZSIM/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks for approval when the total passes max_price", async () => {
    const tight = laneOrder({ capCents: 4100 });
    const placed = await zincLane.place(tight);
    const update = await zincLane.status({ ...tight, order: { ...tight.order, externalId: placed.externalId ?? null }, now: at(7_000) });
    expect(update).toMatchObject({ status: "needs_approval", quotedCents: 4340 });
  });

  it("honors the sandbox test products", async () => {
    const url = (slug: string) => [{ product: product({ url: `https://zinc.com/shop/products/${slug}` }), quantity: 1 }];
    expect((await zincLane.place(laneOrder({}, url("test-invalid-address")))).status).toBe("failed");
    const stock = laneOrder({}, url("test-out-of-stock"));
    const placed = await zincLane.place(stock);
    const failed = await zincLane.status({ ...stock, order: { ...stock.order, externalId: placed.externalId ?? null }, now: at(7_000) });
    expect(failed).toMatchObject({ status: "failed", error: "Target is out of stock" });
    const exceeded = simOrderStatus("zsim_0_x", [{ url: "https://zinc.com/shop/products/test-price-exceeded", quantity: 1, priceCents: 100 }], 5000, new Date(10_000));
    expect(exceeded.job_result?.error_type).toBe("max_price_exceeded");
    expect(exceeded.job_result?.price_components?.total).toBeGreaterThan(5000);
  });
});
