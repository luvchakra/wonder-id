"use client";

import { useActionState } from "react";
import { removeSmtpSettingsAction, saveSmtpSettingsAction, testSmtpSettingsAction, type SmtpFormState } from "@/app/actions/smtp";
import { PendingSubmitButton, SelectField, TextField } from "@/modules/ui";
import { cn } from "@/lib/utils";

const initial: SmtpFormState = { ok: false, message: null };

type Saved = {
  enabled: boolean;
  host: string;
  port: number;
  security: "ssl" | "starttls";
  username: string | null;
  hasPassword: boolean;
  fromEmail: string;
  fromName: string | null;
};

function Message({ state }: { state: SmtpFormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "max-w-xl rounded-md border px-3 py-2 text-sm",
        state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {state.message}
    </p>
  );
}

function FieldError({ state, name }: { state: SmtpFormState; name: string }) {
  const error = state.errors?.[name];
  return error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null;
}

/** The organization's outgoing mail server: one form, Save; Send test and Remove once saved. */
export function SmtpSettingsForm({ saved }: { saved: Saved | null }) {
  const [state, save] = useActionState(saveSmtpSettingsAction, initial);
  const [testState, test] = useActionState(testSmtpSettingsAction, initial);
  const [removeState, remove] = useActionState(removeSmtpSettingsAction, initial);

  return (
    <div className="space-y-4">
      <form action={save} className="grid max-w-xl gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label="Server" name="host" required defaultValue={saved?.host ?? ""} placeholder="smtpout.secureserver.net" autoComplete="off" />
          <FieldError state={state} name="host" />
        </div>
        <div>
          <SelectField label="Security" name="security" defaultValue={saved?.security ?? "ssl"}>
            <option value="ssl">SSL/TLS (usually port 465)</option>
            <option value="starttls">STARTTLS (usually port 587)</option>
          </SelectField>
          <FieldError state={state} name="security" />
        </div>
        <div>
          <TextField label="Port" name="port" inputMode="numeric" defaultValue={saved ? String(saved.port) : ""} placeholder="Default for the security" />
          <FieldError state={state} name="port" />
        </div>
        <div>
          <TextField label="User name" name="username" defaultValue={saved?.username ?? ""} autoComplete="off" />
          <FieldError state={state} name="username" />
        </div>
        <div>
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={saved?.hasPassword ? "Stored; leave blank to keep it" : ""}
          />
          <FieldError state={state} name="password" />
        </div>
        <div>
          <TextField label="From address" name="fromEmail" type="email" required defaultValue={saved?.fromEmail ?? ""} />
          <FieldError state={state} name="fromEmail" />
        </div>
        <div>
          <TextField label="From name" name="fromName" defaultValue={saved?.fromName ?? ""} placeholder="Optional" />
          <FieldError state={state} name="fromName" />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
          <input type="checkbox" name="enabled" defaultChecked={saved?.enabled ?? true} />
          Send this organization&apos;s e-mail through this server
        </label>
        <div className="space-y-3 sm:col-span-2">
          <Message state={state} />
          <PendingSubmitButton size="sm" pendingLabel="Saving…">
            Save
          </PendingSubmitButton>
        </div>
      </form>

      {saved ? (
        <div className="flex flex-wrap items-start gap-3 border-t border-border pt-4">
          <form action={test} className="space-y-2">
            <PendingSubmitButton size="sm" variant="secondary" pendingLabel="Sending…">
              Send test e-mail
            </PendingSubmitButton>
            <Message state={testState} />
          </form>
          <form action={remove} className="space-y-2">
            <PendingSubmitButton size="sm" variant="ghost" pendingLabel="Removing…">
              Remove server
            </PendingSubmitButton>
            <Message state={removeState} />
          </form>
        </div>
      ) : null}
    </div>
  );
}
