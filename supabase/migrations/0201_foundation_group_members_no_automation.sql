-- Foundation Agent — WID-H06 (register 2026-10-17: group membership is a
-- second path to an automation credential's roles). A credential's power is
-- its backing member's roles, changed only on its own page (escalation
-- check, four-eyes). An automation member never joins a group. The service
-- refuses this first (409 AUTOMATION_MEMBER, lib/users/groups.ts) and
-- getTenantContext() ignores group roles on an automation call; this trigger
-- makes it hold for every writer, the service role included.
--
-- Additive: one guard trigger. No automation member was in a group when
-- this was applied (checked 2026-10-18).

create or replace function group_members_refuse_automation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from tenant_memberships m
     where m.tenant_id = new.tenant_id and m.user_id = new.user_id and m.account_type = 'automation'
  ) then
    raise exception 'an automation credential cannot join a group' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function group_members_refuse_automation() from public;
revoke execute on function group_members_refuse_automation() from anon, authenticated;

create trigger group_members_refuse_automation
  before insert or update of user_id, tenant_id on group_members
  for each row execute function group_members_refuse_automation();
