-- Foundation Agent — a member's organizations in a fixed order (found by the
-- 2026-10-19 nightly investigation). my_memberships() had no ORDER BY, and
-- away from an organization's own address the tenant context falls back to
-- the first membership when no organization was chosen (wa_tenant cookie).
-- A person in two organizations could therefore land in either one from one
-- request to the next. Now: the oldest membership first, then by tenant id.
-- Same columns, rows and security as before (migration 0152); only the order.

create or replace function public.my_memberships()
returns table(tenant_id uuid, name text, slug text, account_type text, mfa_required boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.tenant_id, t.name, t.slug, tm.account_type,
         coalesce(s.settings -> 'config' ->> 'security.mfaRequired', '0') = '1'
  from tenant_memberships tm
  join tenants t on t.id = tm.tenant_id
  left join tenant_settings s on s.tenant_id = tm.tenant_id
  where tm.user_id = auth.uid()
    and tm.status = 'active'
    and t.status = 'active'
  order by tm.created_at, tm.tenant_id;
$function$;
