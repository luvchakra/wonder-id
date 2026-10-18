import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listApprovalWorkflows } from "@/modules/access-governance/service";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { listGroups } from "@/lib/users/groups";
import { Badge, Card, EmptyState, ObjectActionsMenu, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { WorkflowForm } from "./WorkflowForm";

// Approval workflows (owner request 2026-10-18): reusable approval patterns
// with several levels. Each one is defined once and chosen by the request
// policies of as many applications as follow it.

export default async function ApprovalWorkflowsPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const [workflows, people, groups] = await Promise.all([
    listApprovalWorkflows(tenantId),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
    canManage ? listGroups(tenantId) : Promise.resolve([]),
  ]);
  const createForm = (
    <WorkflowForm
      people={people.map((p) => ({ id: p.id, name: p.displayName }))}
      groups={groups.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name }))}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Approval workflows</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Approval patterns with one or more levels. A request policy chooses one, so many applications can share it.</p>
        </div>
        <ObjectActionsMenu create={canManage ? { label: "New workflow…", title: "New approval workflow", content: createForm } : undefined} />
      </div>

      <Card className="p-4">
        {workflows.length === 0 ? (
          <EmptyState title="No approval workflows yet" description="Request policies use their built-in approval route until a workflow is chosen." />
        ) : (
          <TableContainer label="Approval workflows" bare>
            <Thead>
              <tr>
                <Th>Workflow</Th>
                <Th hideBelow="lg">Levels</Th>
                <Th>Used by</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {workflows.map((w) => (
                <Tr key={w.id}>
                  <Td>
                    <Link href={`/access/approval-workflows/${w.ref ?? w.id}`} className="font-medium text-primary hover:underline">
                      {w.name}
                    </Link>
                  </Td>
                  <Td hideBelow="lg">
                    <ol className="space-y-0.5 text-xs text-muted-foreground">
                      {w.summary.map((s, i) => (
                        <li key={i}>
                          {i + 1}. {s}
                        </li>
                      ))}
                    </ol>
                  </Td>
                  <Td>{w.usedBy === 1 ? "1 policy" : `${w.usedBy} policies`}</Td>
                  <Td>
                    <Badge tone={w.status === "active" ? "success" : "neutral"}>{w.status === "active" ? "Active" : "Retired"}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
