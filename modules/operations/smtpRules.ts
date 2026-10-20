/**
 * The organization's outgoing mail server settings (owner test feedback
 * item 14): what a valid form is. Pure, so it is unit-tested without a
 * database.
 */

export type SmtpSecurity = "ssl" | "starttls";

export type SmtpSettingsInput = {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  /** Empty: keep the stored password. */
  password: string | null;
  fromEmail: string;
  fromName: string | null;
};

export type SmtpCheck = { ok: true; value: SmtpSettingsInput } | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** The default port for each kind of TLS. */
export const SMTP_DEFAULT_PORT: Record<SmtpSecurity, number> = { ssl: 465, starttls: 587 };

export function checkSmtpSettings(form: Record<string, string | undefined>, hasStoredPassword: boolean): SmtpCheck {
  const errors: Record<string, string> = {};
  const host = (form.host ?? "").trim().toLowerCase();
  const security = form.security === "starttls" ? "starttls" : form.security === "ssl" ? "ssl" : null;
  const portText = (form.port ?? "").trim();
  const port = portText === "" && security ? SMTP_DEFAULT_PORT[security] : Number(portText);
  const username = (form.username ?? "").trim() || null;
  const password = form.password ? form.password : null;
  const fromEmail = (form.fromEmail ?? "").trim();
  const fromName = (form.fromName ?? "").trim().replace(/[\r\n"<>]/g, "") || null;

  if (!HOST.test(host)) errors.host = "Enter the server's host name, e.g. smtpout.secureserver.net.";
  if (!security) errors.security = "Choose SSL/TLS or STARTTLS.";
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Enter a port from 1 to 65535.";
  if (username && username.length > 320) errors.username = "The user name is too long.";
  if (username && !password && !hasStoredPassword) errors.password = "Enter the password for this user name.";
  if (password && password.length > 1000) errors.password = "The password is too long.";
  if (!EMAIL.test(fromEmail) || fromEmail.length > 320) errors.fromEmail = "Enter the address mail is sent from.";
  if (fromName && fromName.length > 120) errors.fromName = "Use at most 120 characters.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { enabled: form.enabled === "on", host, port, security: security!, username, password, fromEmail, fromName } };
}

/** "Name <address>", or the address alone. */
export function smtpFrom(fromEmail: string, fromName: string | null): string {
  return fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
}

/**
 * Common providers, to fill in the server settings (owner request,
 * 2026-10-20). Only a starting point: every field stays editable.
 */
export type SmtpPreset = { id: string; label: string; host: string; security: SmtpSecurity; port: number; username?: string; note?: string };

export const SMTP_PRESETS: SmtpPreset[] = [
  { id: "godaddy", label: "GoDaddy (Workspace Email)", host: "smtpout.secureserver.net", security: "ssl", port: 465, note: "Use your full e-mail address as the user name." },
  { id: "gmail", label: "Gmail / Google Workspace", host: "smtp.gmail.com", security: "starttls", port: 587, note: "Use an app password, not your Google password." },
  { id: "microsoft365", label: "Microsoft 365 / Exchange Online", host: "smtp.office365.com", security: "starttls", port: 587, note: "SMTP AUTH must be turned on for the mailbox." },
  { id: "outlook", label: "Outlook.com", host: "smtp-mail.outlook.com", security: "starttls", port: 587 },
  { id: "resend", label: "Resend", host: "smtp.resend.com", security: "ssl", port: 465, username: "resend", note: "The password is a Resend API key." },
  { id: "sendgrid", label: "SendGrid", host: "smtp.sendgrid.net", security: "starttls", port: 587, username: "apikey", note: "The password is a SendGrid API key." },
  { id: "mailgun", label: "Mailgun", host: "smtp.mailgun.org", security: "starttls", port: 587 },
  { id: "zoho", label: "Zoho Mail", host: "smtp.zoho.com", security: "ssl", port: 465 },
];

/** The preset a saved server matches, by host; none for a custom server. */
export function presetForHost(host: string | null | undefined): SmtpPreset | null {
  return SMTP_PRESETS.find((p) => p.host === host?.trim().toLowerCase()) ?? null;
}
