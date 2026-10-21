import type { CareerJob } from "./wonderjobs";

const WORK_MODE: Record<CareerJob["workMode"], string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const JOB_TYPE: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Short-term", gig: "Gig" };

/** One line under a job's title: place, work mode, type and pay when the job gives it. */
export function jobFacts(j: Pick<CareerJob, "location" | "workMode" | "jobType" | "salaryMin" | "salaryMax" | "currency">): string {
  return [j.location, WORK_MODE[j.workMode], j.jobType ? JOB_TYPE[j.jobType] : undefined, salary(j)].filter(Boolean).join(" · ");
}

function salary(j: Pick<CareerJob, "salaryMin" | "salaryMax" | "currency">): string | undefined {
  if (j.salaryMin == null && j.salaryMax == null) return undefined;
  const f = new Intl.NumberFormat(j.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: j.currency || "INR", maximumFractionDigits: 0 });
  if (j.salaryMin != null && j.salaryMax != null) return `${f.format(j.salaryMin)}–${f.format(j.salaryMax)} a year`;
  return `${j.salaryMin != null ? "From " + f.format(j.salaryMin) : "Up to " + f.format(j.salaryMax!)} a year`;
}

/** A job's description as paragraphs and bullet lists, from the plain text WonderJobs stores. */
export function descriptionBlocks(text: string): ({ kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "h"; text: string })[] {
  const out: ({ kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "h"; text: string })[] = [];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const bullets = lines.filter((l) => /^[-•*]\s+/.test(l));
    const heading = lines[0].endsWith(":") && lines[0].length < 80 ? lines.shift()! : null;
    if (heading) out.push({ kind: "h", text: heading.slice(0, -1) });
    if (bullets.length && bullets.length === lines.length) out.push({ kind: "ul", items: lines.map((l) => l.replace(/^[-•*]\s+/, "")) });
    else if (lines.length) out.push({ kind: "p", text: lines.join(" ") });
  }
  return out;
}
