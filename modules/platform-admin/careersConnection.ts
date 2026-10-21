import "server-only";

import { cache } from "react";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { decryptSecret, encryptSecret } from "@/lib/security/encryptSecret";
import { writePlatformAudit } from "./auditLog";

/**
 * WonderID's careers connection to WonderJobs (owner request, 2026-10-21): the
 * career site's key, set by a platform administrator in the vendor console
 * (/platform-admin/careers) so a new or rotated key works without a
 * deployment. Stored encrypted in `platform_careers_connection` (0210); only
 * its last four characters are ever shown. The `WONDERJOBS_CAREERS_KEY` /
 * `WONDERJOBS_CAREERS_URL` environment variables still work as a fallback
 * when nothing is saved here.
 *
 * Platform Agent owns the table and this module; the careers client (EA's
 * modules/careers) reads the credentials through `resolveCareersCredentials`,
 * published in ./service. Service role only (the table has no client
 * policy). Callers that change it check `requirePlatformAdmin()` first
 * (app/actions/platformCareers.ts).
 */

export type CareersConnection = {
  /** Where the key in use comes from. */
  source: "console" | "environment" | "none";
  keyHint: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
};

type Row = { encrypted_key: string; key_hint: string; base_url: string | null; updated_at: string };

export const CAREERS_KEY_PATTERN = /^wjcs_[A-Za-z0-9_-]{20,120}$/;

async function readRow(): Promise<Row | null> {
  const { data, error } = await supabaseServiceRole().from("platform_careers_connection").select("encrypted_key, key_hint, base_url, updated_at").eq("id", true).maybeSingle();
  if (error) throw new Error(`careers connection unreadable: ${error.message}`);
  return (data as Row | null) ?? null;
}

/**
 * The key and address the careers client uses: the console's, else the
 * environment's. Read once per request. An unreadable store falls back to the
 * environment, logged; it never invents a key.
 */
export const resolveCareersCredentials = cache(async (): Promise<{ key: string | null; baseUrl: string | null }> => {
  try {
    const row = await readRow();
    if (row) return { key: await decryptSecret(row.encrypted_key), baseUrl: row.base_url };
  } catch (err) {
    console.error("careers: connection store unavailable:", err instanceof Error ? err.message : "error");
  }
  return { key: process.env.WONDERJOBS_CAREERS_KEY?.trim() || null, baseUrl: process.env.WONDERJOBS_CAREERS_URL?.trim() || null };
});

/** What the console shows: never the key itself. */
export async function getCareersConnection(): Promise<CareersConnection> {
  const row = await readRow();
  if (row) return { source: "console", keyHint: row.key_hint, baseUrl: row.base_url, updatedAt: row.updated_at };
  const envKey = process.env.WONDERJOBS_CAREERS_KEY?.trim();
  if (envKey) return { source: "environment", keyHint: envKey.slice(-4), baseUrl: process.env.WONDERJOBS_CAREERS_URL?.trim() || null, updatedAt: null };
  return { source: "none", keyHint: null, baseUrl: null, updatedAt: null };
}

/** Saves (or replaces) the key. The caller has already checked it against WonderJobs. */
export async function saveCareersConnection(actorId: string, key: string, baseUrl: string | null): Promise<void> {
  if (!CAREERS_KEY_PATTERN.test(key)) throw new Error("invalid key");
  const before = await readRow().catch(() => null);
  const row = { id: true, encrypted_key: await encryptSecret(key), key_hint: key.slice(-4), base_url: baseUrl, updated_at: new Date().toISOString(), updated_by: actorId, ...(before ? {} : { created_by: actorId }) };
  const { error } = await supabaseServiceRole().from("platform_careers_connection").upsert(row, { onConflict: "id" });
  if (error) {
    await writePlatformAudit({ actorId, action: "careers.connection_saved", result: "failure", newValue: { keyHint: row.key_hint } });
    throw new Error(`careers connection not saved: ${error.message}`);
  }
  await writePlatformAudit({ actorId, action: "careers.connection_saved", result: "success", oldValue: before ? { keyHint: before.key_hint, baseUrl: before.base_url } : undefined, newValue: { keyHint: row.key_hint, baseUrl } });
}

/** Removes the saved key; the environment variable, if set, applies again. */
export async function removeCareersConnection(actorId: string): Promise<void> {
  const before = await readRow();
  if (!before) return;
  const { error } = await supabaseServiceRole().from("platform_careers_connection").delete().eq("id", true);
  if (error) throw new Error(`careers connection not removed: ${error.message}`);
  await writePlatformAudit({ actorId, action: "careers.connection_removed", result: "success", oldValue: { keyHint: before.key_hint, baseUrl: before.base_url } });
}
