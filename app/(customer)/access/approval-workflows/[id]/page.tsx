import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { pageRef } from "@/lib/refs/objectRef";
import { ApiError } from "@/lib/shared/types/foundation";
import { getApprovalWorkflow } from "@/modules/access-governance/service";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { listGroups } from "@/lib/users/groups";
import { Badge, Card, CardBody, CardHeader, EmptyState, RecordProvenance } from "@/modules/ui";
import { WorkflowForm, WorkflowStatusButton } from "../WorkflowForm";

// One approval workflow: its levels, the request policies that use it,
// and, for access managers, its edit form and retire/restore.

/** A policy's own form on the request policies page: its application's scope, or the organization default. */
function policyHref(applicationId: string | null): string {
  return applicationId ? `/access/request-policies?app=${applicationId}#set-policy` : "/access/request-policies#set-policy";
}

export default async function ApprovalWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const id = await pageRef(tenantId, "approval_workflows", (await params).id, (ref) => `/access/approval-workflows/${ref}`);
  const canManage = ctx.permissions.includes("access.manage");
  const [w, provenance, people, groups] = await Promise.all([
    getApprovalWorkflow(tenantId, id),
    getRecordProvenance(tenantId, "approval_workflows", id),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
    canManage ? listGroups(tenantId) : Promise.resolve([]),
  ]);
  if (!w) notFound();

  // Contextual nudges (owner test feedback item 16, 2026-10-20): where this
  // workflow's approvers are set, from the kinds its levels use.
  const kinds = new Set(w.levels.flatMap((l) => l.approvers.map((a) => a.kind)));
  const sources = [
    kinds.has("manager") || kinds.has("managers_manager") ? { label: "each person's manager in Workforce", href: "/identities/humans" } : null,
    kinds.has("resource_owner") || kinds.has("application_owner") ? { label: "the owners in the Application Catalog", href: "/access" } : null,
    kinds.has("group") ? { label: "the members of Groups", href: "/settings/groups" } : null,
    kinds.has("access_managers") ? { label: "the access managers in Users & Roles", href: "/settings/users" } : null,
  ].filter((x): x is { label: string; href: string } => x !== null);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <Link href="/access/approval-workflows" className="text-xs text-muted-foreground hover:text-foreground">
          Approval workflows
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{w.name}</h1>
          <Badge tone={w.status === "active" ? "success" : "neutral"}>{w.status === "active" ? "Active" : "Retired"}</Badge>
          <span className="text-xs text-muted-foreground">Version {w.version}</span>
        </div>
        <RecordProvenance record={provenance} />
        {w.description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{w.description}</p> : null}
      </div>

      <Card>
        <CardHeader title="Levels" description="In order. A rejection at any level rejects the request; nobody approves their own access." />
        <CardBody>
          <ol className="space-y-1 text-sm text-foreground" data-testid="workflow-levels">
            {w.summary.map((s, i) => (
              <li key={i}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>
          {sources.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="workflow-approver-sources">
              Approvers come from{" "}
              {sources.map((src, i) => (
                <span key={src.href}>
                  {i > 0 ? (i === sources.length - 1 ? " and " : ", ") : null}
                  <Link href={src.href} className="text-primary hover:underline">
                    {src.label}
                  </Link>
                </span>
              ))}
              .
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Used by" description="Request policies that approve with this workflow." />
        <CardBody>
          {w.policies.length === 0 ? (
            <EmptyState
              title="No policy uses it yet"
              description="It applies once a request policy chooses it as its approval workflow."
              action={
                w.status === "active" ? (
                  <Link href="/access/request-policies#set-policy" className="text-sm font-medium text-primary hover:underline">
                    Set a request policy
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="workflow-policies">
              {w.policies.map((p) => (
                <li key={p.id} className="py-2">
                  <Link href={policyHref(p.applicationId)} className="font-medium text-primary hover:underline">
                    {p.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{p.applicationName ? `${p.applicationName}${p.entitlementName ? ` — ${p.entitlementName}` : ""}` : "Organization default"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Change this workflow</summary>
          <div className="mt-4 space-y-5">
            <WorkflowForm
              workflowId={w.id}
              defaults={{ name: w.name, description: w.description, levels: w.levels }}
              people={people.map((p) => ({ id: p.id, name: p.displayName }))}
              groups={groups.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name }))}
            />
            <WorkflowStatusButton workflowId={w.id} status={w.status} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
