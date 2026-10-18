import type { PolicyStatus } from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-22 part 1 — separation of duties over access combinations.
 * Pure (#9).
 *
 * A rule is an `rbac` rule on an `identity` policy whose condition is
 * `{ conflictingAccess: { left: entitlementId[], right: entitlementId[] } }`:
 * one identity must not hold something from the left and something from
 * the right at the same time (for example "create vendor" and "approve
 * payment"). It lives on a policy so it has the policy's status, numbered
 * versions and change history (ACCESS-P0-35); only an active policy
 * enforces. The policy's action `block` refuses the combination; any other
 * action warns: the request goes ahead, always to a person, with the
 * conflict recorded.
 */

export type AccessConflictRule = {
  ruleId: string;
  policyId: string;
  policyName: string;
  policyStatus: PolicyStatus;
  blocking: boolean;
  left: string[];
  right: string[];
  createdAt: string;
};

type PolicyRow = {
  id: string;
  tenant_id: string;
  name: string;
  status: PolicyStatus;
  action: string;
  policy_rules: { id: string; rule_type: string; condition: unknown; created_at: string }[] | null;
};

const ids = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))] : []);

/** The access conflict rules among an organization's identity policies. */
export function accessConflictRulesFrom(tenantId: string, rows: PolicyRow[]): AccessConflictRule[] {
  const out: AccessConflictRule[] = [];
  for (const policy of rows) {
    if (policy.tenant_id !== tenantId) continue;
    for (const rule of policy.policy_rules ?? []) {
      if (rule.rule_type !== "rbac") continue;
      const c = (rule.condition as { conflictingAccess?: { left?: unknown; right?: unknown } } | null)?.conflictingAccess;
      const left = ids(c?.left);
      const right = ids(c?.right);
      if (!left.length || !right.length) continue;
      out.push({ ruleId: rule.id, policyId: policy.id, policyName: policy.name, policyStatus: policy.status, blocking: policy.action === "block", left, right, createdAt: rule.created_at });
    }
  }
  return out.sort((a, b) => Number(b.policyStatus === "active") - Number(a.policyStatus === "active") || a.policyName.localeCompare(b.policyName));
}

/** Validates a new rule's two sides: entitlement ids, at least one on each side, no entitlement on both. */
export function validateConflictSides(left: unknown, right: unknown): { ok: true; left: string[]; right: string[] } | { ok: false; message: string } {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const l = ids(left);
  const r = ids(right);
  if (!l.length || !r.length) return { ok: false, message: "Choose at least one entitlement on each side." };
  if ([...l, ...r].some((x) => !UUID.test(x))) return { ok: false, message: "Entitlements are chosen by id." };
  if (l.length > 50 || r.length > 50) return { ok: false, message: "At most 50 entitlements on each side." };
  if (l.some((x) => r.includes(x))) return { ok: false, message: "An entitlement can't be on both sides." };
  return { ok: true, left: l, right: r };
}

export type AccessConflict = {
  rule: AccessConflictRule;
  /** Entitlements on each side the identity would hold. */
  leftHeld: string[];
  rightHeld: string[];
};

/**
 * Conflicts that adding `adding` to what an identity already holds would
 * create. Only conflicts the addition takes part in count: a combination
 * the identity already holds is the detective report's business, not a
 * reason to refuse something unrelated.
 */
export function findAccessConflicts(rules: AccessConflictRule[], held: Iterable<string>, adding: Iterable<string>): AccessConflict[] {
  const add = new Set(adding);
  const all = new Set([...held, ...add]);
  const out: AccessConflict[] = [];
  for (const rule of rules) {
    const leftHeld = rule.left.filter((e) => all.has(e));
    const rightHeld = rule.right.filter((e) => all.has(e));
    if (!leftHeld.length || !rightHeld.length) continue;
    const involved = leftHeld.some((e) => add.has(e)) || rightHeld.some((e) => add.has(e));
    if (involved) out.push({ rule, leftHeld, rightHeld });
  }
  return out;
}

/** Combinations an identity holds now (the detective view). */
export function heldConflicts(rules: AccessConflictRule[], held: Iterable<string>): AccessConflict[] {
  const all = new Set(held);
  return rules.flatMap((rule) => {
    const leftHeld = rule.left.filter((e) => all.has(e));
    const rightHeld = rule.right.filter((e) => all.has(e));
    return leftHeld.length && rightHeld.length ? [{ rule, leftHeld, rightHeld }] : [];
  });
}

/** The first blocking conflict wins; otherwise the warnings. */
export function conflictOutcome(conflicts: AccessConflict[]): { kind: "none" } | { kind: "block"; conflict: AccessConflict } | { kind: "warn"; conflicts: AccessConflict[] } {
  const block = conflicts.find((c) => c.rule.blocking);
  if (block) return { kind: "block", conflict: block };
  return conflicts.length ? { kind: "warn", conflicts } : { kind: "none" };
}
