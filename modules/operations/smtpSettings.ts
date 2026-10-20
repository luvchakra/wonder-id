import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/security/encryptSecret";
import { safeErrorMessage } from "@/lib/security/redact";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RecordProvenanceData } from "@/modules/ui/RecordProvenance";
import { sendSmtpMail, type SmtpServer } from "@/modules/integrations/service";
import { smtpFrom, type SmtpSecurity, type SmtpSettingsInput } from "./smtpRules";

/**
 * The organization's own outgoing mail server (owner test feedback item
 * 14, 2026-10-20). `tenant_smtp_settings` has no client policy (migration
 * 0208): every function here uses the service role, so each one filters by
 * the caller's tenant itself. The password is stored encrypted and never
 * leaves the server; the page sees only whether one is stored. Callers
 * check `notification.manage` before saving or testing.
 */

export type SmtpSettingsView = {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  hasPassword: boolean;
  fromEmail: string;
  fromName: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  /** Who set it up and last changed it (§19.10). */
  provenance: RecordProvenanceData;
};

type Row = {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  encrypted_password: string | null;
  from_email: string;
  from_name: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

const COLUMNS =
  "enabled, host, port, security, username, encrypted_password, from_email, from_name, last_test_at, last_test_ok, last_test_error, created_at, updated_at, created_by, updated_by";

async function readRow(tenantId: string): Promise<Row | null> {
  const { data, error } = await supabaseServiceRole().from("tenant_smtp_settings").select(COLUMNS).eq("tenant_id", tenantId).maybeSingle<Row>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data;
}

export async function getSmtpSettings(tenantId: string): Promise<SmtpSettingsView | null> {
  const row = await readRow(tenantId);
  if (!row) return null;
  // The table has no client policy, so getRecordProvenance (which reads under RLS) cannot see it; the two names are looked up here.
  const ids = [...new Set([row.created_by, row.updated_by].filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabaseServiceRole().from("users").select("id, email, display_name").in("id", ids);
    for (const p of (people ?? []) as { id: string; email: string | null; display_name: string | null }[]) names.set(p.id, p.display_name || p.email || "A former member");
  }
  const person = (uid: string | null) => (uid ? { id: uid, name: names.get(uid) ?? "A former member" } : null);
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    hasPassword: Boolean(row.encrypted_password),
    fromEmail: row.from_email,
    fromName: row.from_name,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok,
    lastTestError: row.last_test_error,
    provenance: { createdAt: row.created_at, createdBy: person(row.created_by), updatedAt: row.updated_at, updatedBy: person(row.updated_by) },
  };
}

export async function saveSmtpSettings(actorId: string, tenantId: string, input: SmtpSettingsInput): Promise<void> {
  const existing = await readRow(tenantId);
  // A user name removed means no sign-in: the stored password goes with it.
  const encrypted = !input.username ? null : input.password ? await encryptSecret(input.password) : (existing?.encrypted_password ?? null);
  const row = {
    tenant_id: tenantId,
    enabled: input.enabled,
    host: input.host,
    port: input.port,
    security: input.security,
    username: input.username,
    encrypted_password: encrypted,
    from_email: input.fromEmail,
    from_name: input.fromName,
    // A changed server has not been tested yet.
    last_test_at: null,
    last_test_ok: null,
    last_test_error: null,
  };
  const { error } = await supabaseServiceRole().from("tenant_smtp_settings").upsert(row, { onConflict: "tenant_id" });
  if (error) throw new ApiError(500, "SAVE_FAILED", error.message);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: existing ? "smtp_settings.updated" : "smtp_settings.created",
    objectType: "smtp_settings",
    objectId: tenantId,
    outcome: "success",
    // Never the password; only whether it changed.
    metadata: { enabled: input.enabled, host: input.host, port: input.port, security: input.security, passwordChanged: Boolean(input.password) },
  });
}

export async function removeSmtpSettings(actorId: string, tenantId: string): Promise<void> {
  const { error } = await supabaseServiceRole().from("tenant_smtp_settings").delete().eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "SAVE_FAILED", error.message);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "smtp_settings.removed", objectType: "smtp_settings", objectId: tenantId, outcome: "success" });
}

/** The server the organization's mail goes through, or null for WonderID's own provider. */
export async function resolveTenantSmtp(tenantId: string): Promise<{ server: SmtpServer; from: string } | null> {
  const row = await readRow(tenantId);
  if (!row || !row.enabled) return null;
  return {
    server: {
      host: row.host,
      port: row.port,
      security: row.security,
      username: row.username,
      password: row.encrypted_password ? await decryptSecret(row.encrypted_password) : null,
    },
    from: smtpFrom(row.from_email, row.from_name),
  };
}

/**
 * Sends one test message to `to` through the saved server (whether or not
 * it is turned on) and records the result on the settings. Returns the
 * outcome; never reports success for a send that failed (§17.5).
 */
export async function sendSmtpTest(actorId: string, tenantId: string, to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await readRow(tenantId);
  if (!row) return { ok: false, error: "Save the server settings first." };
  let result: { ok: true } | { ok: false; error: string };
  try {
    await sendSmtpMail(
      {
        host: row.host,
        port: row.port,
        security: row.security,
        username: row.username,
        password: row.encrypted_password ? await decryptSecret(row.encrypted_password) : null,
      },
      {
        from: smtpFrom(row.from_email, row.from_name),
        to,
        subject: "WonderID test e-mail",
        text: "This message was sent through your organization's mail server settings in WonderID. If you can read it, the settings work.\n\nWonderID\n",
      },
    );
    result = { ok: true };
  } catch (err) {
    result = { ok: false, error: safeErrorMessage(err).slice(0, 500) };
  }
  const { error } = await supabaseServiceRole()
    .from("tenant_smtp_settings")
    .update({ last_test_at: new Date().toISOString(), last_test_ok: result.ok, last_test_error: result.ok ? null : result.error })
    .eq("tenant_id", tenantId);
  if (error) console.error("sendSmtpTest could not record the result", error.message);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "smtp_settings.tested",
    objectType: "smtp_settings",
    objectId: tenantId,
    outcome: result.ok ? "success" : "failure",
    metadata: { host: row.host, port: row.port },
    typedText: { to },
  });
  return result;
}
