// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getSessionUser() is where a revoked session is refused (performance review
 * 2026-10-19: the proxy only verifies the token's signature now). It needs
 * both a verified token and the auth server's word that the session lives.
 */
let claims: { data: { claims: Record<string, unknown> } | null; error: unknown } = { data: null, error: null };
let live: { data: { user: { id: string } | null }; error: unknown } = { data: { user: null }, error: null };
const getUser = vi.fn(async () => live);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: async () => ({ auth: { getClaims: async () => claims, getUser } }) }));
vi.mock("@/lib/security/automationCredentials", () => ({ getAutomationAccess: async () => null }));

const { getSessionUser } = await import("./session");

beforeEach(() => {
  claims = { data: { claims: { sub: "u1", email: "ada@example.test", aal: "aal2" } }, error: null };
  live = { data: { user: { id: "u1" } }, error: null };
  getUser.mockClear();
});

describe("getSessionUser", () => {
  it("is the user when the token verifies and the auth server knows the session", async () => {
    expect(await getSessionUser()).toEqual({ id: "u1", email: "ada@example.test", aal: "aal2" });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("is nobody when the session was revoked, even with a validly signed token", async () => {
    live = { data: { user: null }, error: { name: "AuthApiError", status: 403, message: "Session not found" } };
    expect(await getSessionUser()).toBeNull();
  });

  it("is nobody when the auth server names another user, or cannot be reached", async () => {
    live = { data: { user: { id: "u2" } }, error: null };
    expect(await getSessionUser()).toBeNull();
    live = { data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } };
    expect(await getSessionUser()).toBeNull();
  });

  it("is nobody when the token does not verify", async () => {
    claims = { data: null, error: { name: "AuthInvalidJwtError", message: "bad signature" } };
    expect(await getSessionUser()).toBeNull();
  });
});
