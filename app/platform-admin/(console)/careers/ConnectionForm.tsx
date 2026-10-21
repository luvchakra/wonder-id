"use client";

import { useActionState, useState } from "react";
import { Button, Field, PendingSubmitButton, TextField, fieldInputClass } from "@/modules/ui";
import { removeCareersConnectionAction, saveCareersConnectionAction, type CareersConnectionState } from "@/app/actions/platformCareers";

/**
 * The WonderJobs career-site key. With a key set, it shows masked (its last four characters, the only part
 * the server keeps in clear) with Replace key; the box to paste one appears only when there is none or on
 * Replace. A new key is checked with WonderJobs before it is saved, so a mistyped or revoked key is refused
 * here rather than breaking the careers page. The key itself is never sent back to the browser.
 */
export function ConnectionForm({ keyHint, source, baseUrl }: { keyHint: string | null; source: "console" | "environment" | "none"; baseUrl: string | null }) {
  const [state, save] = useActionState<CareersConnectionState, FormData>(saveCareersConnectionAction, { ok: false, message: null });
  const [removed, remove] = useActionState<CareersConnectionState, FormData>(removeCareersConnectionAction, { ok: false, message: null });
  // Replace key remembers the save result it was opened at; a successful save after that closes the box
  // again, and the masked value then shows the new key's last four characters. A refused key keeps it open.
  const [openedAt, setOpenedAt] = useState<CareersConnectionState | null>(null);
  const replacing = openedAt !== null && !(state.ok && state !== openedAt);
  const setReplacing = (on: boolean) => setOpenedAt(on ? state : null);
  const message = state.message ?? removed.message;
  const ok = state.message ? state.ok : removed.ok;
  const hasKey = !!keyHint && source !== "none";
  const editing = !hasKey || replacing;

  return (
    <div className="space-y-4">
      {hasKey && !replacing && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Career site key" htmlFor="careers-key-masked" hint={source === "environment" ? "From the WONDERJOBS_CAREERS_KEY environment variable. A key saved here replaces it." : undefined}>
              <input id="careers-key-masked" readOnly value={`wjcs_${"•".repeat(12)}${keyHint}`} aria-label={`Career site key ending in ${keyHint}`} className={`${fieldInputClass} font-mono tracking-wide text-muted-foreground`} />
            </Field>
          </div>
          <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
            Replace key
          </Button>
        </div>
      )}
      {editing && (
        <form action={save} className="space-y-3">
          <TextField
            label={hasKey ? "New career site key" : "Career site key"}
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
          <div className="flex flex-wrap gap-2">
            <PendingSubmitButton pendingLabel="Checking with WonderJobs…">Save and connect</PendingSubmitButton>
            {hasKey && (
              <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {message && (
        <p role={ok ? "status" : "alert"} className={ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {message}
        </p>
      )}
      {source === "console" && !replacing && (
        <form action={remove}>
          <PendingSubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
            Remove saved key
          </PendingSubmitButton>
        </form>
      )}
    </div>
  );
}
