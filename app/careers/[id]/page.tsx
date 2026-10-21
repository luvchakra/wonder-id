import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { descriptionBlocks, jobFacts } from "@/modules/careers/format";
import { getCareerJob } from "@/modules/careers/wonderjobs";
import { ApplyForm } from "./ApplyForm";

export const revalidate = 300;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getCareerJob((await params).id);
  return r.state === "ok" ? { title: { absolute: `${r.data.title} · Careers · WonderID` }, description: r.data.description.slice(0, 160) } : { title: { absolute: "Careers · WonderID" } };
}

export default async function CareerJobPage({ params }: Props) {
  const r = await getCareerJob((await params).id);
  if (r.state === "not_found") notFound();
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <Link href="/careers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> All positions
        </Link>
        {r.state !== "ok" ? (
          <p className="mt-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">This position can&rsquo;t be shown right now. Please try again later.</p>
        ) : (
          <>
            <h1 className="mt-6 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">{r.data.title}</h1>
            <p className="mt-3 text-sm text-muted-foreground">{jobFacts(r.data)}</p>
            <div className="mt-6">
              <a href="#apply" className="inline-flex h-10 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                Apply
              </a>
            </div>
            <div className="mt-10 max-w-none space-y-4 text-base leading-relaxed text-foreground">
              {descriptionBlocks(r.data.description).map((b, i) =>
                b.kind === "h" ? (
                  <h2 key={i} className="pt-2 text-lg font-semibold">
                    {b.text}
                  </h2>
                ) : b.kind === "ul" ? (
                  <ul key={i} className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {b.items.map((it, k) => (
                      <li key={k}>{it}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} className="text-muted-foreground">
                    {b.text}
                  </p>
                ),
              )}
            </div>
            {r.data.skills.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-2" aria-label="Skills">
                {r.data.skills.map((s) => (
                  <li key={s} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <div id="apply" className="mt-14 scroll-mt-20 rounded-xl border border-border bg-card p-5 sm:p-8">
              <h2 className="text-xl font-semibold text-foreground">Apply for this position</h2>
              <ApplyForm jobId={r.data.id} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
