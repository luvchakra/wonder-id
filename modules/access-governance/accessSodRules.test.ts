import { describe, expect, it } from "vitest";
import { accessConflictRulesFrom, conflictOutcome, findAccessConflicts, heldConflicts, validateConflictSides } from "./accessSodRules";

const A = "11111111-0000-0000-0000-00000000000a"; // create vendor
const B = "11111111-0000-0000-0000-00000000000b"; // approve payment
const C = "11111111-0000-0000-0000-00000000000c"; // unrelated
const D = "11111111-0000-0000-0000-00000000000d"; // also on the left

function policy(id: string, action: string, status: "active" | "draft", condition: unknown, tenant = "t1") {
  return { id, tenant_id: tenant, name: `Policy ${id}`, status, action, policy_rules: [{ id: `r-${id}`, rule_type: "rbac", condition, created_at: "2026-10-18T00:00:00Z" }] };
}

describe("ACCESS-P0-22: access that must not be combined", () => {
  const block = policy("p1", "block", "active", { conflictingAccess: { left: [A, D], right: [B] } });
  const warn = policy("p2", "flag", "active", { conflictingAccess: { left: [C], right: [B] } });

  it("reads conflict rules from identity policies, ignoring process SoD rules and other organizations", () => {
    const rules = accessConflictRulesFrom("t1", [
      block,
      warn,
      policy("p3", "block", "active", { conflictingActions: ["access.request_submitted", "access.request_approved"] }),
      policy("p4", "block", "active", { conflictingAccess: { left: [A], right: [B] } }, "t2"),
      policy("p5", "block", "active", { conflictingAccess: { left: [A], right: [] } }),
    ]);
    expect(rules.map((r) => [r.policyId, r.blocking])).toEqual([
      ["p1", true],
      ["p2", false],
    ]);
  });

  it("finds the conflict the new access takes part in, whichever side it is on", () => {
    const rules = accessConflictRulesFrom("t1", [block]);
    expect(findAccessConflicts(rules, [A], [B])).toHaveLength(1);
    expect(findAccessConflicts(rules, [B], [D])[0]).toMatchObject({ leftHeld: [D], rightHeld: [B] });
    // Both sides arriving together (one role that contains both) is a conflict too.
    expect(findAccessConflicts(rules, [], [A, B])).toHaveLength(1);
    expect(findAccessConflicts(rules, [A], [C])).toEqual([]);
    expect(findAccessConflicts(rules, [], [A])).toEqual([]);
  });

  it("does not refuse unrelated access because of a combination already held", () => {
    const rules = accessConflictRulesFrom("t1", [block]);
    expect(findAccessConflicts(rules, [A, B], [C])).toEqual([]);
    expect(heldConflicts(rules, [A, B, C])).toHaveLength(1);
  });

  it("a blocking rule wins over warnings", () => {
    const rules = accessConflictRulesFrom("t1", [warn, block]);
    const outcome = conflictOutcome(findAccessConflicts(rules, [A, C], [B]));
    expect(outcome.kind).toBe("block");
    expect(conflictOutcome(findAccessConflicts(accessConflictRulesFrom("t1", [warn]), [C], [B]))).toMatchObject({ kind: "warn" });
    expect(conflictOutcome([])).toEqual({ kind: "none" });
  });

  it("validates a rule's two sides", () => {
    expect(validateConflictSides([A], [B])).toEqual({ ok: true, left: [A], right: [B] });
    expect(validateConflictSides([A, A], [B])).toEqual({ ok: true, left: [A], right: [B] });
    expect(validateConflictSides([], [B]).ok).toBe(false);
    expect(validateConflictSides([A], [A]).ok).toBe(false);
    expect(validateConflictSides(["not-an-id"], [B]).ok).toBe(false);
    expect(validateConflictSides(Array.from({ length: 51 }, (_, i) => `11111111-0000-0000-0000-${String(i).padStart(12, "0")}`), [B]).ok).toBe(false);
  });
});
