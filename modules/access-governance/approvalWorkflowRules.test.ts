// @vitest-environment node
import { describe, expect, it } from "vitest";
import { actionableStep, planWorkflowChain, stepsToSkipAfterApproval, type ActionableStep, type WorkflowChainInput } from "./approvalRules";
import { approversForSubject, describeLevels, levelsFor, namedReferences, validateWorkflowLevels, type WorkflowLevel } from "./approvalWorkflowRules";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const G1 = "33333333-3333-4333-8333-333333333333";
const G2 = "44444444-4444-4444-8444-444444444444";

const person = (id: string, userId: string | null = `u-${id}`, active = true) => ({ identityId: id, userId, active });
const levels = (...ls: Partial<WorkflowLevel>[]): WorkflowLevel[] => ls.map((l, i) => ({ name: `L${i + 1}`, rule: "all", minRisk: null, approvers: [{ kind: "manager" }], ...l }));
const input = (over: Partial<WorkflowChainInput> = {}): WorkflowChainInput => ({
  levels: levels({}),
  risk: "low",
  manager: person("mgr"),
  managersManager: person("mm"),
  entitlementOwner: null,
  applicationOwner: person("owner"),
  requesterUserId: "u-req",
  subjectUserId: "u-req",
  subjectIdentityType: "HUMAN",
  people: new Map([[P1, person(P1)]]),
  liveGroups: new Set([G1]),
  ...over,
});
const shape = (c: WorkflowChainInput) => planWorkflowChain(c).map((s) => [s.stage, s.approverKind, s.approverUserId ?? s.approverGroupId ?? null, s.stageRule]);

describe("validateWorkflowLevels", () => {
  it("accepts levels and normalises names, rules and risk", () => {
    expect(validateWorkflowLevels([{ approvers: [{ kind: "manager" }] }, { name: " Security ", rule: "any", minRisk: "high", approvers: [{ kind: "group", groupId: G1 }, { kind: "person", identityId: P1 }] }])).toEqual([
      { name: "Level 1", rule: "all", minRisk: null, approvers: [{ kind: "manager" }] },
      { name: "Security", rule: "any", minRisk: "high", approvers: [{ kind: "group", groupId: G1 }, { kind: "person", identityId: P1 }] },
    ]);
  });

  it("refuses what cannot run", () => {
    const bad = (raw: unknown) => expect(() => validateWorkflowLevels(raw)).toThrow();
    bad([]);
    bad(null);
    bad(Array.from({ length: 7 }, () => ({ approvers: [{ kind: "manager" }] })));
    bad([{ approvers: [] }]);
    bad([{ approvers: [{ kind: "ceo" }] }]);
    bad([{ approvers: [{ kind: "person" }] }]);
    bad([{ approvers: [{ kind: "group", groupId: "not-a-uuid" }] }]);
    bad([{ approvers: [{ kind: "manager" }, { kind: "manager" }] }]);
    bad([{ rule: "most", approvers: [{ kind: "manager" }] }]);
    bad([{ minRisk: "extreme", approvers: [{ kind: "manager" }] }]);
    bad([{ approvers: Array.from({ length: 6 }, (_, i) => ({ kind: "person", identityId: `11111111-1111-4111-8111-11111111111${i}` })) }]);
  });

  it("lists the people and groups it names, once each", () => {
    expect(namedReferences(levels({ approvers: [{ kind: "person", identityId: P1 }, { kind: "group", groupId: G1 }] }, { approvers: [{ kind: "person", identityId: P1 }] }))).toEqual({ identityIds: [P1], groupIds: [G1] });
  });
});

describe("levels by risk and subject", () => {
  it("applies a level only from its risk upwards", () => {
    const ls = levels({}, { minRisk: "high" }, { minRisk: "critical" });
    expect(levelsFor(ls, "low")).toHaveLength(1);
    expect(levelsFor(ls, "high")).toHaveLength(2);
    expect(levelsFor(ls, "critical")).toHaveLength(3);
  });

  it("asks the resource owner instead of a manager for a machine or an agent", () => {
    expect(approversForSubject([{ kind: "manager" }, { kind: "managers_manager" }, { kind: "access_managers" }], "MACHINE")).toEqual([{ kind: "resource_owner" }, { kind: "access_managers" }]);
    expect(approversForSubject([{ kind: "manager" }], "EXTERNAL")).toEqual([{ kind: "manager" }]);
  });

  it("describes each level in one line", () => {
    expect(describeLevels(levels({ rule: "any", minRisk: "high", approvers: [{ kind: "manager" }, { kind: "group", groupId: G1 }] }), { group: () => "Security" })).toEqual(["L1: manager or Security (any member) (high risk and above)"]);
  });
});

describe("planWorkflowChain", () => {
  it("runs the levels in order: manager, then a group (any), then a named person", () => {
    const c = input({ levels: levels({}, { rule: "any", approvers: [{ kind: "group", groupId: G1 }, { kind: "managers_manager" }] }, { approvers: [{ kind: "person", identityId: P1 }] }) });
    expect(shape(c)).toEqual([
      [1, "manager", "u-mgr", "all"],
      [2, "group", G1, "any"],
      [2, "managers_manager", "u-mm", "any"],
      [3, "named_approver", `u-${P1}`, "all"],
    ]);
  });

  it("skips a level below its risk, and adds an access-manager review at critical", () => {
    const ls = levels({}, { minRisk: "high", approvers: [{ kind: "application_owner" }] });
    expect(shape(input({ levels: ls }))).toEqual([[1, "manager", "u-mgr", "all"]]);
    expect(shape(input({ levels: ls, risk: "critical" })).map((s) => s[1])).toEqual(["manager", "application_owner", "access_managers"]);
  });

  it("asks each person once, at the earliest level", () => {
    const c = input({ manager: person("mgr", "u-same"), applicationOwner: person("owner", "u-same"), levels: levels({}, { approvers: [{ kind: "application_owner" }] }) });
    expect(shape(c)).toEqual([[1, "manager", "u-same", "all"]]);
  });

  it("never lets the requester or the subject approve; a missing person or group goes to access managers", () => {
    const self = planWorkflowChain(input({ levels: levels({ approvers: [{ kind: "person", identityId: P1 }] }), requesterUserId: `u-${P1}` }));
    expect(self[0]).toMatchObject({ approverKind: "access_managers" });
    expect(self[0].reason).toMatch(/made this request/);
    expect(planWorkflowChain(input({ levels: levels({ approvers: [{ kind: "person", identityId: P2 }] }) }))[0].reason).toMatch(/No named approver/);
    const gone = planWorkflowChain(input({ levels: levels({ approvers: [{ kind: "group", groupId: G2 }] }) }));
    expect(gone[0]).toMatchObject({ approverKind: "access_managers", approverUserId: null });
    expect(gone[0].approverGroupId ?? null).toBeNull();
    expect(gone[0].reason).toMatch(/group no longer exists/);
  });

  it("maps managers to the resource owner for a machine identity", () => {
    expect(shape(input({ subjectIdentityType: "MACHINE", subjectUserId: null, levels: levels({ approvers: [{ kind: "manager" }, { kind: "managers_manager" }] }) }))).toEqual([[1, "application_owner", "u-owner", "all"]]);
    expect(shape(input({ subjectIdentityType: "MACHINE", entitlementOwner: person("ent"), levels: levels({}) }))).toEqual([[1, "entitlement_owner", "u-ent", "all"]]);
  });
});

describe("deciding a group step", () => {
  const steps: ActionableStep[] = [
    { id: "g", stage: 2, status: "pending", approverKind: "group", approverUserId: null, approverGroupId: G1 },
    { id: "m", stage: 2, status: "pending", approverKind: "managers_manager", approverUserId: "u-mm" },
  ];

  it("a member of the group decides it; someone outside it does not", () => {
    expect(actionableStep(steps, 2, { userId: "u-x", canApproveAsAccessManager: false, groupIds: [G1] })?.id).toBe("g");
    expect(actionableStep(steps, 2, { userId: "u-x", canApproveAsAccessManager: false, groupIds: [G2] })).toBeNull();
    // Access managers do not decide a live group's step for it.
    expect(actionableStep(steps, 2, { userId: "u-x", canApproveAsAccessManager: true })).toBeNull();
    expect(actionableStep(steps, 1, { userId: "u-x", canApproveAsAccessManager: false, groupIds: [G1] })).toBeNull();
  });

  it("a step whose group was deleted goes to access managers", () => {
    const orphan: ActionableStep[] = [{ id: "o", stage: 1, status: "pending", approverKind: "group", approverUserId: null, approverGroupId: null }];
    expect(actionableStep(orphan, 1, { userId: "u-x", canApproveAsAccessManager: true })?.id).toBe("o");
    expect(actionableStep(orphan, 1, { userId: "u-x", canApproveAsAccessManager: false, groupIds: [G1] })).toBeNull();
  });

  it("one approval closes an 'any' level; an 'all' level waits for everyone", () => {
    const any = [
      { id: "a", stage: 2, status: "pending" as const, stageRule: "any" as const },
      { id: "b", stage: 2, status: "pending" as const, stageRule: "any" as const },
      { id: "c", stage: 3, status: "waiting" as const, stageRule: "all" as const },
    ];
    expect(stepsToSkipAfterApproval(any, any[0])).toEqual(["b"]);
    expect(stepsToSkipAfterApproval(any, { id: "c", stage: 3, stageRule: "all" })).toEqual([]);
  });
});
