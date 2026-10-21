import Link from "next/link";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { jobFacts } from "@/modules/careers/format";
import type { CareerJob, Result } from "@/modules/careers/wonderjobs";

/**
 * The open positions, as WonderJobs returned them. Nothing is filled in when there is nothing to show: no
 * positions is an empty state, and a careers service that isn't set up or can't be reached says so (§19.2).
 */
export function JobList({ result, limit }: { result: Result<CareerJob[]>; limit?: number }) {
  if (result.state !== "ok") {
    return (
      <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Open positions can&rsquo;t be shown right now. To ask about working with us, email{" "}
        <a href="mailto:connect@wonderapps.biz?subject=Careers" className="font-medium text-primary hover:underline">
          our team
        </a>
        .
      </p>
    );
  }
  const jobs = limit ? result.data.slice(0, limit) : result.data;
  if (!jobs.length) {
    return <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">There are no open positions right now. Check back soon.</p>;
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {jobs.map((j) => (
        <li key={j.id}>
          <Link href={`/careers/${encodeURIComponent(j.id)}`} className="group flex items-center gap-4 p-5 transition-colors hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <BriefcaseBusiness className="hidden size-5 shrink-0 text-primary sm:block" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-foreground">{j.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{jobFacts(j)}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
              <span className="hidden sm:inline">View &amp; apply</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
