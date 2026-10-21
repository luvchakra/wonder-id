import type { Metadata } from "next";
import Link from "next/link";
import { careerApplicationStatus } from "@/modules/careers/wonderjobs";
import { WithdrawForm } from "./WithdrawForm";

export const dynamic = "force-dynamic";

// The address carries the applicant's status token: never indexed, never sent on as a referrer.
export const metadata: Metadata = { title: { absolute: "Your application · WonderID" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<{ t?: string }> };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function ApplicationStatusPage({ searchParams }: Props) {
  const token = (await searchParams).t ?? "";
  const r = await careerApplicationStatus(token);
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">Your application</p>
        {r.state === "ok" ? (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">{r.data.jobTitle}</h1>
            <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-y-2 rounded-xl border border-border bg-card p-5 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-semibold text-foreground">{r.data.statusLabel}</dd>
              <dt className="text-muted-foreground">Applied</dt>
              <dd className="text-foreground">{when(r.data.appliedAt)}</dd>
              <dt className="text-muted-foreground">Last update</dt>
              <dd className="text-foreground">{when(r.data.updatedAt)}</dd>
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">We email you at every step. To add something to your application, reply to any of our emails.</p>
            {r.data.canWithdraw && <WithdrawForm token={token} />}
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground">
              {r.state === "not_found" ? "We couldn't find that application." : "Your application can't be shown right now."}
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              {r.state === "not_found" ? "Open the link in your confirmation email again; it must be complete." : "Please try again later."}
            </p>
          </>
        )}
        <Link href="/careers" className="mt-8 inline-block text-sm font-medium text-primary hover:underline">
          See open positions
        </Link>
      </div>
    </section>
  );
}
