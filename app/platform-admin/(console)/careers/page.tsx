import { ExternalLink } from "lucide-react";
import { careersConfigured, hiringConsoleUrl, listCareerJobs } from "@/modules/careers/wonderjobs";
import { jobFacts } from "@/modules/careers/format";
import { Card, CardBody, CardHeader, LinkButton, StatusBadge } from "@/modules/ui";
import { PageHeading } from "@/app/platform-admin/PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

/**
 * WonderID's careers page (owner request, 2026-10-21). Jobs and applications live in WonderJobs: a platform
 * administrator posts them in WonderJobs' Hiring workspace and ticks "On WonderID careers"; this page shows what
 * the public careers page is showing now, and whether the link works.
 */
export default async function PlatformCareersPage() {
  const configured = careersConfigured();
  const jobs = configured ? await listCareerJobs() : ({ state: "needs_setup" } as const);
  const badge =
    jobs.state === "ok" ? <StatusBadge tone="success">Connected</StatusBadge> : jobs.state === "needs_setup" ? <StatusBadge tone="warning">Needs setup</StatusBadge> : <StatusBadge tone="danger">Unavailable</StatusBadge>;
  return (
    <>
      <PageHeading title="Careers" description="Open positions on the landing page and /careers, run by WonderJobs.">
        <LinkButton href={hiringConsoleUrl()} size="sm">
          Manage jobs in WonderJobs <ExternalLink className="size-3.5" aria-hidden="true" />
        </LinkButton>
      </PageHeading>
      <Card>
        <CardHeader title="Live positions" description="What visitors see now (re-read every five minutes)." actions={badge} />
        <CardBody>
          {jobs.state === "needs_setup" ? (
            <p className="text-sm text-muted-foreground">
              In WonderJobs, open Hiring → Jobs → Career sites, add “WonderID careers” with the address https://id.wonderapps.biz/careers and copy its key into this
              project&rsquo;s WONDERJOBS_CAREERS_KEY environment variable (Vercel, server only).
            </p>
          ) : jobs.state !== "ok" ? (
            <p className="text-sm text-muted-foreground">WonderJobs could not be reached or refused the key. Check WONDERJOBS_CAREERS_KEY and that the career site isn&rsquo;t revoked.</p>
          ) : jobs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positions are live. In WonderJobs, open a job and tick “On WonderID careers”.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <a href={`/careers/${encodeURIComponent(j.id)}`} className="font-medium text-foreground hover:underline">
                    {j.title}
                  </a>
                  <span className="text-muted-foreground">{jobFacts(j)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <p className="text-sm text-muted-foreground">Applications, emails to applicants, reminders and decisions are all in WonderJobs → Hiring → Applications.</p>
    </>
  );
}
