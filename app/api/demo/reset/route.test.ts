import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/demo/reset/route";
import { getGroupState, resetLedgerForTests } from "@/lib/db/ledger";

const previous = process.env.DEMO_RESET;

beforeEach(() => {
  resetLedgerForTests();
});

afterEach(() => {
  if (previous === undefined) delete process.env.DEMO_RESET;
  else process.env.DEMO_RESET = previous;
});

describe("POST /api/demo/reset", () => {
  it("stays hidden unless DEMO_RESET is 1", async () => {
    delete process.env.DEMO_RESET;
    const hidden = await POST(new Request("http://localhost/api/demo/reset", { method: "POST" }));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Not found" });

    process.env.DEMO_RESET = "1";
    const reset = await POST(new Request("http://localhost/api/demo/reset", { method: "POST" }));
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ reseeded: true });
    const state = await getGroupState("grp_apartment");
    expect(state?.fundedCents).toBe(52384);
    expect(state?.totalCents).toBe(104759);
  });
});
