"use server";

import { headers } from "next/headers";
import { checkAndRecordAttempt, isDistinguishingClientIp } from "@/lib/security/rateLimiter";
import { careerApplicationStatus, submitCareerApplication, type ApplicationStatusView } from "@/modules/careers/wonderjobs";

/**
 * The careers page's two actions. Signed-out visitors use them, so each is rate-limited per address before
 * anything reaches WonderJobs; WonderJobs validates the application again and is the system of record for it.
 * Nothing here trusts a client value beyond the form's own fields.
 */

export type ApplyState = { status: "idle" } | { status: "submitted"; email: string } | { status: "error"; message: string };

const str = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").slice(0, max);

async function limited(bucket: string, max: number): Promise<boolean> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!isDistinguishingClientIp(ip)) return false;
  try {
    return !(await checkAndRecordAttempt(bucket, ip, { maxAttempts: max, windowSeconds: 3600 })).allowed;
  } catch {
    // The limiter throttles abuse; it is not an authorization check. WonderJobs limits per site as well.
    return false;
  }
}

export async function applyAction(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  const jobId = str(form, "jobId", 80);
  // A hidden field people never see: anything typed into it is a bot.
  if (str(form, "website", 200)) return { status: "error", message: "Your application couldn't be sent." };
  if (await limited("careers:apply", 10)) return { status: "error", message: "Too many applications from this network. Please try again in an hour." };
  const input = {
    name: str(form, "name", 200),
    email: str(form, "email", 200),
    phone: str(form, "phone", 60) || undefined,
    location: str(form, "location", 200) || undefined,
    linkedinUrl: str(form, "linkedinUrl", 600) || undefined,
    resumeUrl: str(form, "resumeUrl", 600),
    coverNote: str(form, "coverNote", 5000) || undefined,
    consent: form.get("consent") === "on",
  };
  const r = await submitCareerApplication(jobId, input);
  switch (r.state) {
    case "ok":
      return { status: "submitted", email: input.email.trim().toLowerCase() };
    case "rejected":
      return { status: "error", message: r.message };
    case "not_found":
      return { status: "error", message: "This position is no longer open." };
    default:
      return { status: "error", message: "Applications can't be received right now. Please try again later, or email connect@wonderapps.biz." };
  }
}

export type WithdrawState = { status: "idle" } | { status: "done"; application: ApplicationStatusView } | { status: "error"; message: string };

export async function withdrawAction(_prev: WithdrawState, form: FormData): Promise<WithdrawState> {
  if (await limited("careers:status", 30)) return { status: "error", message: "Too many requests. Please try again later." };
  const r = await careerApplicationStatus(str(form, "token", 200), "withdraw");
  if (r.state === "ok") return { status: "done", application: r.data };
  if (r.state === "rejected") return { status: "error", message: r.message };
  return { status: "error", message: "Your application couldn't be withdrawn right now. Please try again later." };
}
