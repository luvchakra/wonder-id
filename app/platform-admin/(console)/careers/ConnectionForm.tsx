"use client";

import { useActionState } from "react";
import { PendingSubmitButton, TextField } from "@/modules/ui";
import { removeCareersConnectionAction, saveCareersConnectionAction, type CareersConnectionState } from "@/app/actions/platformCareers";

/**
 * Paste the WonderJobs career-site key. It is checked with WonderJobs before it is saved, so a
 * mistyped or revoked key is refused here rather than breaking the careers page. The saved key is
 * never shown again; replacing it is pasting a new one.
 */
export function ConnectionForm({ hasSavedKey, baseUrl }: { hasSavedKey: boolean; baseUrl: string | null }) {
  const [state, save] = useActionState<CareersConnectionState, FormData>(saveCareersConnectionAction, { ok: false, message: null });
  const [removed, remove] = useActionState<CareersConnectionState, FormData>(removeCareersConnectionAction, { ok: false, message: null });
  const message = state.message ?? removed.message;
  const ok = state.message ? state.ok : removed.ok;
  return (
    <div className="space-y-4">
      <form action={save} className="space-y-3">
        <TextField
          label={hasSavedKey ? "Replace the career site key" : "Career site key"}
          name="key"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="wjcs_…"
          hint="In WonderJobs: Hiring → Jobs → Career sites → Add site (WonderID careers, https://id.wonderapps.biz/careers). The key is shown there once."
        />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">WonderJobs address</summary>
          <div className="mt-2">
            <TextField label="Address" name="baseUrl" type="url" defaultValue={baseUrl ?? ""} placeholder="https://jobs.wonderapps.biz" hint="Leave empty for https://jobs.wonderapps.biz." />
          </div>
        </details>
        <PendingSubmitButton pendingLabel="Checking with WonderJobs…">Save and connect</PendingSubmitButton>
      </form>
      {message && (
        <p role={ok ? "status" : "alert"} className={ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {message}
        </p>
      )}
      {hasSavedKey && (
        <form action={remove}>
          <PendingSubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
            Remove saved key
          </PendingSubmitButton>
        </form>
      )}
    </div>
  );
}
