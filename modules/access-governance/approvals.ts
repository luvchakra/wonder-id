import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { runAfterResponse } from "@/lib/shared/afterResponse";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessRequest } from "@/lib/shared/types/access-governance";
import { getIdentity, getIdentityForUser, getIdentityNames } from "@/modules/agent-identity/service";
import { toAccessRequest } from "./mappers";
import { assignApprovedPackageRequest, loadPackageEntitlements, loadPackageForApproval } from "./packages";
import { checkAccessCombination } from "./accessSod";
import { assessRisk, type RequestPolicy } from "./requestRules";
import {
  actionFingerprint,
  actionableStep,
  chainOutcome,
  dueAt,
  planApprovalChain,
  planWorkflowChain,
  routeForSubject,
  stepsToSkipAfterApproval,
  timeoutAction,
  type ApproverKind,
  type Person,
  type StepStatus,
} from "./approvalRules";
import { pendRequest } from "./pendingGrants";
import { notifyApprovers } from "./approvalLinks";
import { approvalsActingFor } from "./delegations";
import { validateWorkflowLevels, namedReferences, type WorkflowLevel } from "./approvalWorkflowRules";

/**
 * ACCESS-P0-19 — the approval engine for requests made through the
 * catalog (ACCESS-P0-18). Rules are in `approvalRules.ts`; this does the
 * I/O. Steps and request transitions are written with the service role,
 * always filtered by the tenant resolved from the session (or, for the
 * timeout sweep, by each step's own tenant), conditional on the state read
 * so that two deciders cannot both win; the database refuses a decision by
 * the requester or subject (0093's trigger) whatever path writes it. Every
 * transition is audited with the approval record of spec §37A.27.
 *
 * Agent requests (ACCESS-P0-06) keep their single-decision path.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_ORDER: ApproverKind[] = ["manager", "managers_manager", "entitlement_owner", "application_owner", "package_owner", "named_approver", "group", "access_managers"];
const LIVE: StepStatus[] = ["waiting", "pending", "approved", "rejected", "skipped", "expired"];
/** With the policy gone, the strictest route applies: fail safe, never looser. */
const FALLBACK_POLICY = { id: null, approval: "manager_and_owner", approvalMode: "sequential", approvalTimeoutDays: 5, onTimeout: "escalate", updatedAt: null, workflow: null } as const;

export type ApprovalStep = {
  id: string;
  requestId: string;
  stage: number;
  approverKind: ApproverKind;
  approverIdentityId: string | null;
  approverUserId: string | null;
  /** Approval workflows: a step any member of this group decides. */
  approverGroupId: string | null;
  stageRule: "all" | "any";
  reason: string | null;
  status: StepStatus;
  actionFingerprint: string;
  dueAt: string | null;
  escalatedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  deciderRoles: string[] | null;
  comment: string | null;
  createdAt: string;
};

function toStep(r: Record<string, unknown>): ApprovalStep {
  return {
    id: r.id as string,
    requestId: r.request_id as string,
    stage: r.stage as number,
    approverKind: r.approver_kind as ApproverKind,
    approverIdentityId: (r.approver_identity_id as string | null) ?? null,
    approverUserId: (r.approver_user_id as string | null) ?? null,
    approverGroupId: (r.approver_group_id as string | null) ?? null,
    stageRule: r.stage_rule === "any" ? "any" : "all",
    reason: (r.reason as string | null) ?? null,
    status: r.status as StepStatus,
    actionFingerprint: r.action_fingerprint as string,
    dueAt: (r.due_at as string | null) ?? null,
    escalatedAt: (r.escalated_at as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    deciderRoles: (r.decider_roles as string[] | null) ?? null,
    comment: (r.comment as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

type RequestRow = Record<string, unknown> & { id: string; tenant_id: string; status: string; requested_by: string; requested_on_behalf_of?: string | null; subject_identity_id: string | null };
type PolicyTerms = {
  id: string | null;
  approval: RequestPolicy["approval"];
  approvalMode: RequestPolicy["approvalMode"];
  approvalTimeoutDays: number;
  onTimeout: RequestPolicy["onTimeout"];
  updatedAt: string | null;
  /** Approval workflows: the workflow the policy names, read now. */
  workflow: { id: string; version: number; levels: WorkflowLevel[] } | null;
};

async function loadPolicyTerms(tenantId: string, policyId: string | null, packageId?: string | null): Promise<PolicyTerms> {
  // ACCESS-P0-20: a package request follows the package's own policy.
  if (packageId) {
    const { terms } = await loadPackageForApproval(tenantId, packageId);
    return { id: null, ...terms, workflow: null };
  }
  if (!policyId) return FALLBACK_POLICY;
  const { data, error } = await supabaseServiceRole()
    .from("access_request_policies")
    .select("id, approval, approval_mode, approval_timeout_days, on_timeout, updated_at, approval_workflow_id")
    .eq("tenant_id", tenantId)
    .eq("id", policyId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return FALLBACK_POLICY;
  // Approval workflows: a policy that names one is approved by it. A workflow that cannot be read
  // or is no longer valid is never permission: the strictest built-in route applies instead.
  let workflow: PolicyTerms["workflow"] = null;
  if (data.approval_workflow_id) {
    const { data: wf, error: wfError } = await supabaseServiceRole().from("approval_workflows").select("id, tenant_id, version, levels, status").eq("tenant_id", tenantId).eq("id", data.approval_workflow_id as string).maybeSingle();
    if (wfError) throw new ApiError(500, "QUERY_FAILED", wfError.message);
    if (!wf || wf.tenant_id !== tenantId || wf.status !== "active") return { ...FALLBACK_POLICY, id: data.id as string, approvalTimeoutDays: data.approval_timeout_days as number, updatedAt: data.updated_at as string };
    try {
      workflow = { id: wf.id as string, version: wf.version as number, levels: validateWorkflowLevels(wf.levels) };
    } catch {
      return { ...FALLBACK_POLICY, id: data.id as string, approvalTimeoutDays: data.approval_timeout_days as number, updatedAt: data.updated_at as string };
    }
  }
  return {
    workflow,
    id: data.id as string,
    approval: data.approval as PolicyTerms["approval"],
    approvalMode: data.approval_mode as PolicyTerms["approvalMode"],
    approvalTimeoutDays: data.approval_timeout_days as number,
    onTimeout: data.on_timeout as PolicyTerms["onTimeout"],
    updatedAt: data.updated_at as string,
  };
}

/** What the request is now: resource, privilege and risk, read fresh. */
async function loadSubjectMatter(tenantId: string, req: RequestRow) {
  if (req.access_package_id) {
    const pkg = await loadPackageForApproval(tenantId, req.access_package_id as string);
    return { risk: pkg.risk, privilegeLevel: null, entitlementOwnerId: null, applicationOwnerId: null, packageOwnerId: pkg.ownerIdentityId, packageDigest: pkg.digest };
  }
  const admin = supabaseServiceRole();
  const [app, ent] = await Promise.all([
    admin.from("applications").select("id, risk_level, data_classification, business_owner_identity_id").eq("tenant_id", tenantId).eq("id", req.application_id as string).maybeSingle(),
    req.entitlement_id
      ? admin.from("entitlements").select("id, privilege_level, data_classification, owner_identity_id").eq("tenant_id", tenantId).eq("id", req.entitlement_id as string).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (app.error || ent.error) throw new ApiError(500, "QUERY_FAILED", (app.error ?? ent.error)!.message);
  if (!app.data) throw new ApiError(409, "RESOURCE_GONE", "The application of this request no longer exists");
  if (req.entitlement_id && !ent.data) throw new ApiError(409, "RESOURCE_GONE", "The entitlement of this request no longer exists");
  const risk = assessRisk({
    privilegeLevel: ent.data?.privilege_level as string | undefined,
    dataClassification: ent.data?.data_classification as string | undefined,
    appRiskLevel: app.data.risk_level as string | undefined,
    appDataClassification: app.data.data_classification as string | undefined,
  });
  return {
    risk,
    privilegeLevel: (ent.data?.privilege_level as string | null) ?? null,
    entitlementOwnerId: (ent.data?.owner_identity_id as string | null) ?? null,
    applicationOwnerId: (app.data.business_owner_identity_id as string | null) ?? null,
    packageOwnerId: null as string | null,
    packageDigest: null as string | null,
  };
}

function fingerprintOf(tenantId: string, req: RequestRow, matter: { privilegeLevel: string | null; packageDigest: string | null }, policyId: string | null): string {
  return actionFingerprint({
    tenantId,
    requestId: req.id,
    subjectIdentityId: req.subject_identity_id as string,
    applicationId: (req.application_id as string | null) ?? null,
    entitlementId: (req.entitlement_id as string | null) ?? null,
    privilegeLevel: matter.privilegeLevel,
    durationDays: (req.duration_days as number | null) ?? null,
    requestType: req.request_type as string,
    policyId,
    packageId: (req.access_package_id as string | null) ?? null,
    packageContents: matter.packageDigest,
  });
}

async function person(tenantId: string, identityId: string | null): Promise<Person> {
  if (!identityId) return null;
  const i = await getIdentity(tenantId, identityId);
  return i ? { identityId: i.id, userId: i.userId, active: i.status === "active" } : null;
}

async function readSteps(tenantId: string, requestId: string): Promise<ApprovalStep[]> {
  const { data, error } = await supabaseServiceRole()
    .from("access_request_approvals")
    .select()
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId)
    .order("stage")
    .order("created_at");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toStep);
}

/** Approval workflows: the manager's manager, the named people and the live groups a workflow needs. */
async function workflowPeople(tenantId: string, levels: WorkflowLevel[], managerId: string | null) {
  const refs = namedReferences(levels);
  const managerIdentity = managerId ? await getIdentity(tenantId, managerId) : null;
  const [managersManager, people, groups] = await Promise.all([
    person(tenantId, managerIdentity?.managerIdentityId ?? null),
    Promise.all(refs.identityIds.map(async (id) => [id, await person(tenantId, id)] as const)),
    refs.groupIds.length
      ? supabaseServiceRole().from("groups").select("id, tenant_id, status").eq("tenant_id", tenantId).in("id", refs.groupIds)
      : Promise.resolve({ data: [] as { id: string; tenant_id: string; status: string }[], error: null }),
  ]);
  if (groups.error) throw new ApiError(500, "QUERY_FAILED", groups.error.message);
  const liveGroups = new Set((groups.data ?? []).filter((g) => g.tenant_id === tenantId && g.status === "active").map((g) => g.id as string));
  return { managersManager, people: new Map(people), liveGroups };
}

/** The active groups a member belongs to, in this tenant (approval workflows). */
async function memberGroupIds(tenantId: string, userId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole().from("group_members").select("group_id, tenant_id, groups!inner(status)").eq("tenant_id", tenantId).eq("user_id", userId).limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as unknown as { group_id: string; tenant_id: string; groups: { status: string } }[]).filter((m) => m.tenant_id === tenantId && m.groups?.status === "active").map((m) => m.group_id);
}

/**
 * Builds the chain for a waiting request under its current terms: resolves
 * the approvers, opens stage 1 and records the fingerprint. Runs as the
 * signed-in user for identity reads (RLS) and the service role for writes.
 */
async function buildChain(tenantId: string, req: RequestRow, now: Date): Promise<{ steps: ApprovalStep[]; fingerprint: string; risk: string }> {
  const [terms, matter, subject] = await Promise.all([
    loadPolicyTerms(tenantId, (req.request_policy_id as string | null) ?? null, (req.access_package_id as string | null) ?? null),
    loadSubjectMatter(tenantId, req),
    getIdentity(tenantId, req.subject_identity_id as string),
  ]);
  if (!subject) throw new ApiError(409, "SUBJECT_GONE", "The person this request is for no longer exists");
  // ACCESS-P0-31: a non-human subject's request goes to the resource's owners (routeForSubject).
  const managerId = subject.managerIdentityId;
  const [manager, entitlementOwner, applicationOwner, packageOwner] = await Promise.all([
    person(tenantId, managerId),
    person(tenantId, matter.entitlementOwnerId),
    person(tenantId, matter.applicationOwnerId),
    person(tenantId, matter.packageOwnerId),
  ]);
  const common = {
    risk: matter.risk,
    manager,
    entitlementOwner,
    applicationOwner,
    packageOwner,
    isPackage: Boolean(req.access_package_id),
    requesterUserId: req.requested_by,
    onBehalfOfUserId: (req.requested_on_behalf_of as string | null | undefined) ?? null,
    subjectUserId: subject.userId,
  };
  const plan = terms.workflow
    ? planWorkflowChain({ ...common, levels: terms.workflow.levels, subjectIdentityType: subject.identityType, ...(await workflowPeople(tenantId, terms.workflow.levels, managerId)) })
    : planApprovalChain({ ...common, route: routeForSubject(terms.approval, subject.identityType), mode: terms.approvalMode });
  const fingerprint = fingerprintOf(tenantId, req, matter, terms.id);
  const due = dueAt(now, terms.approvalTimeoutDays);
  const admin = supabaseServiceRole();
  const { error } = await admin.from("access_request_approvals").insert(
    plan.map((s) => ({
      tenant_id: tenantId,
      request_id: req.id,
      stage: s.stage,
      approver_kind: s.approverKind,
      approver_identity_id: s.approverIdentityId,
      approver_user_id: s.approverUserId,
      approver_group_id: s.approverGroupId ?? null,
      stage_rule: s.stageRule ?? "all",
      reason: s.reason,
      status: s.stage === 1 ? "pending" : "waiting",
      action_fingerprint: fingerprint,
      policy_version: terms.updatedAt,
      due_at: s.stage === 1 ? due : null,
    })),
  );
  // 23505: another request built this same chain a moment ago; use theirs.
  if (error && error.code !== "23505") throw new ApiError(500, "CREATE_FAILED", error.message);
  const { error: reqError } = await admin
    .from("access_requests")
    .update({ action_fingerprint: fingerprint, approval_stage: 1, risk_level: matter.risk })
    .eq("tenant_id", tenantId)
    .eq("id", req.id)
    .eq("status", "pending");
  if (reqError) throw new ApiError(500, "UPDATE_FAILED", reqError.message);
  return { steps: (await readSteps(tenantId, req.id)).filter((s) => s.status !== "invalidated"), fingerprint, risk: matter.risk };
}

/** Called once a catalog request is stored as waiting: opens its chain. */
export async function startApprovalChain(tenantId: string, actorId: string, request: AccessRequest): Promise<ApprovalStep[]> {
  const { data, error } = await supabaseServiceRole().from("access_requests").select().eq("tenant_id", tenantId).eq("id", request.id).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.status !== "pending" || !data.subject_identity_id) return [];
  const { steps, fingerprint } = await buildChain(tenantId, data as RequestRow, new Date());
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.approval_chain_started",
    objectType: "access_request",
    objectId: request.id,
    outcome: "success",
    metadata: { actionFingerprint: fingerprint, steps: steps.map((s) => ({ stage: s.stage, approverKind: s.approverKind, approverIdentityId: s.approverIdentityId, reason: s.reason })) },
  });
  // ACCESS-P0-38 part 2: the first stage's approvers hear of it, with a link of their own.
  const open = steps.filter((s) => s.status === "pending").map((s) => s.stage);
  if (open.length) runAfterResponse(() => notifyApprovers(tenantId, request.id, Math.min(...open)));
  return steps;
}

/**
 * The chain of a waiting request, checked against what the request is now.
 * No chain yet (a request from before the engine, or one whose start
 * failed) → built now. A changed fingerprint → every step is invalidated,
 * the chain is rebuilt and the caller is told (409): an approval is valid
 * only for the exact action it saw.
 */
async function currentChain(tenantId: string, actorId: string, req: RequestRow): Promise<ApprovalStep[]> {
  const live = (await readSteps(tenantId, req.id)).filter((s) => LIVE.includes(s.status));
  if (!live.length) return (await buildChain(tenantId, req, new Date())).steps;

  const [terms, matter] = await Promise.all([
    loadPolicyTerms(tenantId, (req.request_policy_id as string | null) ?? null, (req.access_package_id as string | null) ?? null),
    loadSubjectMatter(tenantId, req),
  ]);
  const now = fingerprintOf(tenantId, req, matter, terms.id);
  if (live.every((s) => s.actionFingerprint === now)) return live;

  const { data: invalidated, error } = await supabaseServiceRole()
    .from("access_request_approvals")
    .update({ status: "invalidated" })
    .eq("tenant_id", tenantId)
    .eq("request_id", req.id)
    .neq("action_fingerprint", now)
    .in("status", LIVE)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  const rebuilt = await buildChain(tenantId, req, new Date());
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.approvals_invalidated",
    objectType: "access_request",
    objectId: req.id,
    outcome: "success",
    metadata: { previousFingerprint: live[0].actionFingerprint, actionFingerprint: now, invalidatedSteps: (invalidated ?? []).length, risk: rebuilt.risk },
  });
  throw new ApiError(409, "APPROVAL_INVALIDATED", "The request changed since approval started (resource, privilege, duration or policy), so it needs approval again");
}

async function finishRequest(tenantId: string, requestId: string, status: "approved" | "rejected" | "expired", deciderId: string | null, now: string) {
  const admin = supabaseServiceRole();
  await admin.from("access_request_approvals").update({ status: "skipped" }).eq("tenant_id", tenantId).eq("request_id", requestId).in("status", ["waiting", "pending"]);
  const { data, error } = await admin
    .from("access_requests")
    .update({ status, decided_by: deciderId, decided_at: now, approval_stage: null })
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  return data;
}

async function openStage(tenantId: string, requestId: string, stage: number, timeoutDays: number, now: Date) {
  const admin = supabaseServiceRole();
  const { error } = await admin
    .from("access_request_approvals")
    .update({ status: "pending", due_at: dueAt(now, timeoutDays) })
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId)
    .eq("stage", stage)
    .eq("status", "waiting");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await admin.from("access_requests").update({ approval_stage: stage }).eq("tenant_id", tenantId).eq("id", requestId).eq("status", "pending");
  // ACCESS-P0-38 part 2: the next stage's approvers hear of it.
  runAfterResponse(() => notifyApprovers(tenantId, requestId, stage));
}

export type ApproverActor = { userId: string; roles: string[]; canApproveAsAccessManager: boolean };

/**
 * One approver's decision on a catalog request. The actor must be the
 * person a pending step of the current stage names, or an access manager
 * for a step open to access managers; the requester and the person the
 * access is for never decide. Approving the last step approves the
 * request; any rejection rejects it.
 */
export async function decideApprovalStep(
  tenantId: string,
  actor: ApproverActor,
  requestId: string,
  decision: unknown,
  comment?: unknown,
): Promise<{ request: AccessRequest; step: ApprovalStep }> {
  if (decision !== "approved" && decision !== "rejected") throw new ApiError(400, "VALIDATION_FAILED", "decision: approved or rejected");
  const note = typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 2000) : null;
  if (!UUID_RE.test(requestId)) throw new ApiError(404, "REQUEST_NOT_FOUND");
  const admin = supabaseServiceRole();
  const { data: req, error } = await admin.from("access_requests").select().eq("tenant_id", tenantId).eq("id", requestId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!req) throw new ApiError(404, "REQUEST_NOT_FOUND");
  const row = req as RequestRow;
  if (!row.subject_identity_id) throw new ApiError(409, "NOT_CATALOG_REQUEST", "An agent's request is decided on its own path");
  if (row.status !== "pending") throw new ApiError(409, "INVALID_TRANSITION", `The request is ${row.status}, not waiting`);

  const subject = await getIdentity(tenantId, row.subject_identity_id);
  if (actor.userId === row.requested_by || actor.userId === row.requested_on_behalf_of || (subject?.userId && actor.userId === subject.userId)) {
    throw new ApiError(409, "SELF_APPROVAL", "Nobody approves or rejects a request they made or that is for them");
  }

  const steps = await currentChain(tenantId, actor.userId, row);
  const outcome = chainOutcome(steps);
  if (outcome.state !== "open") throw new ApiError(409, "INVALID_TRANSITION", "The approval chain is already complete");
  // ACCESS-P0-23: whose approvals this member also holds now, by delegation.
  const [actingFor, groupIds] = await Promise.all([approvalsActingFor(tenantId, actor.userId), memberGroupIds(tenantId, actor.userId)]);
  const step = actionableStep(steps, outcome.stage, { ...actor, actingFor, groupIds });
  const onBehalfOf = step && step.approverUserId && step.approverUserId !== actor.userId ? step.approverUserId : null;
  if (!step) throw new ApiError(403, "NOT_AN_APPROVER", "You are not an approver of this request at its current stage");
  // An access-manager review is a second pair of eyes: not someone who
  // already approved an earlier stage of this request.
  if (step.approverKind === "access_managers" && step.approverUserId === null && steps.some((s) => s.decidedBy === actor.userId)) {
    throw new ApiError(409, "ALREADY_DECIDED", "You already decided an earlier stage of this request; another access manager must review it");
  }
  // Approval workflows: a group's level is someone else's look too, not a second vote by an earlier approver.
  if (step.approverKind === "group" && steps.some((s) => s.decidedBy === actor.userId)) {
    throw new ApiError(409, "ALREADY_DECIDED", "You already decided an earlier level of this request; another member of the group must decide this one");
  }

  // ACCESS-P0-22: what the identity holds may have changed since the request was made (another request
  // approved meanwhile); an approval that would now give a forbidden combination is refused. Reject it instead.
  if (decision === "approved" && (row.request_type ?? "grant") === "grant") {
    const adding = row.access_package_id
      ? ((await loadPackageEntitlements(tenantId, row.access_package_id as string)) ?? [])
      : row.entitlement_id
        ? [row.entitlement_id as string]
        : [];
    await checkAccessCombination(tenantId, actor.userId, { identityId: row.subject_identity_id, agentId: (row.agent_id as string | null) ?? subject?.agentId ?? null }, adding, { kind: "approval", objectType: "access_request", objectId: requestId });
  }

  const now = new Date();
  const { data: decided, error: decideError } = await admin
    .from("access_request_approvals")
    .update({ status: decision, decided_by: actor.userId, decided_on_behalf_of: onBehalfOf, decided_at: now.toISOString(), decider_roles: actor.roles, comment: note })
    .eq("tenant_id", tenantId)
    .eq("id", step.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (decideError?.code === "23514") throw new ApiError(409, "SELF_APPROVAL", "Nobody approves or rejects a request they made or that is for them");
  if (decideError) throw new ApiError(500, "UPDATE_FAILED", decideError.message);
  if (!decided) throw new ApiError(409, "CONFLICT", "This step was decided meanwhile; reload");
  const decidedStep = toStep(decided);

  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: `access.approval_step_${decision}`,
    objectType: "access_request",
    objectId: requestId,
    outcome: "success",
    // The approval record of spec §37A.27.
    metadata: {
      stepId: step.id,
      stage: step.stage,
      approverKind: step.approverKind,
      actionFingerprint: decidedStep.actionFingerprint,
      subjectIdentityId: row.subject_identity_id,
      applicationId: row.application_id ?? null,
      entitlementId: row.entitlement_id ?? null,
      packageId: row.access_package_id ?? null,
      durationDays: row.duration_days ?? null,
      policyId: row.request_policy_id ?? null,
      policyVersion: decided.policy_version ?? null,
      approverRoles: actor.roles,
      onBehalfOf,
    },
    // WID-H07: the comment stays on the approval step (access_request_approvals.comment).
    typedText: { comment: note },
  });

  // Approval workflows: one approval decides an "any one" level; its other open steps are skipped.
  if (decision === "approved") {
    const skip = stepsToSkipAfterApproval(steps, { id: step.id, stage: step.stage, stageRule: (steps.find((x) => x.id === step.id) as ApprovalStep | undefined)?.stageRule });
    if (skip.length) await admin.from("access_request_approvals").update({ status: "skipped" }).eq("tenant_id", tenantId).in("id", skip).in("status", ["pending", "waiting"]);
  }

  // Advance the chain from what is stored now.
  const after = (await readSteps(tenantId, requestId)).filter((s) => LIVE.includes(s.status));
  const next = chainOutcome(after);
  let final = null as Record<string, unknown> | null;
  if (next.state === "rejected" || next.state === "approved") {
    final = await finishRequest(tenantId, requestId, next.state, actor.userId, now.toISOString());
    if (final) {
      await writeAudit({
        tenantId,
        actorId: actor.userId,
        actorType: "user",
        action: `access.request_${next.state}`,
        objectType: "access_request",
        objectId: requestId,
        outcome: "success",
        metadata: { subjectIdentityId: row.subject_identity_id, packageId: row.access_package_id ?? null, actionFingerprint: decidedStep.actionFingerprint, stages: Math.max(...after.map((s) => s.stage)) },
      });
      // ACCESS-P0-28: an approved request for an entitlement becomes its pending grant.
      if (next.state === "approved" && !row.access_package_id) await pendRequest(tenantId, requestId);
      // ACCESS-P0-20: an approved package request becomes its assignment.
      // If that fails, the request stays approved and the failure is audited.
      if (next.state === "approved" && row.access_package_id) {
        try {
          await assignApprovedPackageRequest(tenantId, actor.userId, requestId);
        } catch (err) {
          await writeAudit({ tenantId, actorId: actor.userId, actorType: "user", action: "access.package_assigned", objectType: "access_package", objectId: row.access_package_id as string, outcome: "failure", metadata: { requestId, error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
        }
      }
    }
  } else if (next.state === "open" && next.stage > outcome.stage) {
    const terms = await loadPolicyTerms(tenantId, (row.request_policy_id as string | null) ?? null, (row.access_package_id as string | null) ?? null);
    await openStage(tenantId, requestId, next.stage, terms.approvalTimeoutDays, now);
  }
  const { data: fresh } = await admin.from("access_requests").select().eq("tenant_id", tenantId).eq("id", requestId).single();
  return { request: toAccessRequest(fresh ?? final ?? req), step: decidedStep };
}

/**
 * Steps past their due time: a named step escalates once to access
 * managers (when the policy says escalate); otherwise the request expires.
 * For one tenant (from a signed-in page) or every tenant (the cron job);
 * every write is filtered by the step's own tenant.
 */
export async function sweepApprovalTimeouts(tenantId: string | null, now = new Date()): Promise<{ escalated: number; expired: number }> {
  const admin = supabaseServiceRole();
  let query = admin
    .from("access_request_approvals")
    // Only steps of requests still waiting (filtered in the database): a
    // cancelled or closed request's steps must never crowd out real timeouts.
    .select("id, tenant_id, request_id, stage, approver_kind, escalated_at, access_requests!inner(request_policy_id, access_package_id, status, subject_identity_id)")
    .eq("status", "pending")
    .eq("access_requests.status", "pending")
    .lt("due_at", now.toISOString())
    .order("due_at")
    .limit(200);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let escalated = 0;
  let expired = 0;
  // One read per policy, not per overdue step.
  const termsByPolicy = new Map<string, ReturnType<typeof loadPolicyTerms>>();
  for (const s of data ?? []) {
    const stepTenant = s.tenant_id as string;
    const req = s.access_requests as unknown as { request_policy_id: string | null; access_package_id: string | null; status: string; subject_identity_id: string | null } | null;
    if (!req || req.status !== "pending") continue;
    const termsKey = `${stepTenant}:${req.request_policy_id ?? ""}:${req.access_package_id ?? ""}`;
    if (!termsByPolicy.has(termsKey)) termsByPolicy.set(termsKey, loadPolicyTerms(stepTenant, req.request_policy_id, req.access_package_id));
    const terms = await termsByPolicy.get(termsKey)!;
    const action = timeoutAction({ approverKind: s.approver_kind as ApproverKind, escalatedAt: (s.escalated_at as string | null) ?? null }, terms.onTimeout);
    if (action === "escalate") {
      const { data: done } = await admin
        .from("access_request_approvals")
        .update({
          approver_kind: "access_managers",
          approver_user_id: null,
          approver_group_id: null,
          escalated_at: now.toISOString(),
          due_at: dueAt(now, terms.approvalTimeoutDays),
          reason: `No decision within ${terms.approvalTimeoutDays} day${terms.approvalTimeoutDays === 1 ? "" : "s"}: escalated to access managers`,
        })
        .eq("tenant_id", stepTenant)
        .eq("id", s.id)
        .eq("status", "pending")
        .is("escalated_at", null)
        .select("id")
        .maybeSingle();
      if (!done) continue;
      escalated += 1;
      await writeAudit({ tenantId: stepTenant, actorId: null, actorType: "system", action: "access.approval_step_escalated", objectType: "access_request", objectId: s.request_id as string, outcome: "success", metadata: { stepId: s.id, stage: s.stage, from: s.approver_kind } });
    } else {
      const { data: done } = await admin.from("access_request_approvals").update({ status: "expired" }).eq("tenant_id", stepTenant).eq("id", s.id).eq("status", "pending").select("id").maybeSingle();
      if (!done) continue;
      const finished = await finishRequest(stepTenant, s.request_id as string, "expired", null, now.toISOString());
      if (finished) expired += 1;
      await writeAudit({ tenantId: stepTenant, actorId: null, actorType: "system", action: "access.request_expired", objectType: "access_request", objectId: s.request_id as string, outcome: "success", metadata: { stepId: s.id, stage: s.stage, approverKind: s.approver_kind, reason: "approval timed out" } });
    }
  }
  return { escalated, expired };
}

export type ApprovalView = ApprovalStep & { approverName: string | null; decidedByName: string | null; approverGroupName: string | null };

/** A request with its approval chain (all steps, including invalidated ones, for the record). */
export async function getRequestWithApprovals(tenantId: string, requestId: string): Promise<{ request: AccessRequest; steps: ApprovalView[]; subjectName: string | null; applicationName: string | null; entitlementName: string | null; packageName: string | null } | null> {
  if (!UUID_RE.test(requestId)) return null;
  const supabase = await supabaseServer();
  const [{ data: req, error }, { data: rows, error: stepError }] = await Promise.all([
    supabase.from("access_requests").select("*, applications(name, display_name), entitlements(name), access_packages(name)").eq("tenant_id", tenantId).eq("id", requestId).maybeSingle(),
    supabase.from("access_request_approvals").select().eq("tenant_id", tenantId).eq("request_id", requestId).order("created_at").order("stage"),
  ]);
  if (error || stepError) throw new ApiError(500, "QUERY_FAILED", (error ?? stepError)!.message);
  if (!req) return null;
  // Stage order, then a fixed order within a stage (steps opened together share a timestamp).
  const steps = (rows ?? []).map(toStep).sort((a, b) => a.stage - b.stage || KIND_ORDER.indexOf(a.approverKind) - KIND_ORDER.indexOf(b.approverKind) || a.createdAt.localeCompare(b.createdAt));
  const deciders = [...new Set(steps.map((s) => s.decidedBy).filter((u): u is string => Boolean(u)))];
  const [names, deciderIdentities] = await Promise.all([
    getIdentityNames(tenantId, [...steps.map((s) => s.approverIdentityId), req.subject_identity_id].filter((x): x is string => Boolean(x))),
    Promise.all(deciders.map(async (u) => [u, await getIdentityForUser(tenantId, u)] as const)),
  ]);
  const deciderName = new Map(deciderIdentities.map(([u, i]) => [u, i?.displayName ?? null]));
  const groupIds = [...new Set(steps.map((s) => s.approverGroupId).filter((g): g is string => Boolean(g)))];
  const { data: groupRows } = groupIds.length ? await supabase.from("groups").select("id, name").eq("tenant_id", tenantId).in("id", groupIds) : { data: [] as { id: string; name: string }[] };
  const groupName = new Map((groupRows ?? []).map((g) => [g.id as string, g.name as string]));
  const app = req.applications as { name: string; display_name: string | null } | null;
  return {
    request: toAccessRequest(req),
    steps: steps.map((s) => ({ ...s, approverName: s.approverIdentityId ? (names.get(s.approverIdentityId)?.displayName ?? null) : null, decidedByName: s.decidedBy ? (deciderName.get(s.decidedBy) ?? null) : null, approverGroupName: s.approverGroupId ? (groupName.get(s.approverGroupId) ?? null) : null })),
    subjectName: req.subject_identity_id ? (names.get(req.subject_identity_id)?.displayName ?? null) : null,
    applicationName: app ? (app.display_name ?? app.name) : null,
    entitlementName: (req.entitlements as { name: string } | null)?.name ?? null,
    packageName: (req.access_packages as { name: string } | null)?.name ?? null,
  };
}

export type PendingApprover = { kind: ApproverKind; name: string | null; groupName: string | null };

/** Who each waiting request is waiting on now: its open steps, with names, in one read of the steps (owner feedback, 20 Oct). */
export async function pendingApproversFor(tenantId: string, requestIds: string[]): Promise<Map<string, PendingApprover[]>> {
  const ids = [...new Set(requestIds)].filter((id) => UUID_RE.test(id));
  const out = new Map<string, PendingApprover[]>();
  if (!ids.length) return out;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_request_approvals")
    .select("request_id, stage, approver_kind, approver_identity_id, approver_group_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .in("request_id", ids)
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = data ?? [];
  const identityIds = [...new Set(rows.map((r) => r.approver_identity_id as string | null).filter((x): x is string => Boolean(x)))];
  const groupIds = [...new Set(rows.map((r) => r.approver_group_id as string | null).filter((x): x is string => Boolean(x)))];
  const [names, groups] = await Promise.all([
    getIdentityNames(tenantId, identityIds),
    groupIds.length ? supabase.from("groups").select("id, name").eq("tenant_id", tenantId).in("id", groupIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const groupName = new Map((groups.data ?? []).map((g) => [g.id as string, g.name as string]));
  const ordered = [...rows].sort((a, b) => (a.stage as number) - (b.stage as number) || KIND_ORDER.indexOf(a.approver_kind as ApproverKind) - KIND_ORDER.indexOf(b.approver_kind as ApproverKind));
  for (const r of ordered) {
    const list = out.get(r.request_id as string) ?? [];
    list.push({
      kind: r.approver_kind as ApproverKind,
      name: r.approver_identity_id ? (names.get(r.approver_identity_id as string)?.displayName ?? null) : null,
      groupName: r.approver_group_id ? (groupName.get(r.approver_group_id as string) ?? null) : null,
    });
    out.set(r.request_id as string, list);
  }
  return out;
}

/** Ids of waiting requests this person may decide now (named, or as an access manager), not their own. */
export async function listRequestIdsAwaiting(tenantId: string, actor: { userId: string; canApproveAsAccessManager: boolean }): Promise<string[]> {
  const supabase = await supabaseServer();
  // ACCESS-P0-23: and the steps of those whose approvals this member holds by delegation.
  const [acting, groups] = await Promise.all([approvalsActingFor(tenantId, actor.userId), memberGroupIds(tenantId, actor.userId)]);
  const named = [actor.userId, ...acting].filter((id) => UUID_RE.test(id));
  const groupIds = groups.filter((id) => UUID_RE.test(id));
  let query = supabase.from("access_request_approvals").select("request_id, approver_kind, approver_user_id, access_requests!inner(status, requested_by, requested_on_behalf_of)").eq("tenant_id", tenantId).eq("status", "pending");
  // Approval workflows: and the steps open to a group they belong to.
  const clauses = [`approver_user_id.in.(${named.join(",")})`, ...(groupIds.length ? [`approver_group_id.in.(${groupIds.join(",")})`] : []), ...(actor.canApproveAsAccessManager ? ["approver_kind.eq.access_managers"] : [])];
  query = query.or(clauses.join(","));
  const { data, error } = await query.limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []).filter((r) => {
    const ar = r.access_requests as unknown as { status: string; requested_by: string; requested_on_behalf_of: string | null };
    return ar.status === "pending" && ar.requested_by !== actor.userId && ar.requested_on_behalf_of !== actor.userId;
  });
  // An open access-manager review is not theirs where they decided an earlier stage.
  const openReviews = [...new Set(rows.filter((r) => r.approver_kind === "access_managers" || r.approver_kind === "group").map((r) => r.request_id as string))];
  const { data: decided, error: decidedError } = openReviews.length
    ? await supabase.from("access_request_approvals").select("request_id").eq("tenant_id", tenantId).eq("decided_by", actor.userId).neq("status", "invalidated").in("request_id", openReviews)
    : { data: [], error: null };
  if (decidedError) throw new ApiError(500, "QUERY_FAILED", decidedError.message);
  const already = new Set((decided ?? []).map((r) => r.request_id as string));
  return [...new Set(rows.filter((r) => (r.approver_kind !== "access_managers" && r.approver_kind !== "group") || !already.has(r.request_id as string)).map((r) => r.request_id as string))];
}

/**
 * Waiting catalog requests without a chain — made before the engine, or
 * whose chain could not be started — get one now, so every waiting
 * request reaches an approver. Runs as the signed-in user for identity
 * reads; writes are tenant-filtered.
 */
export async function repairApprovalChains(tenantId: string, actorId: string): Promise<number> {
  const { data, error } = await supabaseServiceRole()
    .from("access_requests")
    .select()
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .not("subject_identity_id", "is", null)
    .is("action_fingerprint", null)
    .limit(50);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  let built = 0;
  for (const r of data ?? []) {
    try {
      const { steps, fingerprint } = await buildChain(tenantId, r as RequestRow, new Date());
      built += 1;
      await writeAudit({ tenantId, actorId, actorType: "user", action: "access.approval_chain_started", objectType: "access_request", objectId: r.id as string, outcome: "success", metadata: { actionFingerprint: fingerprint, repaired: true, steps: steps.length } });
    } catch (err) {
      // One request that cannot be routed (its subject or resource is gone)
      // must not stop the others; it stays waiting and is reported.
      await writeAudit({ tenantId, actorId, actorType: "user", action: "access.approval_chain_started", objectType: "access_request", objectId: r.id as string, outcome: "failure", metadata: { error: err instanceof ApiError ? err.code : "UNEXPECTED" } });
    }
  }
  return built;
}
