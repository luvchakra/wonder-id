import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAccessConflictRules, listEntitlementsForTenant, listPolicies, listSoDRules } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, EmptyState, ObjectActionsMenu, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { AccessRuleForm } from "./AccessRuleForm";

// SOD › SoD Rules (owner request, 2026-10-10): the separation-of-duties
// rules WonderID enforces (ACCESS-P0-14), read from the identity policies
// that hold them. A rule is added or changed on its policy's page.
// ACCESS-P0-22: access one identity must not hold together, added from
// the Actions menu to an identity policy.

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  active: { label: "In effect", tone: "success" },
  draft: { label: "Draft", tone: "warning" },
};

export default async function SoDRulesPage() {
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canUpdate = ctx.permissions.includes("policy.update");
  const [rules, accessRules, entitlements, policies] = await Promise.all([
    listSoDRules(tenantId),
    listAccessConflictRules(tenantId),
    listEntitlementsForTenant(tenantId),
    canUpdate ? listPolicies(tenantId) : Promise.resolve([]),
  ]);
  const entName = new Map(entitlements.map((e) => [e.id, `${e.applicationName} · ${e.name}`]));
  const entitlementOptions = entitlements
    .filter((e) => e.status !== "inactive")
    .map((e) => ({ id: e.id, label: `${e.applicationName} · ${e.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const identityPolicies = policies.filter((p) => p.policyCategory === "identity").map((p) => ({ id: p.id, label: `${p.name} (${p.action === "block" ? "refuses" : "records"}, ${p.status})` }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">SoD Rules</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Separation of duties: access one identity must not hold together, and actions one person must not both perform for the same agent. Each rule lives on an{" "}
          <Link href="/policies" className="text-primary hover:underline">
            identity policy
          </Link>
          .
        </p>
      </div>
        <ObjectActionsMenu create={canUpdate ? { label: "New access rule…", title: "Access that must not be combined", content: <AccessRuleForm policies={identityPolicies} entitlements={entitlementOptions} /> } : undefined} />
      </div>
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Access that must not be combined</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Checked when access is requested, approved or assigned, for every kind of identity.</p>
        <div className="mt-3">
          {accessRules.length === 0 ? (
            <EmptyState title="No access rules yet" description={canUpdate ? "Add one from Actions." : undefined} />
          ) : (
            <TableContainer label="Access conflict rules" bare>
              <Thead>
                <tr>
                  <Th>One side</Th>
                  <Th>Must not be held with</Th>
                  <Th hideBelow="lg">Policy</Th>
                  <Th>When it conflicts</Th>
                </tr>
              </Thead>
              <tbody>
                {accessRules.map((r) => (
                  <Tr key={r.ruleId}>
                    <Td>{r.left.map((e) => entName.get(e) ?? "A removed entitlement").join(", ")}</Td>
                    <Td>{r.right.map((e) => entName.get(e) ?? "A removed entitlement").join(", ")}</Td>
                    <Td hideBelow="lg">
                      <Link href={`/policies/${r.policyId}`} className="text-primary hover:underline">
                        {r.policyName}
                      </Link>
                    </Td>
                    <Td>
                      {r.policyStatus === "active" ? <Badge tone={r.blocking ? "danger" : "warning"}>{r.blocking ? "Refused" : "Allowed, recorded"}</Badge> : <Badge tone="neutral">Not in effect</Badge>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>
      </Card>
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Actions one person must not both perform</h2>
        {rules.length === 0 ? (
          <EmptyState title="No SoD rules yet" description="Add a rule with conflicting actions to an identity policy; it is enforced once the policy is in effect." />
        ) : (
          <TableContainer label="SoD rules" bare>
            <Thead>
              <tr>
                <Th>Conflicting actions</Th>
                <Th>Policy</Th>
                <Th>When it conflicts</Th>
                <Th hideBelow="lg">Status</Th>
              </tr>
            </Thead>
            <tbody>
              {rules.map((r) => {
                const status = STATUS[r.policyStatus] ?? { label: "Not in effect", tone: "neutral" as const };
                return (
                  <Tr key={r.ruleId}>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {r.conflictingActions.map((a) => (
                          <code key={a} className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                            {a}
                          </code>
                        ))}
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/policies/${r.policyId}`} className="text-primary hover:underline">
                        {r.policyName}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={r.blocking ? "danger" : "warning"}>{r.blocking ? "Refused" : "Allowed, recorded"}</Badge>
                    </Td>
                    <Td hideBelow="lg">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
