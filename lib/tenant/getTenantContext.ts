import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getSessionClaims, getSessionUser } from "@/lib/tenant/session";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { mfaStepUpNeeded } from "@/lib/tenant/mfaRequired";
import type { TenantContext } from "@/lib/shared/types/foundation";
import { safeErrorMessage } from "@/lib/security/redact";
import { grantActive, tenantWidePermissions, type AuthorizationPolicy, type Grant, type ScopeType } from "@/lib/rbac/authorizeCore";

export const TENANT_COOKIE_NAME = "wa_tenant";

export type Membership = {
  tenantId: string;
  name: string;
  slug: string;
  /** FOUNDATION-P0-31: an automation credential's backing member. */
  automation?: boolean;
  /** FOUNDATION-P0-27: the organization requires MFA (Global Configuration `security.mfaRequired`). */
  mfaRequired?: boolean;
};

/**
 * Observability only (no behaviour change): a failed read here is otherwise
 * indistinguishable from "no grants". Logs the operation and a redacted error
 * category, never row data.
 */
function logReadError(operation: string, error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  console.error("getTenantContext read failed", { operation, category: error.code ?? "unknown", error: safeErrorMessage(error.message ?? "unknown") });
  return true;
}

type MembershipRow = { tenant_id: string; name: string; slug: string; account_type: string; mfa_required: boolean };

type RoleOf = { id: string; name: string; display_name: string; status: string; role_permissions: { permissions: { key: string } | null }[] } | null;

/** An assignment's terms (FOUNDATION-P0-19, migration 0100): scope, validity, condition. */
type Terms = { scope_type: ScopeType; scope_values: string[]; starts_at: string | null; expires_at: string | null; requires_mfa: boolean };

type RoleRow = Terms & { tenant_id: string; roles: RoleOf };

type GroupRoleRow = {
  tenant_id: string;
  groups: { name: string; status: string; group_roles: (Terms & { roles: RoleOf })[] } | null;
};

type PolicyRow = {
  id: string;
  tenant_id: string;
  name: string;
  effect: AuthorizationPolicy["effect"];
  permissions: string[];
  scope_type: ScopeType;
  scope_values: string[];
  exempt_role_ids: string[];
};

type AccessContextRows = { memberships: MembershipRow[]; roles: RoleRow[]; group_roles: GroupRoleRow[]; policies: PolicyRow[] };

/**
 * The current user's memberships, role rows, group role rows and active
 * authorization policies, in one call per request (my_access_context(),
 * migration 0207; it replaced four reads, performance review 2026-10-19).
 * Null if it could not be read: the context then fails closed.
 *
 * - Memberships come from my_memberships() (migration 0152): only the
 *   caller's own active memberships of active organizations, including
 *   organizations that require MFA the session has not passed, so the
 *   person is asked for MFA rather than treated as having no organization.
 * - Roles and group members are filtered by the caller's user id inside the
 *   function: their RLS policies are tenant-scoped, so without it the caller
 *   would inherit every role of every member of the tenant (privilege
 *   escalation, not a cosmetic over-fetch).
 * - The function is SECURITY INVOKER, so every row is read under the
 *   caller's own RLS, as the four separate reads were. Roles across all the
 *   user's tenants are returned; the caller picks the active tenant's.
 */
const readAccessContext = cache(async (): Promise<AccessContextRows | null> => {
  // The token's user id only: getTenantContext() and getMyMemberships() wait for getSessionUser() too.
  const user = (await getSessionClaims())?.user;
  if (!user) return { memberships: [], roles: [], group_roles: [], policies: [] };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_access_context");
  if (logReadError("my_access_context", error)) return null;
  const rows = (data ?? {}) as Partial<AccessContextRows>;
  return { memberships: rows.memberships ?? [], roles: rows.roles ?? [], group_roles: rows.group_roles ?? [], policies: rows.policies ?? [] };
});

/**
 * The current user's active tenant memberships, once per request. The
 * customer shell's organization switcher lists these too.
 */
const readMyMemberships = cache(async (): Promise<{ rows: Membership[]; failed: boolean }> => {
  const read = await readAccessContext();
  return {
    failed: read === null,
    rows: (read?.memberships ?? []).map((m) => ({
      tenantId: m.tenant_id,
      name: m.name ?? m.tenant_id,
      slug: m.slug ?? "",
      automation: m.account_type === "automation",
      mfaRequired: m.mfa_required === true,
    })),
  };
});

export const getMyMemberships = cache(async (): Promise<Membership[]> => {
  const [user, read] = await Promise.all([getSessionUser(), readMyMemberships()]);
  return user ? read.rows : [];
});

function grantOf(terms: Terms, role: NonNullable<RoleOf>, source: Grant["source"], via: string | null): Grant {
  return {
    roleId: role.id,
    role: role.name,
    roleDisplayName: role.display_name,
    source,
    via,
    permissions: role.role_permissions.map((rp) => rp.permissions?.key).filter((k): k is string => !!k),
    scopeType: terms.scope_type ?? "tenant",
    scopeValues: terms.scope_values ?? [],
    startsAt: terms.starts_at ?? null,
    expiresAt: terms.expires_at ?? null,
    requiresMfa: !!terms.requires_mfa,
  };
}

/**
 * Resolves the current request's tenant context. Tenant context comes ONLY
 * from the authenticated user's active tenant_memberships rows (via RLS) —
 * never from a URL param, header, or request body. See
 * CLAUDE.md non-negotiable #2 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-02.5.
 *
 * The `wa_tenant` cookie only *chooses among* memberships the database
 * says the user holds; a cookie naming a tenant they are not a member of
 * is ignored. On a tenant's own address the hostname fixes the candidate
 * instead (FOUNDATION-P0-22) — still only among the user's memberships.
 *
 * Resolved once per request (`cache()`): the layout, the page, and the
 * service calls under them all share it. Its data is one database call
 * (my_access_context()), run alongside the auth server's session check.
 */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const signedOut: TenantContext = { userId: "", tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  if (!(await getSessionClaims())) return signedOut;

  // Performance review (2026-10-19): the auth server's check that the session
  // still exists (getSessionUser) runs alongside the reads, which need only
  // the token's user id. Nothing is used unless the session is live.
  const [user, access, membershipRead, cookieStore, host] = await Promise.all([getSessionUser(), readAccessContext(), readMyMemberships(), cookies(), getHostTenant()]);
  if (!user) return signedOut;
  const memberships = membershipRead.rows;
  // A failed read is never "no access" (owner decision, 2026-10-17): still
  // nothing is permitted, but the context says it could not be checked.
  if (membershipRead.failed) {
    return { userId: user.id, tenantId: null, tenantSlug: null, roles: [], permissions: [], unavailable: true };
  }

  // FOUNDATION-P0-22 — on a tenant's own address (`<slug>.<BASE_APP_HOST>`)
  // that tenant is the only candidate: the user must hold an active
  // membership in it, or there is no tenant context at all (never a
  // fallback to another of their organizations). Elsewhere the cookie
  // chooses among the user's memberships, as before.
  let activeMembership: Membership | null;
  if (host.target.kind === "subdomain" || host.target.kind === "invalid") {
    activeMembership = host.tenant ? (memberships.find((m) => m.tenantId === host.tenant!.tenantId) ?? null) : null;
  } else {
    const requestedTenantId = cookieStore.get(TENANT_COOKIE_NAME)?.value ?? null;
    activeMembership = memberships.find((m) => m.tenantId === requestedTenantId) ?? memberships[0] ?? null;
  }

  if (!activeMembership) {
    return { userId: user.id, tenantId: null, tenantSlug: null, roles: [], permissions: [] };
  }

  // FOUNDATION-P0-27 — the organization requires MFA and this session has
  // not passed it: no tenant, no permissions, only the step-up flag. The
  // database agrees (current_tenant_ids(), migration 0152), so nothing is
  // readable either way. Automation members are exempt (they cannot do MFA).
  if (mfaStepUpNeeded(activeMembership, user.aal)) {
    return { userId: user.id, tenantId: null, tenantSlug: null, roles: [], permissions: [], aal: user.aal, mfaStepUp: { tenantId: activeMembership.tenantId, name: activeMembership.name } };
  }

  const tenantId = activeMembership.tenantId;
  // Roles, groups or policies that cannot be read are never permission
  // (CLAUDE.md §17.4): no permissions at all, marked unavailable.
  if (!access) {
    return { userId: user.id, tenantId, tenantSlug: activeMembership.slug || null, roles: [], permissions: [], grants: [], policies: [], aal: user.aal, unavailable: true };
  }
  const { roles: directRoleRows, group_roles: groupRoleRows, policies: policyRows } = access;
  // FOUNDATION-P0-19 — the engine's facts for this tenant: every role
  // assignment, direct and through active groups, with its terms. An
  // inactive role grants nothing (FOUNDATION-P0-25).
  const grants: Grant[] = [];
  for (const row of directRoleRows) {
    if (row.tenant_id === tenantId && row.roles && row.roles.status === "active") grants.push(grantOf(row, row.roles, "DIRECT", null));
  }
  for (const g of groupRoleRows) {
    if (g.tenant_id !== tenantId || g.groups?.status !== "active") continue;
    for (const gr of g.groups.group_roles) if (gr.roles && gr.roles.status === "active") grants.push(grantOf(gr, gr.roles, "GROUP", g.groups.name));
  }
  // WID-H06 (owner decision 2026-10-12): an automation credential's call never
  // carries a human-only permission (approving access, certifying, managing
  // credentials), whatever its roles say, and its power comes only from the
  // roles given on its own page: a group's roles never reach it.
  const { getAutomationAccess } = await import("@/lib/security/automationCredentials");
  if (await getAutomationAccess()) {
    const { HUMAN_ONLY_PERMISSIONS } = await import("@/lib/security/automationCredentialRules");
    for (let i = grants.length - 1; i >= 0; i--) {
      if (grants[i].source === "GROUP") grants.splice(i, 1);
      else grants[i] = { ...grants[i], permissions: grants[i].permissions.filter((k) => !HUMAN_ONLY_PERMISSIONS.includes(k)) };
    }
  }
  const policies: AuthorizationPolicy[] = policyRows
    .filter((p) => p.tenant_id === tenantId)
    .map((p) => ({ id: p.id, name: p.name, effect: p.effect, permissions: p.permissions, scopeType: p.scope_type, scopeValues: p.scope_values, exemptRoleIds: p.exempt_role_ids }));
  const now = new Date();
  // Roles and permissions in effect across the whole tenant; scoped grants
  // count only where a resource is named (lib/rbac/authorize.ts).
  const permissions = tenantWidePermissions(grants, policies, now, user.aal);
  if (permissions.length === 0) {
    console.error("getTenantContext resolved no permissions for a member", { tenantId, directRoleRows: directRoleRows.length, groupRoleRows: groupRoleRows.length, grants: grants.length, policies: policies.length });
  }
  const roles = [...new Set(grants.filter((g) => g.scopeType === "tenant" && isLive(g, now, user.aal)).map((g) => g.role))];

  return {
    userId: user.id,
    tenantId,
    tenantSlug: activeMembership.slug || null,
    roles,
    permissions,
    grants,
    policies,
    aal: user.aal,
  };
});

function isLive(g: Grant, now: Date, aal: "aal1" | "aal2" | null): boolean {
  return grantActive(g, now) === "ACTIVE" && (!g.requiresMfa || aal === "aal2");
}
