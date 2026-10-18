import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/groups/[id]/route";
import { POST as authorize } from "@/app/api/issuing/authorize/route";
import { requireUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { setTokenVerifierForTests } from "@/lib/auth/verify-token";
import { createGroup, resetLedgerForTests } from "@/lib/db/ledger";
import { jsonError } from "@/lib/db/http";
import { getEnv } from "@/lib/env";
import { readText } from "@/lib/security/request";
import { limitAiRequests } from "@/lib/security/rate-limit";

beforeEach(() => {
  resetLedgerForTests();
  vi.stubEnv("ISSUER", "mock");
  vi.stubEnv("MOCK_AI", "1");
  setTokenVerifierForTests(async (token) => ({ uid: token, email: `${token}@example.com`, name: token }));
});

afterEach(() => {
  setTokenVerifierForTests(null);
  vi.unstubAllEnvs();
});

function request(token: string) {
  return new Request("https://setly.test/api/groups", { headers: { authorization: `Bearer ${token}` } });
}

describe("security boundaries", () => {
  it("limits AI requests across routes per identity and allows recovery", () => {
    for (let i = 0; i < 20; i++) limitAiRequests("limited-user", "https://setly.test/api/maps/interview", 1000);
    expect(() => limitAiRequests("limited-user", "https://setly.test/api/maps/generate", 1000)).toThrow(/Too many/);
    expect(() => limitAiRequests("other-user", "https://setly.test/api/maps/generate", 1000)).not.toThrow();
    expect(() => limitAiRequests("limited-user", "https://setly.test/api/groups/group", 1000)).not.toThrow();
    expect(() => limitAiRequests("limited-user", "https://setly.test/api/maps/generate", 61_000)).not.toThrow();
  });
  it("only lets members read a group's financial state", async () => {
    const owner = await requireUser(request("owner"));
    const group = await createGroup({ name: "Private", prompt: "lamp", budgetCents: 100 }, owner);
    const context = { params: Promise.resolve({ id: group.group.id }) };
    expect((await GET(request("owner"), context)).status).toBe(200);
    const denied = await GET(request("outsider"), context);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "You are not in this group" });
    expect((await GET(new Request("https://setly.test/api/groups"), context)).status).toBe(401);
  });

  it("rejects unsigned, altered, and stale card authorizations", async () => {
    const secret = "whsec_security_test";
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_security_test");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ cardId: "missing", merchant: "IKEA", amountCents: 100 });
    const stripe = new Stripe("sk_test_security_test");
    const send = (body: string, signature?: string) => authorize(new Request("https://setly.test/api/issuing/authorize", {
      method: "POST", body, headers: signature ? { "stripe-signature": signature } : {},
    }));
    expect((await send(payload)).status).toBe(400);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect((await send(payload.replace("100", "200"), signature)).status).toBe(400);
    const stale = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: 1 });
    expect((await send(payload, stale)).status).toBe(400);
    const verified = await send(payload, signature);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ approved: false });
  });

  it("limits streamed bodies without trusting Content-Length", async () => {
    const input = new Request("https://setly.test/api/groups", { method: "POST", body: "123456" });
    await expect(readText(input, 5)).rejects.toMatchObject({ status: 413 });
    expect(await readText(new Request("https://setly.test", { method: "POST", body: "é" }), 2)).toBe("é");
  });

  it.each(["//evil.example", "/\\evil.example", "/\n/evil.example", "https://evil.example"])("blocks external login redirect %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("preserves internal login destinations", () => {
    expect(safeNextPath("/g/group/join?x=1#details")).toBe("/g/group/join?x=1#details");
  });

  it("rejects live Stripe keys even in mock mode", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_rejected");
    expect(() => getEnv()).toThrow();
  });

  it("does not disclose internal error messages", async () => {
    const response = jsonError(new Error("database credentials or SQL details"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
});
