/**
 * Owner request (13 October 2026): who may open the vendor console can also
 * be set in the hosting environment, `PLATFORM_ADMIN_EMAILS`: a
 * comma-separated list of email addresses, in addition to the
 * `platform_admins` table. Pure, so the matching is tested on its own.
 *
 * A listed address counts only for an account whose email Supabase Auth has
 * confirmed (checked by the caller); a typed or unconfirmed address never
 * opens the console. Removing an address from the variable (and
 * redeploying) removes the access.
 */
export function parsePlatformAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
  );
}

/**
 * WID-H10: sign-in methods that prove the person controls the mailbox.
 * Email (a confirmation link or a one-time code to the mailbox) and the
 * providers that verify the email they return. Enterprise SSO (`sso:*`),
 * whose email is asserted by a customer's own IdP, and Microsoft (`azure`),
 * whose email claim is not verified, are not on it.
 */
export const PROVEN_EMAIL_PROVIDERS: ReadonlySet<string> = new Set(["email", "google", "linkedin_oidc"]);

/**
 * WID-H10: an `email` identity proves the mailbox only when Supabase Auth
 * mailed a confirmation and the address was confirmed after it. An account
 * confirmed without a mail (sign-ups auto-confirmed by the project's
 * "Confirm email" setting being off, or an account created already
 * confirmed) has no `confirmation_sent_at`, so it does not count, whatever
 * that setting is.
 */
function mailedConfirmation(account: { emailConfirmedAt: string | null | undefined; confirmationSentAt?: string | null }): boolean {
  if (!account.confirmationSentAt || !account.emailConfirmedAt) return false;
  return Date.parse(account.emailConfirmedAt) >= Date.parse(account.confirmationSentAt);
}

/**
 * Whether a confirmed account's email is on the list, signed in by a
 * method that proves the mailbox: never an SSO account, and at least one
 * identity from PROVEN_EMAIL_PROVIDERS (`email` only after a mailed
 * confirmation).
 */
export function isListedPlatformAdmin(
  list: ReadonlySet<string>,
  account: { email: string | null | undefined; emailConfirmedAt: string | null | undefined; confirmationSentAt?: string | null; isSsoUser?: boolean | null; providers: readonly string[] },
): boolean {
  if (!account.email || !account.emailConfirmedAt) return false;
  if (account.isSsoUser || account.providers.some((p) => p.startsWith("sso"))) return false;
  const proven = account.providers.some((p) => PROVEN_EMAIL_PROVIDERS.has(p) && (p !== "email" || mailedConfirmation(account)));
  if (!proven) return false;
  return list.has(account.email.trim().toLowerCase());
}
