"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addPackageResource,
  addPackageInclude,
  removePackageInclude,
  simulatePackageChange,
  assignPackageDirect,
  createPackage,
  removePackageResource,
  requestPackage,
  revokeAssignment,
  keepAssignment,
  setAssignmentItemStatus,
  updatePackage,
  setPackageBirthright,
} from "@/modules/access-governance/service";

/**
 * ACCESS-P0-20 — access package forms. Each returns the real outcome
 * (§17.5); the tenant comes from the session (#2) and every rule is the
 * service's.
 */
export type PackageFormState = { status: "idle" } | { status: "saved"; message: string; id?: string; ref?: number | null } | { status: "error"; message: string };

function formError(err: unknown): PackageFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v !== "" ? v : undefined;
};
const refresh = (packageId?: string) => {
  revalidatePath("/access/packages");
  if (packageId) revalidatePath("/(customer)/access/packages/[id]", "page");
};

function packageInput(f: FormData): Record<string, unknown> {
  return {
    name: str(f, "name") ?? "",
    kind: str(f, "kind"),
    description: f.get("description") === null ? undefined : String(f.get("description") ?? ""),
    ownerIdentityId: f.has("ownerIdentityId") ? (str(f, "ownerIdentityId") ?? null) : undefined,
    eligibleIdentityTypes: f.getAll("eligibleIdentityTypes").map(String),
    eligibleDepartments: String(f.get("eligibleDepartments") ?? ""),
    approval: str(f, "approval"),
    approvalMode: str(f, "approvalMode"),
    approvalTimeoutDays: str(f, "approvalTimeoutDays"),
    onTimeout: str(f, "onTimeout"),
    maxDurationDays: f.has("maxDurationDays") ? String(f.get("maxDurationDays") ?? "") : undefined,
    defaultDurationDays: f.has("defaultDurationDays") ? String(f.get("defaultDurationDays") ?? "") : undefined,
    certificationFrequency: str(f, "certificationFrequency"),
    requestable: f.get("requestable") === "on",
    extensionAllowed: f.get("extensionAllowed") === "on",
  };
}

export async function savePackageAction(packageId: string | null, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const p = packageId ? await updatePackage(ctx.tenantId!, ctx.userId, packageId, packageInput(formData)) : await createPackage(ctx.tenantId!, ctx.userId, packageInput(formData));
    refresh(p.id);
    return { status: "saved", message: packageId ? "Saved." : `Created "${p.name}" as a draft. Add what it includes, then activate it.`, id: p.id, ref: p.ref };
  } catch (err) {
    return formError(err);
  }
}

export async function setPackageStatusAction(packageId: string, status: string, _prev: PackageFormState): Promise<PackageFormState> {
  void _prev;
  const ctx = await requirePermission("access.manage");
  try {
    await updatePackage(ctx.tenantId!, ctx.userId, packageId, { status });
    refresh(packageId);
    return { status: "saved", message: status === "active" ? "Active: eligible people can find and request it." : status === "retired" ? "Retired: it can no longer be requested or assigned." : "Back to draft." };
  } catch (err) {
    return formError(err);
  }
}

/** Birthright (owner decision 13 Oct): one administrator asks, someone else approves; anyone may turn it off. */
export async function setBirthrightAction(packageId: string, action: "request" | "approve" | "off", _prev: PackageFormState): Promise<PackageFormState> {
  void _prev;
  const ctx = await requirePermission("access.manage");
  try {
    await setPackageBirthright(ctx.tenantId!, ctx.userId, packageId, action);
    refresh(packageId);
    return {
      status: "saved",
      message: action === "request" ? "Waiting for another administrator to approve." : action === "approve" ? "On: eligible joiners, rehires and movers get it from now on." : "Off: nobody gets it automatically.",
    };
  } catch (err) {
    return formError(err);
  }
}

export async function addResourceAction(packageId: string, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const r = await addPackageResource(ctx.tenantId!, ctx.userId, packageId, { applicationId: str(formData, "applicationId"), entitlementId: str(formData, "entitlementId") });
    refresh(packageId);
    return { status: "saved", message: `Added ${r.applicationName}${r.entitlementName ? ` · ${r.entitlementName}` : ""}.` };
  } catch (err) {
    return formError(err);
  }
}

export async function removeResourceAction(packageId: string, resourceId: string, _prev: PackageFormState): Promise<PackageFormState> {
  void _prev;
  const ctx = await requirePermission("access.manage");
  try {
    await removePackageResource(ctx.tenantId!, ctx.userId, packageId, resourceId);
    refresh(packageId);
    return { status: "saved", message: "Removed." };
  } catch (err) {
    return formError(err);
  }
}

export async function requestPackageAction(packageId: string, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.request");
  try {
    const { request, duplicate } = await requestPackage(
      ctx.tenantId!,
      { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") },
      { packageId, subjectIdentityId: str(formData, "subjectIdentityId"), durationDays: str(formData, "durationDays"), justification: str(formData, "justification") ?? "" },
    );
    revalidatePath("/access/requests");
    return {
      status: "saved",
      message: duplicate ? "An identical request is already waiting; it was not submitted twice." : "Submitted. It is waiting for approval; the package is assigned once it is approved.",
      id: request.id,
    };
  } catch (err) {
    return formError(err);
  }
}

export async function assignDirectAction(packageId: string, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const a = await assignPackageDirect(ctx.tenantId!, ctx.userId, { packageId, identityId: str(formData, "identityId"), durationDays: str(formData, "durationDays"), justification: str(formData, "justification") ?? "" });
    refresh(packageId);
    return { status: "saved", message: `Assigned to ${a.identityName ?? "the identity"}. Each included item now waits to be fulfilled.` };
  } catch (err) {
    return formError(err);
  }
}

export async function itemStatusAction(packageId: string, itemId: string, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.approve");
  try {
    const status = str(formData, "status");
    await setAssignmentItemStatus(ctx.tenantId!, ctx.userId, itemId, status, str(formData, "detail"));
    refresh(packageId);
    return { status: "saved", message: status === "failed" ? "Recorded as failed." : status === "revoked" ? "Recorded as removed." : status === "pending" ? "Back to pending." : "Recorded as done." };
  } catch (err) {
    return formError(err);
  }
}

/** WID-H09: keeps a mover's birthright package under review. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes the previous state first
export async function keepAssignmentAction(packageId: string, assignmentId: string, _prev: PackageFormState): Promise<PackageFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    await keepAssignment(ctx.tenantId!, ctx.userId, assignmentId);
    refresh(packageId);
    return { status: "saved", message: "Kept. It will not be removed." };
  } catch (err) {
    return formError(err);
  }
}

export async function revokeAssignmentAction(packageId: string, assignmentId: string, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    await revokeAssignment(ctx.tenantId!, ctx.userId, assignmentId, str(formData, "reason"));
    refresh(packageId);
    return { status: "saved", message: "Revoked. What was granted is now revocation work." };
  } catch (err) {
    return formError(err);
  }
}

// ACCESS-P0-21 — a role includes other roles or packages, and a simulation
// shows what adding or removing it would do to one identity's access.
export async function addIncludeAction(packageId: string, _prev: PackageFormState, formData: FormData): Promise<PackageFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    await addPackageInclude(ctx.tenantId!, ctx.userId, packageId, str(formData, "includedPackageId"));
    refresh(packageId);
    return { status: "saved", message: "Included. New assignments grant its contents too." };
  } catch (err) {
    return formError(err);
  }
}

export async function removeIncludeAction(packageId: string, includedId: string, _prev: PackageFormState): Promise<PackageFormState> {
  void _prev;
  const ctx = await requirePermission("access.manage");
  try {
    await removePackageInclude(ctx.tenantId!, ctx.userId, packageId, includedId);
    refresh(packageId);
    return { status: "saved", message: "No longer included." };
  } catch (err) {
    return formError(err);
  }
}

export type SimulationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; action: "add" | "remove"; changes: string[]; unchanged: string[]; risk: string; eligibility: string | null; stale: boolean; sod: { policyName: string; blocking: boolean; left: string[]; right: string[] }[] };

export async function simulateAction(packageId: string, _prev: SimulationState, formData: FormData): Promise<SimulationState> {
  const ctx = await requirePermission("access.manage");
  try {
    const action = formData.get("action") === "remove" ? "remove" : "add";
    const r = await simulatePackageChange(ctx.tenantId!, packageId, str(formData, "identityId") ?? "", action);
    return {
      status: "done",
      action,
      changes: r.changes.map((c) => c.label),
      unchanged: r.unchanged.map((c) => c.label),
      risk: r.risk,
      eligibility: action === "add" && !r.eligible.eligible ? r.eligible.reasons.join("; ") : action === "add" && r.holds ? "They already hold it." : null,
      stale: !r.ledgerRefreshed,
      sod: r.sod,
    };
  } catch (err) {
    const e = err as { message?: string };
    return { status: "error", message: e?.message || "The simulation could not be run." };
  }
}
