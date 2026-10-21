import { ExternalLink } from "lucide-react";
import { hiringConsoleUrl, listCareerJobs } from "@/modules/careers/wonderjobs";
import { jobFacts } from "@/modules/careers/format";
import { getCareersConnection } from "@/modules/platform-admin/service";
import { Card, CardBody, CardHeader, LinkButton, StatusBadge } from "@/modules/ui";
import { PageHeading } from "@/app/platform-admin/PageHeading";
import { ConnectionForm } from "./ConnectionForm";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/**
 * WonderID's careers page (owner request, 2026-10-21). Jobs and applications live in WonderJobs: a platform
 * administrator posts them in WonderJobs' Hiring workspace and ticks "On WonderID careers". Here they connect
 * the careers page to WonderJobs with the career site's key (no deployment needed) and see what is live.
 */
export default async function PlatformCareersPage() {
  const [connection, jobs, consoleUrl] = await Promise.all([getCareersConnection().catch(() => null), listCareerJobs(), hiringConsoleUrl()]);
  const badge =
    jobs.state === "ok" ? <StatusBadge tone="success">Connected</StatusBadge> : jobs.state === "needs_setup" ? <StatusBadge tone="warning">Needs setup</StatusBadge> : <StatusBadge tone="danger">Unavailable</StatusBadge>;
  const source =
    connection === null
      ? "The saved connection couldn't be read."
      : connection.source === "console"
        ? `Key …${connection.keyHint}, saved here${connection.updatedAt ? ` on ${when(connection.updatedAt)}` : ""}.`
        : connection.source === "environment"
          ? `Key …${connection.keyHint}, from the WONDERJOBS_CAREERS_KEY environment variable. A key saved here replaces it.`
          : "No key yet.";
  return (
    <>
      <PageHeading title="Careers" description="Open positions on the landing page and /careers, run by WonderJobs.">
        <LinkButton href={consoleUrl} size="sm">
          Manage jobs in WonderJobs <ExternalLink className="size-3.5" aria-hidden="true" />
        </LinkButton>
      </PageHeading>
      <Card>
        <CardHeader title="WonderJobs connection" description={source} actions={badge} />
        <CardBody>
          <ConnectionForm hasSavedKey={connection?.source === "console"} baseUrl={connection?.source === "console" ? connection.baseUrl : null} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Live positions" description="What visitors see now (re-read every five minutes)." />
        <CardBody>
          {jobs.state === "needs_setup" ? (
            <p className="text-sm text-muted-foreground">Connect WonderJobs above to show positions.</p>
          ) : jobs.state !== "ok" ? (
            <p className="text-sm text-muted-foreground">WonderJobs could not be reached or refused the key. Check that the career site isn&rsquo;t revoked, or paste a new key above.</p>
          ) : jobs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positions are live. In WonderJobs, open a job and tick &ldquo;On WonderID careers&rdquo;.</p>
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
