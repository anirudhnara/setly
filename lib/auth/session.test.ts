import { beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "@/lib/auth/errors";
import { requireUser } from "@/lib/auth/session";
import { setTokenVerifierForTests, type VerifiedFirebaseUser } from "@/lib/auth/verify-token";
import { resetLedgerForTests } from "@/lib/db/ledger";

function request(token?: string) {
  return new Request("http://localhost/api/me", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  resetLedgerForTests();
  setTokenVerifierForTests(async () => ({ uid: "firebase-ani", email: "ani@example.com", name: "Ani" }));
});

describe("requireUser", () => {
  it("rejects a missing token", async () => {
    await expect(requireUser(request())).rejects.toBeInstanceOf(AuthError);
    await expect(requireUser(request())).rejects.toMatchObject({ status: 401, message: "Sign in required" });
  });

  it("upserts by firebase uid and keeps the first name", async () => {
    let calls = 0;
    setTokenVerifierForTests(async (): Promise<VerifiedFirebaseUser> => {
      calls += 1;
      return {
        uid: "firebase-ani",
        email: calls === 1 ? "ani@example.com" : "ani@elsewhere.com",
        name: calls === 1 ? "Ani" : "Someone else",
      };
    });
    const first = await requireUser(request("test-token"));
    const second = await requireUser(request("test-token"));
    expect(first.firebaseUid).toBe("firebase-ani");
    expect(first.name).toBe("Ani");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Ani");
    expect(second.email).toBe("ani@elsewhere.com");
  });

  it("uses the email local part when the token has no display name", async () => {
    setTokenVerifierForTests(async () => ({ uid: "firebase-sam", email: "sam@example.com", name: null }));
    const user = await requireUser(request("test-token"));
    expect(user.name).toBe("sam");
  });

  it("rejects a token with no email", async () => {
    setTokenVerifierForTests(async () => ({ uid: "firebase-blank", email: null, name: "Blank" }));
    await expect(requireUser(request("test-token"))).rejects.toMatchObject({ status: 401 });
  });
});
