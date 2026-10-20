import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { describeLevels, namedReferences, validateWorkflowLevels, type WorkflowLevel } from "./approvalWorkflowRules";

/**
 * Approval workflows (owner request 2026-10-18): reusable approval patterns
 * with several levels, named once and used by the request policies of many
 * applications (a policy's "Approval workflow"). A change applies at once
 * as the workflow's next version, audited with what changed (as governance
 * policies, owner decision 17 Oct); requests already waiting keep the chain
 * they started with. A workflow in use cannot be retired, so no policy is
 * left without its approvers.
 *
 * Reads run as the user under RLS with the tenant filtered too; writes use
 * the service role, filtered by the session's tenant, and are audited (§14).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApprovalWorkflow = {
  id: string;
  ref: number | null;
  name: string;
  description: string | null;
  levels: WorkflowLevel[];
  status: "active" | "retired";
  version: number;
  updatedAt: string;
};

export type ApprovalWorkflowListItem = ApprovalWorkflow & { usedBy: number; summary: string[] };

function toWorkflow(r: Record<string, unknown>): ApprovalWorkflow {
  let levels: WorkflowLevel[] = [];
  try {
    levels = validateWorkflowLevels(r.levels);
  } catch {
    levels = [];
  }
  return {
    id: r.id as string,
    ref: (r.ref as number | null) ?? null,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    levels,
    status: r.status === "retired" ? "retired" : "active",
    version: r.version as number,
    updatedAt: r.updated_at as string,
  };
}

/** Names of the people and groups a set of workflows mentions, for display. */
async function referenceNames(tenantId: string, levels: WorkflowLevel[][]): Promise<{ person: (id: string) => string | undefined; group: (id: string) => string | undefined }> {
  const refs = namedReferences(levels.flat());
  const supabase = await supabaseServer();
  const [people, groups] = await Promise.all([
    refs.identityIds.length ? supabase.from("identities").select("id, display_name").eq("tenant_id", tenantId).in("id", refs.identityIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    refs.groupIds.length ? supabase.from("groups").select("id, name").eq("tenant_id", tenantId).in("id", refs.groupIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const p = new Map((people.data ?? []).map((x) => [x.id as string, x.display_name as string]));
  const g = new Map((groups.data ?? []).map((x) => [x.id as string, x.name as string]));
  return { person: (id) => p.get(id), group: (id) => g.get(id) };
}

export async function listApprovalWorkflows(tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<ApprovalWorkflowListItem[]> {
  const supabase = await supabaseServer();
  let q = supabase.from("approval_workflows").select().eq("tenant_id", tenantId).order("name").limit(200);
  if (opts.activeOnly) q = q.eq("status", "active");
  const [{ data, error }, { data: uses, error: useError }] = await Promise.all([
    q,
    supabase.from("access_request_policies").select("approval_workflow_id").eq("tenant_id", tenantId).not("approval_workflow_id", "is", null).limit(5000),
  ]);
  if (error || useError) throw new ApiError(500, "QUERY_FAILED", (error ?? useError)!.message);
  const count = new Map<string, number>();
  for (const u of uses ?? []) count.set(u.approval_workflow_id as string, (count.get(u.approval_workflow_id as string) ?? 0) + 1);
  const rows = (data ?? []).map(toWorkflow);
  const names = await referenceNames(tenantId, rows.map((r) => r.levels));
  return rows.map((w) => ({ ...w, usedBy: count.get(w.id) ?? 0, summary: describeLevels(w.levels, names) }));
}

export async function getApprovalWorkflow(
  tenantId: string,
  id: string,
): Promise<(ApprovalWorkflow & { summary: string[]; policies: { id: string; name: string; applicationId: string | null; applicationName: string | null; entitlementName: string | null }[] }) | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = await supabaseServer();
  const [{ data, error }, { data: policies, error: policyError }] = await Promise.all([
    supabase.from("approval_workflows").select().eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    supabase.from("access_request_policies").select("id, name, application_id, applications(name, display_name), entitlements(name)").eq("tenant_id", tenantId).eq("approval_workflow_id", id).limit(500),
  ]);
  if (error || policyError) throw new ApiError(500, "QUERY_FAILED", (error ?? policyError)!.message);
  if (!data) return null;
  const w = toWorkflow(data);
  const names = await referenceNames(tenantId, [w.levels]);
  return {
    ...w,
    summary: describeLevels(w.levels, names),
    policies: (policies ?? []).map((p) => {
      const app = p.applications as unknown as { name: string; display_name: string | null } | null;
      return { id: p.id as string, name: p.name as string, applicationId: (p.application_id as string | null) ?? null, applicationName: app ? (app.display_name ?? app.name) : null, entitlementName: (p.entitlements as unknown as { name: string } | null)?.name ?? null };
    }),
  };
}

/** The people and groups a workflow names must be in this organization: active people who can sign in, active groups. */
async function assertReferences(tenantId: string, levels: WorkflowLevel[]): Promise<void> {
  const refs = namedReferences(levels);
  const admin = supabaseServiceRole();
  if (refs.identityIds.length) {
    const { data, error } = await admin.from("identities").select("id, tenant_id, identity_type, status, user_id").eq("tenant_id", tenantId).in("id", refs.identityIds);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const ok = (data ?? []).filter((i) => i.tenant_id === tenantId && i.status === "active" && i.user_id && (i.identity_type === "HUMAN" || i.identity_type === "EXTERNAL"));
    if (ok.length !== refs.identityIds.length) throw new ApiError(400, "VALIDATION_FAILED", "A named approver must be an active person in this organization who can sign in.");
  }
  if (refs.groupIds.length) {
    const { data, error } = await admin.from("groups").select("id, tenant_id, status").eq("tenant_id", tenantId).in("id", refs.groupIds);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const ok = (data ?? []).filter((g) => g.tenant_id === tenantId && g.status === "active");
    if (ok.length !== refs.groupIds.length) throw new ApiError(400, "VALIDATION_FAILED", "A group approver must be an active group in this organization.");
  }
}

function validateName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > 120) throw new ApiError(400, "VALIDATION_FAILED", "name: 1 to 120 characters");
  return name;
}

function validateDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const d = String(raw).trim();
  if (d.length > 1000) throw new ApiError(400, "VALIDATION_FAILED", "description: at most 1000 characters");
  return d || null;
}

export async function createApprovalWorkflow(tenantId: string, actorId: string, input: { name?: unknown; description?: unknown; levels?: unknown }): Promise<ApprovalWorkflow> {
  const name = validateName(input.name);
  const description = validateDescription(input.description);
  const levels = validateWorkflowLevels(input.levels);
  await assertReferences(tenantId, levels);
  const { data, error } = await supabaseServiceRole().from("approval_workflows").insert({ tenant_id: tenantId, name, description, levels }).select().single();
  if (error?.code === "23505") throw new ApiError(409, "DUPLICATE", "An approval workflow with this name already exists");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not create the workflow");
  const w = toWorkflow(data);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.approval_workflow_created", objectType: "approval_workflow", objectId: w.id, outcome: "success", metadata: { name, levels: describeLevels(levels) } });
  return w;
}

/** A change is the workflow's next version; requests already waiting keep the chain they started with. */
export async function updateApprovalWorkflow(tenantId: string, actorId: string, id: string, input: { name?: unknown; description?: unknown; levels?: unknown; status?: unknown }): Promise<ApprovalWorkflow> {
  if (!UUID_RE.test(id)) throw new ApiError(404, "NOT_FOUND", "No such approval workflow");
  const admin = supabaseServiceRole();
  const { data: current, error: readError } = await admin.from("approval_workflows").select().eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!current || current.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such approval workflow");
  const before = toWorkflow(current);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = validateName(input.name);
  if (input.description !== undefined) patch.description = validateDescription(input.description);
  if (input.levels !== undefined) {
    const levels = validateWorkflowLevels(input.levels);
    await assertReferences(tenantId, levels);
    patch.levels = levels;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "retired") throw new ApiError(400, "VALIDATION_FAILED", "status: active or retired");
    if (input.status === "retired" && before.status === "active") {
      const { count, error } = await admin.from("access_request_policies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("approval_workflow_id", id);
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      if (count) throw new ApiError(409, "WORKFLOW_IN_USE", `${count} request ${count === 1 ? "policy uses" : "policies use"} this workflow; choose another workflow for ${count === 1 ? "it" : "them"} first`);
    }
    patch.status = input.status;
  }
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if (patch.name !== undefined && patch.name !== before.name) changes.push({ field: "name", from: before.name, to: patch.name });
  if (patch.description !== undefined && patch.description !== before.description) changes.push({ field: "description", from: before.description, to: patch.description });
  if (patch.levels !== undefined && JSON.stringify(patch.levels) !== JSON.stringify(before.levels)) changes.push({ field: "levels", from: describeLevels(before.levels), to: describeLevels(patch.levels as WorkflowLevel[]) });
  if (patch.status !== undefined && patch.status !== before.status) changes.push({ field: "status", from: before.status, to: patch.status });
  if (!changes.length) return before;
  const { data, error } = await admin
    .from("approval_workflows")
    .update({ ...patch, version: before.version + 1, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("version", before.version)
    .select()
    .maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "DUPLICATE", "An approval workflow with this name already exists");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(409, "CONFLICT", "The workflow changed meanwhile; reload");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.approval_workflow_updated", objectType: "approval_workflow", objectId: id, outcome: "success", metadata: { fromVersion: before.version, toVersion: before.version + 1, changes } });
  return toWorkflow(data);
}
