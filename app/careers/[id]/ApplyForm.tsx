"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PendingSubmitButton, TextField, TextareaField } from "@/modules/ui";
import { applyAction, type ApplyState } from "../actions";

/**
 * The standard application form. It posts to the careers server action, which hands the application to
 * WonderJobs; the page shows "submitted" only once WonderJobs has stored it (§17.5).
 */
export function ApplyForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState<ApplyState, FormData>(applyAction, { status: "idle" });
  if (state.status === "submitted") {
    return (
      <div role="status" className="mt-4 flex gap-3 rounded-lg border border-success/40 bg-success/10 p-4 text-sm text-foreground">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        <p>
          Thank you — your application is in. A confirmation is on its way to <span className="font-medium">{state.email}</span>, with a link to
          check its status. We&rsquo;ll email you at every step.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="jobId" value={jobId} />
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <TextField label="Full name" name="name" required maxLength={120} autoComplete="name" />
      <TextField label="Email" name="email" type="email" required maxLength={200} autoComplete="email" />
      <TextField label="Phone" name="phone" type="tel" maxLength={40} autoComplete="tel" />
      <TextField label="Location" name="location" maxLength={120} autoComplete="address-level2" placeholder="City, country" />
      <div className="sm:col-span-2">
        <TextField label="Résumé link" name="resumeUrl" type="url" required maxLength={500} placeholder="https://" hint="A link to your résumé or CV (Google Drive, Dropbox, LinkedIn or your own site) that anyone with the link can open." />
      </div>
      <div className="sm:col-span-2">
        <TextField label="LinkedIn or portfolio" name="linkedinUrl" type="url" maxLength={500} placeholder="https://" />
      </div>
      <div className="sm:col-span-2">
        <TextareaField label="Why this role? (optional)" name="coverNote" rows={4} maxLength={4000} />
      </div>
      <label className="flex items-start gap-2 text-sm text-muted-foreground sm:col-span-2">
        <input type="checkbox" name="consent" required className="mt-1 size-4 accent-primary" />
        <span>I agree that WonderID and WonderJobs, which handles our applications, may store and use these details to consider me for this position and email me about it.</span>
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <PendingSubmitButton pendingLabel="Submitting…">Submit application</PendingSubmitButton>
      </div>
    </form>
  );
}
