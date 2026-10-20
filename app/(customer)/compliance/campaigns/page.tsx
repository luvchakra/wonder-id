import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import Link from "next/link";
import { campaignCalendar, campaignItemCounts, listCampaignDecisionCounts, listCampaigns, listCampaignTemplates, listReviewerBacklog, summarizeCampaigns } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { launchCampaignAction } from "@/app/actions/compliance";
import { Card, CardHeader, CardBody, ObjectActionsMenu, EmptyState, TabPanel, Tabs, Badge } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";
import { CampaignsList, type CampaignRow } from "./CampaignsList";
import { CampaignTypeForm } from "./CampaignTypeForm";
import { CampaignTemplatesList } from "./CampaignTemplatesList";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ launch?: string; tab?: string }> }) {
  // Access Reviews › Create Campaigns (owner's navigation, 2026-10-13): the launch form first, focused.
  const search = await searchParams;
  const launching = search.launch === "1";
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  // Outstanding/overdue counts per campaign, so the list leads with what
  // still needs a human decision rather than just a status word. Counted in
  // the database in one query (§15), never by reading every item.
  // COMPLIANCE-P0-10: the calendar and analytics come from the same counts, plus the
  // decisions and reviewer backlog (0199); if those fail, the tab says so.
  const [campaigns, counts, templates, decisions, backlog] = await Promise.all([
    listCampaigns(ctx.tenantId!),
    campaignItemCounts(ctx.tenantId!),
    listCampaignTemplates(ctx.tenantId!),
    listCampaignDecisionCounts(ctx.tenantId!).catch(() => null),
    listReviewerBacklog(ctx.tenantId!).catch(() => null),
  ]);
  const calendar = campaignCalendar(campaigns);
  const analytics = decisions ? summarizeCampaigns(campaigns, counts, decisions) : null;
  const rows: CampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    ref: c.ref,
    name: c.name,
    scopeType: c.scopeType,
    status: c.buildStatus === "building" ? "building" : c.buildStatus === "failed" ? "failed" : c.status,
    pending: counts.get(c.id)?.pendingItems ?? 0,
    overdue: counts.get(c.id)?.overdueItems ?? 0,
  }));

  // COMPLIANCE-P0-15: the launch form starts from a campaign type.
  const launchForm = <CampaignTypeForm action={launchCampaignAction} autoFocus={launching} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Certification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Campaigns that put a named human behind every agent&rsquo;s access.
          </p>
        </div>
        <ObjectActionsMenu
          {...objectActionsFor(ctx.permissions, ["campaigns"])}
          create={launching ? undefined : { label: "Launch campaign…", title: "Launch a new campaign", content: launchForm }}
        />
      </div>

      {launching ? (
        <Card>
          <CardHeader title="Launch a new campaign" />
          <CardBody>{launchForm}</CardBody>
        </Card>
      ) : null}
      <Card className="p-4">
        <Tabs
          ariaLabel="Campaign views"
          defaultValue={["calendar", "analytics"].includes(search.tab ?? "") ? search.tab : "campaigns"}
          tabs={[
            { value: "campaigns", label: "Campaigns", count: campaigns.length },
            { value: "calendar", label: "Calendar" },
            { value: "analytics", label: "Analytics" },
          ]}
        >
          <TabPanel value="campaigns" className="space-y-5 pt-4">
            {templates.length ? <CampaignTemplatesList templates={templates} /> : null}
            <CampaignsList campaigns={rows} />
          </TabPanel>
          <TabPanel value="calendar" className="pt-4">
            <CampaignCalendarView calendar={calendar} rows={rows} />
          </TabPanel>
          <TabPanel value="analytics" className="pt-4">
            {analytics ? <CampaignAnalyticsView analytics={analytics} backlog={backlog} /> : <p role="status" className="text-sm text-muted-foreground">Analytics are unavailable just now. Try again in a moment.</p>}
          </TabPanel>
        </Tabs>
      </Card>
    </div>
  );
}

const SCOPE_LABEL: Record<string, string> = {
  agent: "AI agents",
  application: "Applications",
  entitlement: "Entitlements",
  privileged_access: "Privileged access",
  high_risk_agent: "High-risk AI agents",
  identity_access: "People's access",
  role_assignments: "WonderID roles",
  package_contents: "Access packages and roles",
  application_contents: "Applications (owner review)",
  role_membership: "Business role members",
};

const fmt = (n: number | null, unit = "") => (n === null ? "—" : `${n}${unit}`);

function CampaignCalendarView({ calendar, rows }: { calendar: ReturnType<typeof campaignCalendar>; rows: CampaignRow[] }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!calendar.months.length) {
    return <EmptyState title="Nothing due" description={calendar.undated ? `${calendar.undated} open campaign(s) have no due date.` : "Open campaigns appear here by the month they are due."} />;
  }
  return (
    <div className="space-y-5">
      {calendar.months.map((m) => (
        <section key={m.key} aria-label={m.label}>
          <h3 className={m.key === "past" ? "text-sm font-semibold text-destructive" : "text-sm font-semibold text-foreground"}>{m.label}</h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {m.campaigns.map((c) => {
              const row = byId.get(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <Link href={`/compliance/campaigns/${c.ref ?? c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      Due {c.dueDate!.slice(0, 10)} · {SCOPE_LABEL[c.scopeType] ?? c.scopeType} · {row?.pending ?? 0} open
                    </span>
                  </span>
                  {row?.overdue ? <Badge tone="danger">{row.overdue} overdue</Badge> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {calendar.undated ? <p className="text-xs text-muted-foreground">{calendar.undated} open campaign(s) have no due date.</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function CampaignAnalyticsView({ analytics: a, backlog }: { analytics: NonNullable<ReturnType<typeof summarizeCampaigns>>; backlog: Awaited<ReturnType<typeof listReviewerBacklog>> | null }) {
  if (!a.campaigns) return <EmptyState title="No campaigns yet" description="Analytics appear once a campaign has been launched." />;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Items reviewed" value={`${a.decided} of ${a.items}`} />
        <Stat label="Completion" value={fmt(a.completion, "%")} />
        <Stat label="Revoked" value={fmt(a.revokeRate, "%")} />
        <Stat label="Open" value={String(a.pending)} />
        <Stat label="Overdue" value={String(a.overdue)} />
        <Stat label="Average time to decide" value={a.avgHoursToDecide === null ? "—" : a.avgHoursToDecide < 48 ? `${a.avgHoursToDecide} h` : `${Math.round(a.avgHoursToDecide / 24)} days`} />
      </dl>
      {a.outcomes.length ? (
        <p className="text-sm text-muted-foreground">
          Outcomes: {a.outcomes.map((o) => `${o.label} ${o.count}`).join(" · ")}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Campaigns by scope</caption>
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 text-right font-medium">Campaigns</th>
              <th className="px-3 py-2 text-right font-medium">Items</th>
              <th className="px-3 py-2 text-right font-medium">Reviewed</th>
              <th className="px-3 py-2 text-right font-medium">Revoked</th>
              <th className="px-3 py-2 text-right font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {a.byScope.map((s) => (
              <tr key={s.scopeType}>
                <td className="px-3 py-2">{SCOPE_LABEL[s.scopeType] ?? s.scopeType}</td>
                <td className="px-3 py-2 text-right">{s.campaigns}</td>
                <td className="px-3 py-2 text-right">{s.items}</td>
                <td className="px-3 py-2 text-right">{s.decided}</td>
                <td className="px-3 py-2 text-right">{s.revoked}</td>
                <td className="px-3 py-2 text-right">{s.overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-label="Reviewers with open items">
        <h3 className="text-sm font-semibold text-foreground">Reviewers with open items</h3>
        {backlog === null ? (
          <p role="status" className="mt-2 text-sm text-muted-foreground">Unavailable just now.</p>
        ) : backlog.length ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {backlog.map((r) => (
              <li key={r.reviewerId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>{r.name}</span>
                <span className="text-muted-foreground">
                  {r.pending} open{r.overdue ? <span className="text-destructive"> · {r.overdue} overdue</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No reviewer has open items in an active campaign.</p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">Counted from the latest {a.campaigns} campaigns; an item counts once, by its final decision.</p>
    </div>
  );
}
