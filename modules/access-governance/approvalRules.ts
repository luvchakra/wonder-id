import { createHash } from "node:crypto";
import type { RequestPolicy, RiskLevel } from "./requestRules";
import { approversForSubject, levelsFor, type WorkflowApprover, type WorkflowLevel } from "./approvalWorkflowRules";

/**
 * ACCESS-P0-19 — the approval engine's rules, pure (#9, #15): who approves
 * a request and in what order, what one approval is valid for, and what a
 * decision does to the request. The service (`approvals.ts`) does the I/O.
 *
 * - The route comes from the request policy: the subject's manager, the
 *   entitlement owner (else the application's business owner), or both —
 *   in order or at once. Critical risk adds an access-manager review.
 * - A step names one person, or is open to access managers when nobody
 *   suitable is recorded, or when the person it would name is the
 *   requester or the subject (nobody approves their own access).
 * - The same approver is asked once: a later step resolving to someone an
 *   earlier stage already asks is dropped.
 * - An approval is valid only for the exact action it saw (spec §37A.27):
 *   the fingerprint covers the tenant, request, subject, resource,
 *   privilege, duration, type and policy.
 */

export type ApproverKind = "manager" | "managers_manager" | "entitlement_owner" | "application_owner" | "package_owner" | "named_approver" | "group" | "access_managers";
export type StepStatus = "waiting" | "pending" | "approved" | "rejected" | "skipped" | "expired" | "invalidated";

export type Person = { identityId: string; userId: string | null; active: boolean } | null;

export type PlannedStep = {
  stage: number;
  approverKind: ApproverKind;
  approverIdentityId: string | null;
  approverUserId: string | null;
  reason: string | null;
  /** Approval workflows: a step any member of this group may decide. */
  approverGroupId?: string | null;
  /** Approval workflows: whether every step of the stage must approve, or any one. */
  stageRule?: "all" | "any";
};

export type ChainInput = {
  route: RequestPolicy["approval"];
  mode: RequestPolicy["approvalMode"];
  risk: RiskLevel;
  manager: Person;
  entitlementOwner: Person;
  applicationOwner: Person;
  /** ACCESS-P0-20: for a package request, its owner is "the owner". */
  packageOwner?: Person;
  isPackage?: boolean;
  requesterUserId: string;
  /** ACCESS-P0-23 part 2: whom a delegate asked for; they approve it no more than the requester does. */
  onBehalfOfUserId?: string | null;
  subjectUserId: string | null;
};

const LABEL: Record<Exclude<ApproverKind, "access_managers" | "group">, string> = {
  manager: "manager",
  managers_manager: "manager's manager",
  entitlement_owner: "entitlement owner",
  application_owner: "application owner",
  package_owner: "package owner",
  named_approver: "named approver",
};

/** One named approver, or access managers with the reason why. */
function resolve(kind: Exclude<ApproverKind, "access_managers" | "group">, person: Person, c: Pick<ChainInput, "requesterUserId" | "onBehalfOfUserId" | "subjectUserId">): Omit<PlannedStep, "stage"> {
  const label = LABEL[kind];
  const open = (reason: string): Omit<PlannedStep, "stage"> => ({ approverKind: "access_managers", approverIdentityId: person?.identityId ?? null, approverUserId: null, reason });
  if (!person) return open(`No ${label} is recorded: an access manager approves instead`);
  if (!person.active) return open(`The ${label} is not active: an access manager approves instead`);
  if (!person.userId) return open(`The ${label} cannot sign in to WonderID: an access manager approves instead`);
  if (person.userId === c.requesterUserId) return open(`The ${label} made this request: an access manager approves instead`);
  if (c.onBehalfOfUserId && person.userId === c.onBehalfOfUserId) return open(`The ${label} asked for this through a delegate: an access manager approves instead`);
  if (person.userId === c.subjectUserId) return open(`The ${label} is who the access is for: an access manager approves instead`);
  return { approverKind: kind, approverIdentityId: person.identityId, approverUserId: person.userId, reason: null };
}

/**
 * ACCESS-P0-31: a non-human identity or an AI agent has no manager, and its
 * owner is usually the requester; its access is approved by the owners of
 * the resource instead.
 */
export function routeForSubject(route: RequestPolicy["approval"], identityType: string): RequestPolicy["approval"] {
  return identityType === "HUMAN" || identityType === "EXTERNAL" ? route : "owner_approval";
}

export function planApprovalChain(c: ChainInput): PlannedStep[] {
  const manager = () => resolve("manager", c.manager, c);
  const owner = () =>
    c.isPackage
      ? resolve("package_owner", c.packageOwner ?? null, c)
      : c.entitlementOwner
        ? resolve("entitlement_owner", c.entitlementOwner, c)
        : resolve("application_owner", c.applicationOwner, c);
  const stages: Omit<PlannedStep, "stage">[][] =
    c.route === "manager_approval" ? [[manager()]] : c.route === "owner_approval" ? [[owner()]] : c.mode === "parallel" ? [[manager(), owner()]] : [[manager()], [owner()]];
  if (c.risk === "critical") stages.push([{ approverKind: "access_managers", approverIdentityId: null, approverUserId: null, reason: "Critical risk: an access manager reviews as well" }]);

  return numberStages(stages.map((steps) => ({ steps, rule: "all" as const })));
}

/** Ask each approver once, at the earliest stage that asks them; number the stages that remain. */
function numberStages(stages: { steps: Omit<PlannedStep, "stage">[]; rule: "all" | "any" }[]): PlannedStep[] {
  const seen = new Set<string>();
  const out: PlannedStep[] = [];
  for (const { steps, rule } of stages) {
    const kept = steps.filter((s) => {
      const key = s.approverUserId ?? (s.approverKind === "group" ? `group:${s.approverGroupId}` : "access_managers");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!kept.length) continue;
    const stage = out.length ? out[out.length - 1].stage + 1 : 1;
    out.push(...kept.map((s) => ({ ...s, stage, stageRule: rule })));
  }
  return out;
}

export type WorkflowChainInput = Omit<ChainInput, "route" | "mode"> & {
  levels: WorkflowLevel[];
  subjectIdentityType: string;
  managersManager: Person;
  /** People a workflow names, resolved (absent: not found). */
  people: Map<string, Person>;
  /** Groups a workflow names that still exist and are active. */
  liveGroups: Set<string>;
};

/**
 * Approval workflows: the chain a workflow gives this request. Levels that
 * apply at the request's risk run in order; each approver resolves as the
 * built-in routes do (nobody approves their own access, a missing or
 * inactive person hands the step to access managers). Critical risk still
 * adds an access-manager review.
 */
export function planWorkflowChain(c: WorkflowChainInput): PlannedStep[] {
  const owner = () =>
    c.isPackage
      ? resolve("package_owner", c.packageOwner ?? null, c)
      : c.entitlementOwner
        ? resolve("entitlement_owner", c.entitlementOwner, c)
        : resolve("application_owner", c.applicationOwner, c);
  const step = (a: WorkflowApprover): Omit<PlannedStep, "stage"> => {
    switch (a.kind) {
      case "manager":
        return resolve("manager", c.manager, c);
      case "managers_manager":
        return resolve("managers_manager", c.managersManager, c);
      case "resource_owner":
        return owner();
      case "application_owner":
        return resolve("application_owner", c.applicationOwner, c);
      case "person":
        return resolve("named_approver", c.people.get(a.identityId) ?? null, c);
      case "group":
        return c.liveGroups.has(a.groupId)
          ? { approverKind: "group", approverIdentityId: null, approverUserId: null, approverGroupId: a.groupId, reason: null }
          : { approverKind: "access_managers", approverIdentityId: null, approverUserId: null, reason: "The workflow's group no longer exists or is not active: an access manager approves instead" };
      case "access_managers":
        return { approverKind: "access_managers", approverIdentityId: null, approverUserId: null, reason: null };
    }
  };
  const stages = levelsFor(c.levels, c.risk).map((l) => ({ steps: approversForSubject(l.approvers, c.subjectIdentityType).map(step), rule: l.rule }));
  if (c.risk === "critical") stages.push({ steps: [{ approverKind: "access_managers", approverIdentityId: null, approverUserId: null, reason: "Critical risk: an access manager reviews as well" }], rule: "all" });
  return numberStages(stages);
}

export type FingerprintInput = {
  tenantId: string;
  requestId: string;
  subjectIdentityId: string;
  applicationId: string | null;
  entitlementId: string | null;
  privilegeLevel: string | null;
  durationDays: number | null;
  requestType: string;
  policyId: string | null;
  /** ACCESS-P0-20: a package request is an approval of the package as it is now. */
  packageId?: string | null;
  packageContents?: string | null;
};

/** What an approval is an approval of. Any change means it must be approved again. */
export function actionFingerprint(f: FingerprintInput): string {
  const base = [f.tenantId, f.requestId, f.subjectIdentityId, f.applicationId, f.entitlementId, f.privilegeLevel, f.durationDays, f.requestType, f.policyId];
  // Appended only for a package, so every earlier fingerprint stays as it was.
  const canonical = JSON.stringify(f.packageId ? [...base, f.packageId, f.packageContents ?? ""] : base);
  return createHash("sha256").update(canonical).digest("hex");
}

export type StepState = { id: string; stage: number; status: StepStatus };

/**
 * Where the chain stands: a rejection ends it; otherwise the lowest stage
 * with an undecided step is current; with none left, the request is
 * approved. Skipped steps count as done.
 */
export function chainOutcome(steps: StepState[]): { state: "rejected" } | { state: "approved" } | { state: "open"; stage: number } | { state: "expired" } {
  const live = steps.filter((s) => s.status !== "invalidated");
  if (live.some((s) => s.status === "rejected")) return { state: "rejected" };
  if (live.some((s) => s.status === "expired")) return { state: "expired" };
  const open = live.filter((s) => s.status === "waiting" || s.status === "pending");
  if (!open.length) return live.length ? { state: "approved" } : { state: "open", stage: 1 };
  return { state: "open", stage: Math.min(...open.map((s) => s.stage)) };
}

/** ACCESS-P0-23: `actingFor` — the members whose approvals this member decides now, by delegation. */
export type Actor = { userId: string; canApproveAsAccessManager: boolean; actingFor?: string[]; groupIds?: string[] };
export type ActionableStep = { id: string; stage: number; status: StepStatus; approverKind: ApproverKind; approverUserId: string | null; approverGroupId?: string | null };

/**
 * The step this person may decide now, if any: a pending step of the
 * current stage that names them, else one open to access managers when
 * they are one. Requester and subject never decide (checked separately,
 * and again in the database).
 */
export function actionableStep(steps: ActionableStep[], stage: number, actor: Actor): ActionableStep | null {
  const current = steps.filter((s) => s.stage === stage && s.status === "pending");
  return (
    current.find((s) => s.approverUserId === actor.userId) ??
    // ACCESS-P0-23: a step naming someone whose approvals this member holds by delegation.
    current.find((s) => s.approverUserId !== null && (actor.actingFor ?? []).includes(s.approverUserId)) ??
    // Approval workflows: a step open to a group's members; a group gone hands it to access managers.
    current.find((s) => s.approverKind === "group" && s.approverGroupId && (actor.groupIds ?? []).includes(s.approverGroupId)) ??
    (actor.canApproveAsAccessManager ? current.find((s) => s.approverKind === "access_managers" || (s.approverKind === "group" && !s.approverGroupId)) : undefined) ??
    null
  );
}

/** Approval workflows: when one step of an "any" stage approves, the stage's other open steps are no longer needed. */
export function stepsToSkipAfterApproval(steps: { id: string; stage: number; status: StepStatus; stageRule?: "all" | "any" }[], approved: { id: string; stage: number; stageRule?: "all" | "any" }): string[] {
  if (approved.stageRule !== "any") return [];
  return steps.filter((s) => s.stage === approved.stage && s.id !== approved.id && (s.status === "pending" || s.status === "waiting")).map((s) => s.id);
}

/** When a pending step runs out of time: escalate a named step once, else expire the request. */
export function timeoutAction(step: { approverKind: ApproverKind; escalatedAt: string | null }, onTimeout: RequestPolicy["onTimeout"]): "escalate" | "expire" {
  return onTimeout === "escalate" && step.approverKind !== "access_managers" && !step.escalatedAt ? "escalate" : "expire";
}

export function dueAt(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}
