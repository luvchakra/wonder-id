import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listEntitlementInventory } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";

// Admin › Entitlements (owner request, 2026-10-10): every entitlement in
// the organization, across applications, paged at the database (§15).
// An entitlement is created and changed on its application's page; each
// name opens that page's Entitlements tab (owner feedback, 21 Oct: one
// column per attribute, no inline edit here).

const RISK_TONE = { low: "neutral", medium: "info", high: "warning", critical: "danger" } as const;

const PAGE_SIZE = 50;

export default async function EntitlementsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total } = await listEntitlementInventory(ctx.tenantId!, { q, page, pageSize: PAGE_SIZE });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/access/entitlements${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Entitlements</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Every entitlement in every application.</p>
      </div>

      <Card className="p-4">
        <form method="get" className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="q" className={fieldLabelClass}>
              Search
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Entitlement name" className={fieldInputClass} />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title={q ? "No entitlements match" : "No entitlements yet"}
              description={q ? "Try another name." : "Entitlements arrive with an application's connector, a file import, or are added on the application's page."}
            />
          ) : (
            <TableContainer label="Entitlements" bare>
              <Thead>
                <tr>
                  <Th>Entitlement</Th>
                  <Th>Type</Th>
                  <Th>Application</Th>
                  <Th hideBelow="lg">Risk</Th>
                  <Th hideBelow="lg">Privilege</Th>
                  <Th hideBelow="xl">Requestable</Th>
                  <Th hideBelow="xl">SOX</Th>
                  <Th hideBelow="2xl">Data</Th>
                  <Th hideBelow="xl">Status</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((e) => {
                  const appHref = `/access/applications/${e.applicationRef ?? e.applicationId}`;
                  return (
                    <Tr key={e.id}>
                      <Td>
                        <Link href={`${appHref}?tab=entitlements`} className="font-medium text-primary hover:underline">
                          {e.displayName || e.name}
                        </Link>
                        {e.displayName && e.displayName !== e.name ? <span className="block text-xs text-muted-foreground">{e.name}</span> : null}
                      </Td>
                      <Td>{e.entitlementType ? <Badge tone="info">{e.entitlementType}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td>
                        <Link href={appHref} className="text-primary hover:underline">
                          {e.applicationDisplayName ?? e.applicationName}
                        </Link>
                      </Td>
                      <Td hideBelow="lg">{e.riskLevel ? <Badge tone={RISK_TONE[e.riskLevel]}>{e.riskLevel}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td hideBelow="lg">
                        {e.privilegeLevel === "standard" ? (
                          <span className="text-muted-foreground">Standard</span>
                        ) : (
                          <Badge tone={e.privilegeLevel === "admin" ? "danger" : "warning"}>{e.privilegeLevel === "admin" ? "Admin" : "Elevated"}</Badge>
                        )}
                      </Td>
                      <Td hideBelow="xl">{e.requestable === false ? <span className="text-muted-foreground">No</span> : "Yes"}</Td>
                      <Td hideBelow="xl">{e.soxRelevant ? <Badge tone="warning">SOX</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td hideBelow="2xl">
                        <span className="text-sm text-muted-foreground">{e.dataClassification ?? "—"}</span>
                      </Td>
                      <Td hideBelow="xl">{e.status === "inactive" ? <Badge tone="neutral">Disabled</Badge> : <span className="text-muted-foreground">Active</span>}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </div>
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          <span className="text-muted-foreground">
            {total} {total === 1 ? "entitlement" : "entitlements"}
            {pageCount > 1 ? ` · page ${Math.min(page, pageCount)} of ${pageCount}` : ""}
          </span>
          {pageCount > 1 ? (
            <span className="flex gap-2">
              {page > 1 ? (
                <LinkButton href={href(page - 1)} variant="outline" size="sm">
                  Previous
                </LinkButton>
              ) : null}
              {page < pageCount ? (
                <LinkButton href={href(page + 1)} variant="outline" size="sm">
                  Next
                </LinkButton>
              ) : null}
            </span>
          ) : null}
        </nav>
      </Card>
    </div>
  );
}
