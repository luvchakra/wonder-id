import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { PolicyCondition } from "@/lib/shared/types/access-governance";
import { addPolicyRule, getPolicy } from "./policies";
import {
  accessConflictRulesFrom,
  conflictOutcome,
  findAccessConflicts,
  heldConflicts,
  validateConflictSides,
  type AccessConflict,
  type AccessConflictRule,
} from "./accessSodRules";

/**
 * ACCESS-P0-22 part 1 — separation of duties over access combinations
 * (rules in accessSodRules.ts). Checked where access is asked for or given:
 * a catalog request, a package or role request, a direct package
 * assignment, birthright and rule assignments, and again at every approval.
 * What an identity holds is its access grants that are not revoked and not
 * missing at the source, pending ones included, so two requests made
 * together cannot slip past each other.
 *
 * Reads for the checks use the service role with the tenant filtered on
 * every query (§14): a security control must not depend on what the acting
 * user can read. Every conflict found is audited.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACCESS_CONFLICT_ACTION = "access.sod_access_conflict";

type RulesRow = Parameters<typeof accessConflictRulesFrom>[1][number];
const RULES_SELECT = "id, tenant_id, name, status, action, policy_rules(id, rule_type, condition, created_at)";

/** Rules that enforce: those on active identity policies. */
async function activeRules(tenantId: string): Promise<AccessConflictRule[]> {
  const { data, error } = await supabaseServiceRole().from("policies").select(RULES_SELECT).eq("tenant_id", tenantId).eq("policy_category", "identity").eq("status", "active").limit(500).returns<RulesRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return accessConflictRulesFrom(tenantId, data ?? []);
}

/** Every access conflict rule, whatever its policy's status, read as the user (the SoD Rules page). */
export async function listAccessConflictRules(tenantId: string): Promise<AccessConflictRule[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("policies").select(RULES_SELECT).eq("tenant_id", tenantId).eq("policy_category", "identity").limit(500).returns<RulesRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return accessConflictRulesFrom(tenantId, data ?? []);
}

/** The entitlements an identity holds or is being given (grants not revoked, still at the source; pending included). */
async function heldEntitlements(tenantId: string, subject: { identityId: string; agentId?: string | null }): Promise<Set<string>> {
  const admin = supabaseServiceRole();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, tenant_id")
    .eq("tenant_id", tenantId)
    .or(subject.agentId && UUID_RE.test(subject.agentId) ? `identity_id.eq.${subject.identityId},agent_id.eq.${subject.agentId}` : `identity_id.eq.${subject.identityId}`)
    .limit(1000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const accountIds = (accounts ?? []).filter((a) => a.tenant_id === tenantId).map((a) => a.id as string);
  if (!accountIds.length) return new Set();
  const { data: grants, error: grantError } = await admin
    .from("access_grants")
    .select("entitlement_id, tenant_id")
    .eq("tenant_id", tenantId)
    .in("account_id", accountIds)
    .is("revoked_at", null)
    .is("missing_from_source_at", null)
    .limit(5000);
  if (grantError) throw new ApiError(500, "QUERY_FAILED", grantError.message);
  return new Set((grants ?? []).filter((g) => g.tenant_id === tenantId && g.entitlement_id).map((g) => g.entitlement_id as string));
}

async function entitlementNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabaseServiceRole().from("entitlements").select("id, tenant_id, name, applications(name, display_name)").eq("tenant_id", tenantId).in("id", [...new Set(ids)]);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return new Map(
    ((data ?? []) as unknown as { id: string; tenant_id: string; name: string; applications: { name: string; display_name: string | null } | null }[])
      .filter((e) => e.tenant_id === tenantId)
      .map((e) => [e.id, e.applications ? `${e.applications.display_name ?? e.applications.name} · ${e.name}` : e.name]),
  );
}

export type AccessSodCheck = { kind: "none" } | { kind: "warn"; conflicts: { policyId: string; policyName: string; left: string[]; right: string[] }[] };

/**
 * Checks giving `adding` (entitlement ids) to an identity. A blocking
 * conflict is audited and refused (409 SOD_CONFLICT); warnings are audited
 * and returned, so the caller records them and sends the change to a
 * person. A failed read throws: an unreadable rule is never permission.
 */
export async function checkAccessCombination(
  tenantId: string,
  actorId: string | null,
  subject: { identityId: string; agentId?: string | null },
  adding: string[],
  context: { kind: "request" | "package_request" | "assignment" | "birthright" | "rule" | "approval"; objectType: string; objectId: string },
): Promise<AccessSodCheck> {
  const toAdd = adding.filter((e) => UUID_RE.test(e));
  if (!toAdd.length || !UUID_RE.test(subject.identityId)) return { kind: "none" };
  const rules = await activeRules(tenantId);
  if (!rules.length) return { kind: "none" };
  const held = await heldEntitlements(tenantId, subject);
  // At approval the request's own access may already be pending; it is what is being decided, so it counts as adding, not held.
  for (const e of toAdd) held.delete(e);
  const outcome = conflictOutcome(findAccessConflicts(rules, held, toAdd));
  if (outcome.kind === "none") return outcome;
  const conflicts: AccessConflict[] = outcome.kind === "block" ? [outcome.conflict] : outcome.conflicts;
  const summary = conflicts.map((c) => ({ policyId: c.rule.policyId, policyName: c.rule.policyName, ruleId: c.rule.ruleId, left: c.leftHeld, right: c.rightHeld, blocking: c.rule.blocking }));
  await writeAudit({
    tenantId,
    actorId,
    actorType: actorId ? "user" : "system",
    action: ACCESS_CONFLICT_ACTION,
    objectType: context.objectType,
    objectId: context.objectId,
    outcome: outcome.kind === "block" ? "failure" : "success",
    metadata: { identityId: subject.identityId, at: context.kind, adding: toAdd, conflicts: summary },
  });
  if (outcome.kind === "block") {
    const c = outcome.conflict;
    const names = await entitlementNames(tenantId, [...c.leftHeld, ...c.rightHeld]);
    const say = (list: string[]) => list.map((e) => names.get(e) ?? "an entitlement").join(", ");
    throw new ApiError(409, "SOD_CONFLICT", `Separation of duties ("${c.rule.policyName}"): this identity would hold ${say(c.leftHeld)} together with ${say(c.rightHeld)}, which must not be combined.`);
  }
  return { kind: "warn", conflicts: summary.map(({ policyId, policyName, left, right }) => ({ policyId, policyName, left, right })) };
}

export type ConflictPreview = { policyName: string; blocking: boolean; left: string[]; right: string[] };

/**
 * The conflicts giving `adding` would create, with entitlement names, and
 * nothing written: for the role simulation (ACCESS-P0-21), which never
 * changes anything.
 */
export async function previewAccessConflicts(tenantId: string, subject: { identityId: string; agentId?: string | null }, adding: string[]): Promise<ConflictPreview[]> {
  const toAdd = adding.filter((e) => UUID_RE.test(e));
  if (!toAdd.length) return [];
  const rules = await activeRules(tenantId);
  if (!rules.length) return [];
  const held = await heldEntitlements(tenantId, subject);
  const conflicts = findAccessConflicts(rules, held, toAdd);
  const names = await entitlementNames(tenantId, conflicts.flatMap((c) => [...c.leftHeld, ...c.rightHeld]));
  const say = (list: string[]) => list.map((e) => names.get(e) ?? "An entitlement");
  return conflicts.map((c) => ({ policyName: c.rule.policyName, blocking: c.rule.blocking, left: say(c.leftHeld), right: say(c.rightHeld) }));
}

/** Adds a conflict rule to an identity policy, as a new version of it (audited by the policy service). */
export async function addAccessConflictRule(tenantId: string, actorId: string, input: { policyId?: unknown; left?: unknown; right?: unknown }): Promise<void> {
  const policyId = typeof input.policyId === "string" ? input.policyId : "";
  if (!UUID_RE.test(policyId)) throw new ApiError(400, "VALIDATION_FAILED", "Choose the identity policy the rule belongs to.");
  const sides = validateConflictSides(input.left, input.right);
  if (!sides.ok) throw new ApiError(400, "VALIDATION_FAILED", sides.message);
  const policy = await getPolicy(policyId, tenantId);
  if (!policy || policy.tenantId !== tenantId) throw new ApiError(404, "POLICY_NOT_FOUND", "No such policy in this organization");
  if (policy.policyCategory !== "identity") throw new ApiError(400, "VALIDATION_FAILED", "Separation-of-duties rules belong on an identity policy.");
  const names = await entitlementNames(tenantId, [...sides.left, ...sides.right]);
  if (names.size !== sides.left.length + sides.right.length) throw new ApiError(404, "NOT_FOUND", "One of the entitlements is not in this organization.");
  await addPolicyRule(tenantId, policyId, "rbac", { conflictingAccess: { left: sides.left, right: sides.right } } as unknown as PolicyCondition, actorId);
}

export type HeldAccessConflict = {
  identityId: string;
  identityName: string;
  identityType: string;
  policyId: string;
  policyName: string;
  blocking: boolean;
  left: string[];
  right: string[];
};

/**
 * The detective view: identities that hold a forbidden combination now,
 * under active rules. Service role, tenant filtered on every read; at most
 * 20,000 grants are read, and the result says when that cap was reached.
 */
export async function listHeldAccessConflicts(tenantId: string): Promise<{ conflicts: HeldAccessConflict[]; capped: boolean; names: Map<string, string> }> {
  const rules = await activeRules(tenantId);
  if (!rules.length) return { conflicts: [], capped: false, names: new Map() };
  const relevant = [...new Set(rules.flatMap((r) => [...r.left, ...r.right]))];
  const admin = supabaseServiceRole();
  const byIdentity = new Map<string, Set<string>>();
  let read = 0;
  const CAP = 20_000;
  for (let from = 0; read < CAP; from += 1000) {
    const { data, error } = await admin
      .from("access_grants")
      .select("id, tenant_id, entitlement_id, accounts!inner(tenant_id, identity_id, agent_id)")
      .eq("tenant_id", tenantId)
      .in("entitlement_id", relevant)
      .is("revoked_at", null)
      .is("missing_from_source_at", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const rows = (data ?? []) as unknown as { tenant_id: string; entitlement_id: string; accounts: { tenant_id: string; identity_id: string | null; agent_id: string | null } }[];
    read += rows.length;
    for (const g of rows) {
      if (g.tenant_id !== tenantId || g.accounts.tenant_id !== tenantId) continue;
      const key = g.accounts.identity_id ?? (g.accounts.agent_id ? `agent:${g.accounts.agent_id}` : null);
      if (!key) continue;
      byIdentity.set(key, (byIdentity.get(key) ?? new Set()).add(g.entitlement_id));
    }
    if (rows.length < 1000) break;
  }
  // Agents' accounts carry the agent; resolve each to its identity.
  const agentKeys = [...byIdentity.keys()].filter((k) => k.startsWith("agent:")).map((k) => k.slice(6));
  if (agentKeys.length) {
    const { data: agentIdentities } = await admin.from("identities").select("id, tenant_id, agent_id").eq("tenant_id", tenantId).in("agent_id", agentKeys);
    for (const row of agentIdentities ?? []) {
      if (row.tenant_id !== tenantId) continue;
      const set = byIdentity.get(`agent:${row.agent_id}`);
      if (!set) continue;
      byIdentity.delete(`agent:${row.agent_id}`);
      const existing = byIdentity.get(row.id as string) ?? new Set<string>();
      set.forEach((e) => existing.add(e));
      byIdentity.set(row.id as string, existing);
    }
  }
  const found: Omit<HeldAccessConflict, "identityName" | "identityType">[] = [];
  for (const [identityId, held] of byIdentity) {
    if (identityId.startsWith("agent:")) continue;
    for (const c of heldConflicts(rules, held)) found.push({ identityId, policyId: c.rule.policyId, policyName: c.rule.policyName, blocking: c.rule.blocking, left: c.leftHeld, right: c.rightHeld });
  }
  const identityIds = [...new Set(found.map((f) => f.identityId))];
  const people = new Map<string, { name: string; type: string }>();
  for (let i = 0; i < identityIds.length; i += 200) {
    const { data } = await admin.from("identities").select("id, tenant_id, display_name, identity_type").eq("tenant_id", tenantId).in("id", identityIds.slice(i, i + 200));
    for (const p of data ?? []) if (p.tenant_id === tenantId) people.set(p.id as string, { name: p.display_name as string, type: p.identity_type as string });
  }
  const names = await entitlementNames(tenantId, found.flatMap((f) => [...f.left, ...f.right]));
  return {
    conflicts: found
      .map((f) => ({ ...f, identityName: people.get(f.identityId)?.name ?? "Identity", identityType: people.get(f.identityId)?.type ?? "HUMAN" }))
      .sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.identityName.localeCompare(b.identityName)),
    capped: read >= CAP,
    names,
  };
}
