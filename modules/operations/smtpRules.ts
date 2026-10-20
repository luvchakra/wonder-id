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
