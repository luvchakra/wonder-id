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
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Used by"
          description="Request policies that approve with this workflow."
          actions={
            w.policies.length > 0 ? (
              <Link href="/access/request-policies" className="text-sm text-primary hover:underline">
                Request policies
              </Link>
            ) : undefined
          }
        />
        <CardBody>
          {w.policies.length === 0 ? (
            <EmptyState
              title="No policy uses it yet"
              description="Choose it as a request policy's approval workflow."
              action={
                // A nudge to the next step (owner test feedback item 16, 2026-10-20).
                <Link href="/access/request-policies" className="text-sm font-medium text-primary hover:underline">
                  Go to Request Policies
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="workflow-policies">
              {w.policies.map((p) => (
                <li key={p.id} className="py-2">
                  <span className="font-medium text-foreground">{p.name}</span>
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
