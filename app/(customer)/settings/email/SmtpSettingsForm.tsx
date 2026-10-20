"use client";

import { useActionState, useState } from "react";
import type { SmtpPreset } from "@/modules/operations/service";
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
export function SmtpSettingsForm({ saved, presets, initialPreset }: { saved: Saved | null; presets: SmtpPreset[]; initialPreset: string }) {
  const [presetId, setPresetId] = useState(initialPreset);
  const preset = presets.find((p) => p.id === presetId) ?? null;
  // A provider fills in its server, security, port and (where it has one) user name; every field stays editable.
  const applyPreset = (form: HTMLFormElement | null, id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!form || !p) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = value;
    };
    set("host", p.host);
    set("security", p.security);
    set("port", String(p.port));
    if (p.username) set("username", p.username);
  };
  const [state, save] = useActionState(saveSmtpSettingsAction, initial);
  const [testState, test] = useActionState(testSmtpSettingsAction, initial);
  const [removeState, remove] = useActionState(removeSmtpSettingsAction, initial);

  return (
    <div className="space-y-4">
      <form action={save} className="grid max-w-xl gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SelectField label="Provider" name="provider" value={presetId} onChange={(e) => applyPreset(e.currentTarget.form, e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="">Other (enter the settings)</option>
          </SelectField>
          {preset?.note ? <p className="mt-1 text-xs text-muted-foreground">{preset.note}</p> : null}
        </div>
        <div className="sm:col-span-2">
          <TextField label="Server" name="host" required defaultValue={saved?.host ?? preset?.host ?? ""} placeholder="smtp.example.com" autoComplete="off" />
          <FieldError state={state} name="host" />
        </div>
        <div>
          <SelectField label="Security" name="security" defaultValue={saved?.security ?? preset?.security ?? "ssl"}>
            <option value="ssl">SSL/TLS (usually port 465)</option>
            <option value="starttls">STARTTLS (usually port 587)</option>
          </SelectField>
          <FieldError state={state} name="security" />
        </div>
        <div>
          <TextField label="Port" name="port" inputMode="numeric" defaultValue={saved ? String(saved.port) : preset ? String(preset.port) : ""} placeholder="Default for the security" />
          <FieldError state={state} name="port" />
        </div>
        <div>
          <TextField label="User name" name="username" defaultValue={saved?.username ?? preset?.username ?? ""} autoComplete="off" />
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
