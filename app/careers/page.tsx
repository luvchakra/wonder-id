import { listCareerJobs } from "@/modules/careers/wonderjobs";
import { JobList } from "./JobList";

/** Positions are posted in WonderJobs and re-read at most every five minutes. */
export const revalidate = 300;

export default async function CareersPage() {
  const jobs = await listCareerJobs();
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">Careers</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">Help govern every identity.</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          WonderID is building one control plane for people, partners, machines and AI agents. We&rsquo;re a small team working with
          security and identity leaders, and we&rsquo;re hiring across partnerships, sales, marketing and engineering.
        </p>
        <div className="mt-10">
          <JobList result={jobs} />
        </div>
      </div>
    </section>
  );
}
