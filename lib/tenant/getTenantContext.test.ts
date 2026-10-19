// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner decision 2026-10-17: a failed read while resolving access is never
 * "no access" or "no organization". Nothing is permitted, and the context
 * says it could not be checked (`unavailable`).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
// The token's claims (local) and the auth server's live check (2026-10-19: run alongside the reads).
let liveSession = true;
vi.mock("@/lib/tenant/session", () => ({
  getSessionClaims: async () => ({ user: { id: "u1", aal: "aal1" }, automation: false }),
  getSessionUser: async () => (liveSession ? { id: "u1", aal: "aal1" } : null),
}));
vi.mock("@/lib/tenant/hostTenant", () => ({ getHostTenant: async () => ({ target: { kind: "main" }, tenant: null }) }));
let automationAccess: unknown = null;
vi.mock("@/lib/security/automationCredentials", () => ({ getAutomationAccess: async () => automationAccess }));

// my_access_context() (migration 0207): memberships, roles, group roles and policies in one call.
let parts: Record<string, unknown[]>;
let failed = false;
const rpc = vi.fn(async (name: string) => {
  if (name !== "my_access_context") throw new Error(`unexpected rpc ${name}`);
  return failed ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: parts, error: null };
});
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: async () => ({ rpc }) }));

const role = { id: "r1", name: "TENANT_SUPER_ADMIN", display_name: "Tenant Administrator", status: "active", role_permissions: [{ permissions: { key: "agent.read" } }] };
const terms = { scope_type: "tenant", scope_values: [], starts_at: null, expires_at: null, requires_mfa: false };

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  automationAccess = null;
  liveSession = true;
  failed = false;
  rpc.mockClear();
  parts = {
    memberships: [{ tenant_id: "t1", name: "Acme", slug: "acme", account_type: "internal", mfa_required: false }],
    roles: [{ tenant_id: "t1", ...terms, roles: role }],
    group_roles: [],
    policies: [],
  };
});

async function resolve() {
  const { getTenantContext } = await import("./getTenantContext");
  return getTenantContext();
}

describe("getTenantContext when a read fails", () => {
  it("resolves normally when every read succeeds", async () => {
    const ctx = await resolve();
    expect(ctx).toMatchObject({ tenantId: "t1", permissions: ["agent.read"] });
    expect(ctx.unavailable).toBeUndefined();
  });

  it("another tenant's roles, and a role RLS hides, grant nothing", async () => {
    parts.roles = [{ tenant_id: "t2", ...terms, roles: { ...role, role_permissions: [{ permissions: { key: "role.manage" } }] } }, { tenant_id: "t1", ...terms, roles: null }];
    const ctx = await resolve();
    expect(ctx).toMatchObject({ tenantId: "t1", permissions: [] });
  });

  it("a revoked session gets nothing, though its reads ran alongside the check", async () => {
    liveSession = false;
    const ctx = await resolve();
    expect(ctx).toMatchObject({ userId: "", tenantId: null, permissions: [] });
  });

  it("a failed read is unavailable, with no organization and no permissions", async () => {
    failed = true;
    const ctx = await resolve();
    expect(ctx.unavailable).toBe(true);
    expect(ctx).toMatchObject({ tenantId: null, permissions: [], roles: [] });
  });

  it("an empty but successful read is still plain no access, not unavailable", async () => {
    parts.memberships = [];
    const ctx = await resolve();
    expect(ctx).toMatchObject({ tenantId: null, permissions: [] });
    expect(ctx.unavailable).toBeUndefined();
  });
});

describe("WID-H06: an automation credential's call", () => {
  const groupRole = { id: "r2", name: "AUDITOR", display_name: "Auditor", status: "active", role_permissions: [{ permissions: { key: "audit.read" } }] };
  const groupRow = { tenant_id: "t1", groups: { name: "Auditors", status: "active", group_roles: [{ ...terms, roles: groupRole }] } };

  it("a person keeps the roles of their groups", async () => {
    parts.group_roles = [groupRow];
    const ctx = await resolve();
    expect([...ctx.permissions].sort()).toEqual(["agent.read", "audit.read"]);
  });

  it("gets nothing from a group, only the roles given on the credential's own page", async () => {
    parts.group_roles = [groupRow];
    automationAccess = { credentialId: "c1" };
    const ctx = await resolve();
    expect(ctx.permissions).toEqual(["agent.read"]);
    expect(ctx.grants?.some((g) => g.source === "GROUP")).toBe(false);
  });
});
