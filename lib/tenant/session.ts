import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/db/supabaseServer";

export type SessionUser = {
  id: string;
  email: string | null;
  /** The session's authenticator assurance level (aal2 after MFA), from the verified token (FOUNDATION-P0-19). */
  aal: "aal1" | "aal2" | null;
};

/**
 * The authenticated user for the current request, resolved once and shared
 * by everything rendered in it.
 *
 * Two checks, run in parallel, both required:
 * - `getClaims()` verifies the access token's ES256 signature locally
 *   against the project's JWKS (cached by auth-js) and gives the claims we
 *   use, including the assurance level;
 * - `getUser()` asks the auth server whether the session still exists.
 *   Logout is global and immediate by product decision (user, 2026-09-17):
 *   a revoked session's token keeps a valid signature until it expires, and
 *   only the auth server knows it was revoked.
 *
 * Performance review (2026-10-19): the auth-server question used to be the
 * proxy's, but the proxy runs at the edge near the visitor and the round
 * trip cost about 450 ms there. Here it runs in sin1 beside Supabase, in
 * parallel with the local check, so it adds a few milliseconds. The proxy
 * now only verifies the signature and refreshes expired tokens.
 *
 * `cache()` scopes the result to the request: the layout, the page, and
 * every service they call see the same value with one check.
 * getTenantContext() runs it alongside its own reads (2026-10-19).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const claimed = await getSessionClaims();
  if (!claimed) return null;
  // An automation credential's token was issued by the resolver this request: nothing to revoke.
  if (claimed.automation) return claimed.user;
  const supabase = await supabaseServer();
  const live = await supabase.auth.getUser();
  // A revoked or unknown session: no user, whatever the token's signature says.
  if (live.error || live.data.user?.id !== claimed.user.id) return null;
  return claimed.user;
});

/**
 * The token's verified claims only, without asking the auth server whether
 * the session still exists. Local and fast; for starting reads that only
 * need the user id while getSessionUser()'s check runs alongside. Nothing
 * may be returned or shown from those reads until getSessionUser() agrees
 * (getTenantContext() waits for both). Everything else uses getSessionUser().
 */
export const getSessionClaims = cache(async (): Promise<{ user: SessionUser; automation: boolean } | null> => {
  const supabase = await supabaseServer();
  // FOUNDATION-P0-31 — an automation credential's call carries its
  // backing member's token, just issued by the resolver; the client holds
  // no session to read it from.
  const { getAutomationAccess } = await import("@/lib/security/automationCredentials");
  const automation = await getAutomationAccess();
  const { data, error } = automation ? await supabase.auth.getClaims(automation.accessToken) : await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { user: toSessionUser(data.claims), automation: Boolean(automation) };
});

function toSessionUser(claims: { sub: string; email?: unknown; aal?: unknown }): SessionUser {
  const email = typeof claims.email === "string" ? claims.email : null;
  const aal = claims.aal === "aal2" ? "aal2" : claims.aal === "aal1" ? "aal1" : null;
  return { id: claims.sub, email, aal };
}

/**
 * The signed-in user's profile row, once per request. The shell shows the
 * display name in the account block and the dashboard greets by it; they
 * used to issue the same query independently.
 */
export const getProfile = cache(async (): Promise<{ displayName: string | null } | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();
  return { displayName: data?.display_name ?? null };
});
