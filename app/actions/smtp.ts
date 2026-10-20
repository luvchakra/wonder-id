"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getSessionUser } from "@/lib/tenant/session";
import { checkSmtpSettings, getSmtpSettings, removeSmtpSettings, saveSmtpSettings, sendSmtpTest } from "@/modules/operations/service";

export type SmtpFormState = { ok: boolean; message: string | null; errors?: Record<string, string> };

async function context(): Promise<{ userId: string; tenantId: string; email: string | null } | string> {
  try {
    const ctx = await requirePermission("notification.manage");
    const user = await getSessionUser();
    return { userId: ctx.userId, tenantId: ctx.tenantId!, email: user?.email ?? null };
  } catch (err) {
    if (err instanceof ApiError) return err.status === 403 ? "You don't have permission to change the mail server." : err.message;
    throw err;
  }
}

/** Saves the organization's mail server (Organization Settings › Email (SMTP)). */
export async function saveSmtpSettingsAction(_prev: SmtpFormState, formData: FormData): Promise<SmtpFormState> {
  const ctx = await context();
  if (typeof ctx === "string") return { ok: false, message: ctx };
  const existing = await getSmtpSettings(ctx.tenantId);
  const form = Object.fromEntries(["enabled", "host", "port", "security", "username", "password", "fromEmail", "fromName"].map((k) => [k, formData.get(k)?.toString()]));
  const checked = checkSmtpSettings(form, Boolean(existing?.hasPassword));
  if (!checked.ok) return { ok: false, message: "Check the highlighted fields.", errors: checked.errors };
  await saveSmtpSettings(ctx.userId, ctx.tenantId, checked.value);
  revalidatePath("/settings/email");
  return { ok: true, message: "Saved. Send a test e-mail to check the settings." };
}

/** Sends a test message to the signed-in administrator through the saved server. */
export async function testSmtpSettingsAction(): Promise<SmtpFormState> {
  const ctx = await context();
  if (typeof ctx === "string") return { ok: false, message: ctx };
  if (!ctx.email) return { ok: false, message: "Your account has no e-mail address to send the test to." };
  const result = await sendSmtpTest(ctx.userId, ctx.tenantId, ctx.email);
  revalidatePath("/settings/email");
  return result.ok ? { ok: true, message: `Test e-mail sent to ${ctx.email}. Check that it arrived.` } : { ok: false, message: `The test failed: ${result.error}` };
}

/** Removes the mail server; e-mail goes back to WonderID's own provider. */
export async function removeSmtpSettingsAction(): Promise<SmtpFormState> {
  const ctx = await context();
  if (typeof ctx === "string") return { ok: false, message: ctx };
  await removeSmtpSettings(ctx.userId, ctx.tenantId);
  revalidatePath("/settings/email");
  return { ok: true, message: "Removed. E-mail now goes through WonderID's own provider." };
}
