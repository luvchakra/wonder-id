-- Identity Agent — WID-H11 (register 2026-10-17): one administrator could
-- merge any two people's records, their own included. Owner decision
-- 2026-10-18: no second approver (the gap is accepted), but
-- - nobody merges a record that is their own identity (SELF_DECISION);
-- - two records that share no email and no name need a stated reason.
-- The service checks both first (identityMergeService.ts); this makes them
-- hold for any caller of the function.
--
-- How: the 0198 function is renamed `merge_identities_unchecked` and no
-- longer executable by any API role; `merge_identities` (same signature, so
-- callers do not change) checks, then calls it. It is SECURITY DEFINER only
-- so that it can call the unchecked function; it is still executable by
-- the service role alone and takes the tenant explicitly.

alter function merge_identities(uuid, uuid, uuid, text[], uuid, text) rename to merge_identities_unchecked;
revoke execute on function merge_identities_unchecked(uuid, uuid, uuid, text[], uuid, text) from public, anon, authenticated, service_role;

create or replace function identity_merge_norm(v text) returns text
language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(v, '')), '\s+', ' ', 'g'))
$$;
revoke execute on function identity_merge_norm(text) from public, anon, authenticated;

create or replace function merge_identities(p_tenant uuid, p_survivor uuid, p_merged uuid, p_fields text[], p_actor uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s identities;
  m identities;
begin
  select * into s from identities where id = p_survivor and tenant_id = p_tenant;
  select * into m from identities where id = p_merged and tenant_id = p_tenant;
  if s.id is null or m.id is null then
    raise exception 'One of the records was not found in this organization.' using errcode = 'P0002';
  end if;
  if p_actor is null or p_actor = s.user_id or p_actor = m.user_id then
    raise exception 'You can''t merge your own record. Another administrator must do it.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null
     and not (identity_merge_norm(s.email) <> '' and identity_merge_norm(s.email) = identity_merge_norm(m.email))
     and not (identity_merge_norm(s.display_name) <> '' and identity_merge_norm(s.display_name) = identity_merge_norm(m.display_name)) then
    raise exception 'These records share no email or name. Say why they are the same person.' using errcode = '22023';
  end if;
  return merge_identities_unchecked(p_tenant, p_survivor, p_merged, p_fields, p_actor, p_reason);
end;
$$;
revoke execute on function merge_identities(uuid, uuid, uuid, text[], uuid, text) from public, anon, authenticated;
grant execute on function merge_identities(uuid, uuid, uuid, text[], uuid, text) to service_role;
