import "server-only";

/**
 * WonderID's careers page is powered by WonderJobs (owner request, 2026-10-21): a platform administrator posts
 * jobs in WonderJobs' Hiring workspace and ticks "On WonderID careers"; this page lists them, takes applications
 * and shows an applicant their status. WonderJobs stores the applications and sends every email.
 *
 * This is WonderID's own vendor provider, like the email and AI providers, never an organization's data
 * (non-negotiable #20; allowlisted in tests/architecture/connector-boundary.test.ts with the owner's request).
 * Only this server calls WonderJobs: the career-site key (`WONDERJOBS_CAREERS_KEY`) never reaches a browser
 * (#10). The host is fixed (https, *.wonderapps.biz), every call has a timeout, and only reads are retried.
 */

export type CareerJob = {
  id: string;
  title: string;
  location: string;
  workMode: "remote" | "hybrid" | "onsite";
  jobType?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  description: string;
  skills: string[];
  company: string;
  updatedAt: string;
};

export type ApplicationStatusView = {
  status: "new" | "reviewing" | "interview" | "offer" | "hired" | "rejected" | "withdrawn";
  statusLabel: string;
  jobTitle: string;
  company: string;
  appliedAt: string;
  updatedAt: string;
  canWithdraw: boolean;
};

export type ApplicationInput = {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  resumeUrl?: string;
  coverNote?: string;
  consent: boolean;
};

/** "needs_setup": no key configured; "unavailable": WonderJobs could not be reached or refused the key. */
export type Result<T> = { state: "ok"; data: T } | { state: "needs_setup" } | { state: "unavailable" } | { state: "not_found" } | { state: "rejected"; message: string };

const DEFAULT_BASE = "https://jobs.wonderapps.biz";
const TIMEOUT_MS = 8_000;

/** WonderJobs' address, only ever an https *.wonderapps.biz host (or localhost in development). */
export function careersBase(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.WONDERJOBS_CAREERS_URL || DEFAULT_BASE).trim().replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    const dev = env.NODE_ENV !== "production" && u.protocol === "http:" && u.hostname === "localhost";
    if (!dev && (u.protocol !== "https:" || !(u.hostname === "wonderapps.biz" || u.hostname.endsWith(".wonderapps.biz")))) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function config(): { base: string; key: string } | null {
  const key = process.env.WONDERJOBS_CAREERS_KEY?.trim();
  const base = careersBase();
  return key && base ? { base, key } : null;
}

/** Where a platform administrator manages WonderID's jobs and applications. */
export function hiringConsoleUrl(): string {
  return `${careersBase() ?? DEFAULT_BASE}/app/hiring?tab=jobs`;
}

export function careersConfigured(): boolean {
  return config() !== null;
}

async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; revalidate?: number } = {}): Promise<Result<T>> {
  const cfg = config();
  if (!cfg) return { state: "needs_setup" };
  const method = init.method ?? "GET";
  const attempts = method === "GET" ? 2 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${cfg.base}/api/careers/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${cfg.key}`, ...(init.body ? { "content-type": "application/json" } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(method === "GET" && init.revalidate ? { next: { revalidate: init.revalidate, tags: ["careers"] } } : { cache: "no-store" as const }),
      });
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (res.ok) return { state: "ok", data: json };
      if (res.status === 404) return { state: "not_found" };
      if (res.status === 400 || res.status === 409) return { state: "rejected", message: json.error ?? "Check the details and try again." };
      if (res.status === 429) return { state: "rejected", message: "Too many applications right now. Please try again in a few minutes." };
      // 401 (a revoked or wrong key) and 5xx: the page says the careers service is unavailable.
      console.error("careers: WonderJobs answered", res.status, path.split("/")[1]);
      if (res.status < 500) return { state: "unavailable" };
    } catch (err) {
      console.error("careers: WonderJobs unreachable:", err instanceof Error ? err.name : "error");
    }
  }
  return { state: "unavailable" };
}

/** Open positions, re-read at most every five minutes. */
export async function listCareerJobs(): Promise<Result<CareerJob[]>> {
  const r = await call<{ jobs: CareerJob[] }>("/jobs", { revalidate: 300 });
  return r.state === "ok" ? { state: "ok", data: r.data.jobs ?? [] } : r;
}

export async function getCareerJob(id: string): Promise<Result<CareerJob>> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { state: "not_found" };
  const r = await call<{ job: CareerJob }>(`/jobs/${encodeURIComponent(id)}`, { revalidate: 300 });
  return r.state === "ok" ? { state: "ok", data: r.data.job } : r;
}

export async function submitCareerApplication(jobId: string, input: ApplicationInput): Promise<Result<{ id: string }>> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(jobId)) return { state: "not_found" };
  return call<{ id: string }>(`/jobs/${encodeURIComponent(jobId)}/applications`, { method: "POST", body: input });
}

/** The applicant's own status, from the token in their email. The token goes in the body, never a URL we call. */
export async function careerApplicationStatus(token: string, action: "view" | "withdraw" = "view"): Promise<Result<ApplicationStatusView>> {
  if (!/^wjst_[A-Za-z0-9_-]{20,120}$/.test(token)) return { state: "not_found" };
  const r = await call<{ application: ApplicationStatusView }>("/applications/status", { method: "POST", body: { token, action } });
  return r.state === "ok" ? { state: "ok", data: r.data.application } : r;
}
