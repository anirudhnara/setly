import { describe, expect, it } from "vitest";
import { decideAuthorization } from "@/lib/payments/decide";

const plan = {
  card: { id: "card", groupId: "group", last4: "4242", limitCents: 1000, status: "active" as const },
  storeLimits: [{ cardId: "card", store: "IKEA", limitCents: 1000, spentCents: 0 }],
};

describe("authorization security", () => {
  it.each(["Not IKEA", "IKEA scam store", "FakeIKEA"])("does not accept a merchant merely containing the store name: %s", (merchant) => {
    expect(decideAuthorization({ ...plan, merchant, amountCents: 100 }).approved).toBe(false);
  });

  it("accepts exact names with case or surrounding whitespace differences", () => {
    expect(decideAuthorization({ ...plan, merchant: " ikea ", amountCents: 100 }).approved).toBe(true);
  });

  it.each([-100, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("declines invalid amount %s", (amountCents) => {
    expect(decideAuthorization({ ...plan, merchant: "IKEA", amountCents }).approved).toBe(false);
  });
});
