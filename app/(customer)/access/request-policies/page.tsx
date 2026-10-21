import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { approvalChoiceOf, listApplicationsForMatching, listApprovalWorkflows, listEntitlementsForApplication, listGovernanceChanges, listRequestPolicies } from "@/modules/access-governance/service";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, ObjectActionsMenu } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";
import { PolicyForm } from "./PolicyForm";
import { ChangeDecision } from "./ChangeDecision";
import { ScopePicker } from "./ScopePicker";
import { changeLabel, changeValue } from "./changeLabels";
import { TENANT_ADMIN_ROLE } from "@/lib/rbac/delegatedRoleRules";

// ACCESS-P0-18 — request policies (spec §11.4): who may request what, for
// whom, for how long, with what justification, and when a person must
// approve. The most specific active policy applies.

const FOR_OTHERS: Record<string, string> = { none: "Self only", managers: "Manager or access manager", access_managers: "Access managers" };
const APPROVAL: Record<string, string> = { manager_approval: "Manager", owner_approval: "Owner", manager_and_owner: "Manager and owner" };

export default async function RequestPoliciesPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const sp = await searchParams;
  const [policies, apps, waiting, members, workflows] = await Promise.all([
    listRequestPolicies(tenantId),
    canManage ? listApplicationsForMatching(tenantId) : Promise.resolve([]),
    // ACCESS-P0-35: changes waiting for a second person.
    canManage ? listGovernanceChanges(tenantId) : Promise.resolve([]),
    canManage ? listTenantMembersWithRoles(tenantId) : Promise.resolve([]),
    listApprovalWorkflows(tenantId),
  ]);
  const workflowName = new Map(workflows.map((w) => [w.id, w.name]));
  const who = (userId: string) => (userId === ctx.userId ? "you" : (members.find((m) => m.userId === userId)?.displayName ?? members.find((m) => m.userId === userId)?.email ?? "a former member"));
  const scopeName = (key: { applicationId: string | null; entitlementId: string | null }) =>
    policies.find((p) => p.applicationId === key.applicationId && p.entitlementId === key.entitlementId)?.name ?? (key.applicationId ? "A new application policy" : "The organization default");
  const isAdmin = ctx.roles.includes(TENANT_ADMIN_ROLE);
  const selectedApp = apps.find((a) => a.id === sp.app) ?? null;
  const entitlements = selectedApp ? await listEntitlementsForApplication(tenantId, selectedApp.id) : [];
  const existing = policies.find((p) => (selectedApp ? p.applicationId === selectedApp.id && !p.entitlementId : !p.applicationId));
  const base = existing ?? {
    name: selectedApp ? `${selectedApp.displayName ?? selectedApp.name} requests` : "Organization default",
    requestable: true,
    allowSelf: true,
    allowForOthers: "managers",
    maxDurationDays: 90,
    defaultDurationDays: 30,
    justificationRequired: true,
    riskThreshold: "high",
    autoApprove: false,
    approval: "manager_approval" as const,
    approvalMode: "sequential" as const,
    approvalTimeoutDays: 5,
    onTimeout: "escalate",
    status: "active",
    approvalWorkflowId: null,
  };
  const defaults = { ...base, approvalChoice: approvalChoiceOf(base) };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Request policies</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What people can request and on what terms. An entitlement&apos;s policy wins over its application&apos;s, which wins over the organization default. Without any policy, nothing is requestable.
          </p>
        </div>
        <ObjectActionsMenu {...objectActionsFor(ctx.permissions, ["request-policies"])} />
      </div>

      {waiting.length ? (
        <Card>
          <CardHeader
            title="Waiting for approval"
            description={isAdmin ? "Changes apply once someone other than the proposer approves them; as an administrator you may approve your own, with a note." : "Changes apply once someone other than the proposer approves them."}
          />
          <CardBody>
            {/* Owner feedback (21 Oct): one row per change, in the form's words. */}
            <TableContainer label="Policy changes waiting for approval" bare>
              <Thead>
                <tr>
                  <Th>Policy</Th>
                  <Th>Changes</Th>
                  <Th>Decision</Th>
                </tr>
              </Thead>
              <tbody>
                {waiting.map((c) => {
                  const isNew = c.changes.every((f) => f.before === null || f.before === undefined);
                  const value = (field: string, v: unknown) => changeValue(field, v, (wid) => workflowName.get(wid));
                  const own = c.requestedBy === ctx.userId;
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <span className="font-medium text-foreground">{scopeName(c.objectKey)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {isNew ? "New policy" : "Change"} · by {who(c.requestedBy)} · {new Date(c.requestedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </Td>
                      <Td>
                        <span className="block max-w-2xl text-xs leading-5 text-muted-foreground">
                          {c.changes.map((f, i) => (
                            <span key={f.field}>
                              {i ? " · " : ""}
                              {changeLabel(f.field)}:{" "}
                              {isNew ? null : <>{value(f.field, f.before)} → </>}
                              <span className="text-foreground">{value(f.field, f.after)}</span>
                            </span>
                          ))}
                        </span>
                      </Td>
                      <Td>{own && !isAdmin ? <Badge tone="neutral">Waiting for another administrator</Badge> : <ChangeDecision id={c.id} own={own} />}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          </CardBody>
        </Card>
      ) : null}

      <Card className="p-4">
        {policies.length === 0 ? (
          <EmptyState title="No request policies yet" description="Nothing is requestable until a policy says so." />
        ) : (
          <TableContainer label="Request policies" bare>
            <Thead>
              <tr>
                <Th>Policy</Th>
                <Th>Applies to</Th>
                <Th hideBelow="lg">For others</Th>
                <Th hideBelow="lg">Duration</Th>
                <Th hideBelow="xl">Approval</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {policies.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    {canManage ? (
                      <Link href={p.applicationId ? `/access/request-policies?app=${p.applicationId}#set-policy` : "/access/request-policies#set-policy"} className="font-medium text-primary hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{p.name}</span>
                    )}
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {!p.requestable ? <Badge tone="neutral">Not requestable</Badge> : null}
                      {p.autoApprove ? <Badge tone="info">Auto-approves below {p.riskThreshold}</Badge> : null}
                      {p.justificationRequired ? null : <Badge tone="neutral">No justification</Badge>}
                    </span>
                  </Td>
                  <Td>{p.entitlementName ? `${p.applicationName} — ${p.entitlementName}` : (p.applicationName ?? "Organization default")}</Td>
                  <Td hideBelow="lg">{FOR_OTHERS[p.allowForOthers]}</Td>
                  <Td hideBelow="lg">{p.maxDurationDays ? `Up to ${p.maxDurationDays} days` : "No limit"}</Td>
                  <Td hideBelow="xl">
                    {p.approvalWorkflowId ? (
                      <Link href={`/access/approval-workflows/${p.approvalWorkflowId}`} className="text-primary hover:underline">
                        {workflowName.get(p.approvalWorkflowId) ?? "Approval workflow"}
                      </Link>
                    ) : (
                      APPROVAL[p.approval]
                    )}
                    {!p.approvalWorkflowId && p.approval === "manager_and_owner" ? <span className="block text-xs text-muted-foreground">{p.approvalMode === "parallel" ? "at the same time" : "in order"}</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {p.approvalTimeoutDays} days each, then {p.onTimeout === "escalate" ? "escalate" : "expire"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={p.status === "active" ? "success" : "neutral"} className="whitespace-nowrap">{p.status === "active" ? "Active" : "Inactive"}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
      </Card>

      {canManage ? (
        // #set-policy: approval workflow pages link straight here (owner test feedback item 16).
        <div id="set-policy" className="scroll-mt-4">
          <Card>
            <CardHeader title="Set a policy" description="Choose where it applies; its current policy opens. Saving replaces it." />
            <CardBody className="space-y-5">
              <ScopePicker
              value={selectedApp?.id ?? ""}
              options={apps
                .slice()
                .sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name))
                .map((a) => ({ id: a.id, name: a.displayName ?? a.name }))}
            />
              <PolicyForm key={selectedApp?.id ?? "default"} applicationId={selectedApp?.id ?? null} entitlements={entitlements.map((e) => ({ id: e.id, name: e.name }))} defaults={defaults} workflows={workflows.filter((w) => w.status === "active").map((w) => ({ id: w.id, name: w.name }))} />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
