import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/demo/reset/route";
import { getGroupState, resetLedgerForTests } from "@/lib/db/ledger";

const token = "local-demo-reset-test-secret-32-chars";

beforeEach(() => {
  resetLedgerForTests();
  vi.stubEnv("DEMO_RESET_TOKEN", token);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/demo/reset", () => {
  it("stays hidden unless DEMO_RESET is 1", async () => {
    vi.stubEnv("DEMO_RESET", "");
    const hidden = await POST(new Request("http://localhost/api/demo/reset", { method: "POST" }));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Not found" });

    vi.stubEnv("DEMO_RESET", "1");
    const reset = await POST(new Request("http://localhost/api/demo/reset", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ reseeded: true });
    const state = await getGroupState("grp_apartment");
    expect(state?.fundedCents).toBe(52384);
    expect(state?.totalCents).toBe(104759);
  });
});

it("rejects an unsigned reset even when enabled", async () => {
  vi.stubEnv("DEMO_RESET", "1");
  expect((await POST(new Request("http://localhost/api/demo/reset", { method: "POST" }))).status).toBe(404);
});

it("disables reset in production even with the correct secret", async () => {
  vi.stubEnv("DEMO_RESET", "1");
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(new Request("http://localhost/api/demo/reset", { method: "POST", headers: { authorization: `Bearer ${token}` } }))).status).toBe(404);
});
