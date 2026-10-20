import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getResendApiKey, getResendFromEmail } from "@/lib/db/env";
import { safeErrorMessage } from "@/lib/security/redact";
import { sendSmtpMail, type SmtpServer } from "@/modules/integrations/service";
import type { NotifyEvent } from "@/lib/shared/types/operations";
import { resolveTenantSmtp } from "./smtpSettings";

const RESEND_SEND_URL = "https://api.resend.com/emails";

/**
 * OPERATIONS-P0-02.1's email channel, resolved 2026-09-16 (user picked
 * Resend); since 2026-10-20 an organization's own mail server when it has
 * one (sendTenantEmail below). sendNotificationEmail is internal: notify()
 * (./notifications.ts) is its only caller. Never throws: an email
 * delivery failure must never abort the in-app notification write that
 * triggered it, same never-fails-the-caller discipline as writeAudit()
 * and notify() itself.
 *
 * Calls Resend's REST API directly via fetch() — no new npm dependency,
 * matching this codebase's minimal-dependency ethos (same choice already
 * made for OpenAI/Gemini in lib/ai/summarize.ts).
 */
export async function sendNotificationEmail(event: NotifyEvent): Promise<void> {
  try {
    const channel = await resolveChannel(event.tenantId);
    if (!channel) return; // Not configured — in-app-only, no error.
    const recipients = await resolveEmailRecipients(event);
    await Promise.all(recipients.map((to) => deliver(channel, { to, subject: event.title, text: event.body }, event.type)));
  } catch (err) {
    console.error("sendNotificationEmail threw", { type: event.type, err });
  }
}

/**
 * One e-mail from an organization: through its own mail server when one is
 * set up and turned on (Organization Settings › Email (SMTP), owner test
 * feedback item 14), otherwise through WonderID's provider (Resend), as
 * before. Returns whether it was sent; never throws. Not configured at all
 * is "not sent", without an error.
 */
export async function sendTenantEmail(tenantId: string, message: Message): Promise<boolean> {
  try {
    const channel = await resolveChannel(tenantId);
    return channel ? await deliver(channel, message, "email") : false;
  } catch (err) {
    console.error("sendTenantEmail threw", { err: safeErrorMessage(err) });
    return false;
  }
}

type Message = { to: string; subject: string; text: string };
type Channel = { kind: "smtp"; server: SmtpServer; from: string } | { kind: "resend"; apiKey: string; from: string };

async function resolveChannel(tenantId: string): Promise<Channel | null> {
  const smtp = await resolveTenantSmtp(tenantId);
  if (smtp) return { kind: "smtp", ...smtp };
  const apiKey = getResendApiKey();
  const from = getResendFromEmail();
  return apiKey && from ? { kind: "resend", apiKey, from } : null;
}

async function deliver(channel: Channel, message: Message, label: string): Promise<boolean> {
  try {
    if (channel.kind === "smtp") {
      await sendSmtpMail(channel.server, { from: channel.from, ...message });
      return true;
    }
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channel.apiKey}`,
      },
      body: JSON.stringify({ from: channel.from, ...message }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("email delivery failed", { label, channel: channel.kind, status: response.status, detail: detail.slice(0, 500) });
      return false;
    }
    return true;
  } catch (err) {
    console.error("email delivery threw", { label, channel: channel.kind, err: safeErrorMessage(err) });
    return false;
  }
}

/**
 * `event.userId` set -> that one user, if their preference for this type
 * allows email. `event.userId` unset -> every active tenant member whose
 * preference allows it — the same tenant-wide broadcast semantics the
 * in-app channel already uses (`listNotifications()` shows a
 * null-user_id row to every tenant member). A missing preference row
 * defaults to enabled, per OPERATIONS-P0-05.1's own documented default
 * ("a missing row means use the default — both channels on").
 *
 * Every P0 notification type is mandatory in this build (see
 * MANDATORY_NOTIFICATION_TYPES / setNotificationPreference()'s own
 * rejection of emailEnabled:false for a mandatory type), so in practice
 * every recipient's preference is always enabled today — this still reads
 * the real preference row rather than hard-coding that assumption, so it
 * stays correct if a non-mandatory (P1) notification type is ever added.
 */
async function resolveEmailRecipients(event: NotifyEvent): Promise<string[]> {
  const supabase = supabaseServiceRole();

  const userIds: string[] = [];
  if (event.userId) {
    userIds.push(event.userId);
  } else {
    const { data, error } = await supabase
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", event.tenantId)
      .eq("status", "active");
    if (error) {
      console.error("resolveEmailRecipients failed to list tenant members", error.message);
      return [];
    }
    userIds.push(...(data ?? []).map((r: { user_id: string }) => r.user_id));
  }
  if (userIds.length === 0) return [];

  const [usersResult, prefsResult] = await Promise.all([
    supabase.from("users").select("id, email").in("id", userIds),
    supabase
      .from("notification_preferences")
      .select("user_id, email_enabled")
      .eq("tenant_id", event.tenantId)
      .eq("type", event.type)
      .in("user_id", userIds),
  ]);
  if (usersResult.error) {
    console.error("resolveEmailRecipients failed to load users", usersResult.error.message);
    return [];
  }
  if (prefsResult.error) {
    console.error("resolveEmailRecipients failed to load preferences", prefsResult.error.message);
  }

  const disabled = new Set(
    (prefsResult.data ?? [])
      .filter((p: { email_enabled: boolean }) => p.email_enabled === false)
      .map((p: { user_id: string }) => p.user_id),
  );
  return (usersResult.data ?? [])
    .filter((u: { id: string }) => !disabled.has(u.id))
    .map((u: { email: string }) => u.email);
}
