-- QA Agent — performance review, round 4 (2026-10-19). Production timing
-- logs (lib/db/requestTimings.ts) showed every page waiting on several
-- separate Supabase calls for things one query can answer:
--
-- 1. my_access_context(): the signed-in person's memberships, direct roles,
--    group roles and active authorization policies in one call, instead of
--    four on every page and API call. SECURITY INVOKER: every row is read
--    under the caller's own RLS, exactly as the four PostgREST reads were;
--    the memberships come from my_memberships() (migrations 0152, 0206),
--    which already decides which organizations the caller holds.
-- 2. identity_type_counts(), application_catalog_counts() and
--    account_summary_counts(): the dashboard's and list pages' counts in one
--    grouped query each, instead of 8, 5 and 7 head counts. SECURITY
--    INVOKER, so RLS applies; the tenant filter is explicit as well (§14).
--
-- Additive: new functions only. Execute is granted to signed-in users only.

create or replace function public.my_access_context()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.my_memberships() m), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant_id', ur.tenant_id,
        'scope_type', ur.scope_type,
        'scope_values', ur.scope_values,
        'starts_at', ur.starts_at,
        'expires_at', ur.expires_at,
        'requires_mfa', ur.requires_mfa,
        'roles', (
          select jsonb_build_object(
            'id', r.id, 'name', r.name, 'display_name', r.display_name, 'status', r.status,
            'role_permissions', coalesce((
              select jsonb_agg(jsonb_build_object('permissions', jsonb_build_object('key', p.key)))
              from role_permissions rp join permissions p on p.id = rp.permission_id
              where rp.role_id = r.id
            ), '[]'::jsonb)
          )
          from roles r where r.id = ur.role_id
        )
      ))
      from user_roles ur
      where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'group_roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant_id', gm.tenant_id,
        'groups', (
          select jsonb_build_object(
            'name', g.name, 'status', g.status,
            'group_roles', coalesce((
              select jsonb_agg(jsonb_build_object(
                'scope_type', gr.scope_type,
                'scope_values', gr.scope_values,
                'starts_at', gr.starts_at,
                'expires_at', gr.expires_at,
                'requires_mfa', gr.requires_mfa,
                'roles', (
                  select jsonb_build_object(
                    'id', r.id, 'name', r.name, 'display_name', r.display_name, 'status', r.status,
                    'role_permissions', coalesce((
                      select jsonb_agg(jsonb_build_object('permissions', jsonb_build_object('key', p.key)))
                      from role_permissions rp join permissions p on p.id = rp.permission_id
                      where rp.role_id = r.id
                    ), '[]'::jsonb)
                  )
                  from roles r where r.id = gr.role_id
                )
              ))
              from group_roles gr where gr.group_id = g.id
            ), '[]'::jsonb)
          )
          from groups g where g.id = gm.group_id
        )
      ))
      from group_members gm
      where gm.user_id = auth.uid()
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ap.id, 'tenant_id', ap.tenant_id, 'name', ap.name, 'effect', ap.effect,
        'permissions', ap.permissions, 'scope_type', ap.scope_type,
        'scope_values', ap.scope_values, 'exempt_role_ids', ap.exempt_role_ids
      ))
      from authorization_policies ap
      where ap.status = 'active'
    ), '[]'::jsonb)
  );
$function$;

create or replace function public.identity_type_counts(p_tenant uuid)
returns table(identity_type text, n bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select i.identity_type, count(*)
  from identities i
  where i.tenant_id = p_tenant
  group by i.identity_type;
$function$;

create or replace function public.application_catalog_counts(p_tenant uuid, p_in_progress text[])
returns table(total bigint, active bigint, onboarding bigint, missing_owner bigint, high_risk bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    count(*),
    count(*) filter (where a.onboarding_status = 'ACTIVE'),
    count(*) filter (where a.onboarding_status = any (p_in_progress)),
    count(*) filter (where a.onboarding_status <> 'RETIRED' and (a.business_owner_identity_id is null or a.technical_owner_identity_id is null)),
    count(*) filter (where a.risk_level in ('high', 'critical'))
  from applications a
  where a.tenant_id = p_tenant;
$function$;

create or replace function public.account_summary_counts(p_tenant uuid, p_application uuid, p_cutoff timestamptz)
returns table(total bigint, correlated bigint, orphan bigint, ambiguous bigint, dormant bigint, privileged bigint, missing bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    count(*),
    count(*) filter (where a.correlation in ('correlated', 'manual')),
    count(*) filter (where a.correlation = 'orphan'),
    count(*) filter (where a.correlation = 'ambiguous'),
    count(*) filter (where a.status = 'active' and (a.last_used_at < p_cutoff or (a.last_used_at is null and a.created_at < p_cutoff))),
    count(*) filter (where a.account_type in ('privileged', 'shared')),
    count(*) filter (where a.missing_from_source_at is not null)
  from accounts a
  where a.tenant_id = p_tenant
    and (p_application is null or a.application_id = p_application);
$function$;

revoke execute on function public.my_access_context() from public, anon;
revoke execute on function public.identity_type_counts(uuid) from public, anon;
revoke execute on function public.application_catalog_counts(uuid, text[]) from public, anon;
revoke execute on function public.account_summary_counts(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.my_access_context() to authenticated, service_role;
grant execute on function public.identity_type_counts(uuid) to authenticated, service_role;
grant execute on function public.application_catalog_counts(uuid, text[]) to authenticated, service_role;
grant execute on function public.account_summary_counts(uuid, uuid, timestamptz) to authenticated, service_role;
