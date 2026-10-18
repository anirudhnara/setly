import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, getGroupState, resetLedgerForTests } from "@/lib/db/ledger";
import { POST } from "@/app/api/maps/paste/route";

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "usr_org", firebaseUid: "uid", email: "org@example.com", name: "Org", createdAt: "2026-10-17T18:00:00.000Z" }),
}));

beforeEach(() => {
  process.env.MOCK_AI = "1";
  resetLedgerForTests();
});

describe("POST /api/maps/paste", () => {
  it("saves the pasted list into the group", async () => {
    const created = await createGroup({ name: "Room", prompt: "paste", budgetCents: 0 }, { id: "usr_org", name: "Org" });
    const request = new Request("http://localhost/api/maps/paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "sofa\nrug\nlamp", groupId: created.group.id }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const state = await getGroupState(created.group.id);
    expect(state?.map.slots).toHaveLength(3);
    expect(state?.map.slots.every((slot) => state.map.products.some((product) => product.id === slot.chosenProductId))).toBe(true);
  });
});
