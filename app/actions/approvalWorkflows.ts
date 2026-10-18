"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { refOf } from "@/lib/refs/objectRef";
import { createApprovalWorkflow, updateApprovalWorkflow } from "@/modules/access-governance/service";

/**
 * Approval workflows — create, change and retire a reusable approval
 * pattern. The service validates every level and audits the change; each
 * form returns the real outcome (§17.5). The tenant comes from the session (#2).
 */
export type WorkflowFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

const formError = (err: unknown): WorkflowFormState => {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
};

function readForm(formData: FormData): { name: unknown; description: unknown; levels: unknown } {
  let levels: unknown = null;
  try {
    levels = JSON.parse(String(formData.get("levels") ?? "null"));
  } catch {
    levels = null;
  }
  return { name: formData.get("name"), description: formData.get("description"), levels };
}

export async function createWorkflowAction(_prev: WorkflowFormState, formData: FormData): Promise<WorkflowFormState> {
  const ctx = await requirePermission("access.manage");
  let path: string;
  try {
    const w = await createApprovalWorkflow(ctx.tenantId!, ctx.userId, readForm(formData));
    path = `/access/approval-workflows/${await refOf(ctx.tenantId!, "approval_workflows", w.id)}`;
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/access/approval-workflows");
  redirect(path);
}

export async function updateWorkflowAction(id: string, _prev: WorkflowFormState, formData: FormData): Promise<WorkflowFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const w = await updateApprovalWorkflow(ctx.tenantId!, ctx.userId, id, readForm(formData));
    revalidatePath("/access/approval-workflows");
    revalidatePath("/access/approval-workflows/[id]", "page");
    return { status: "saved", message: `Saved as version ${w.version}. New requests use it; requests already waiting keep their approvers.` };
  } catch (err) {
    return formError(err);
  }
}

export async function setWorkflowStatusAction(id: string, status: "active" | "retired", _prev: WorkflowFormState): Promise<WorkflowFormState> {
  void _prev;
  const ctx = await requirePermission("access.manage");
  try {
    await updateApprovalWorkflow(ctx.tenantId!, ctx.userId, id, { status });
    revalidatePath("/access/approval-workflows");
    revalidatePath("/access/approval-workflows/[id]", "page");
    revalidatePath("/access/request-policies");
    return { status: "saved", message: status === "retired" ? "Retired. Policies can no longer choose it." : "Restored." };
  } catch (err) {
    return formError(err);
  }
}
