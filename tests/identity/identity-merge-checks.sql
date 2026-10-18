-- Identity Agent + Foundation Agent — WID-H11 (migration 0202) and WID-H06
-- (migration 0201) live verification. Run via the Supabase MCP execute_sql
-- tool as one statement; it ends by raising an exception that carries the
-- results, so every fixture row rolls back with it.
--
-- Proves, for any caller of the database function (the service role):
-- - a merge naming the actor's own record, as survivor or as merged, is
--   refused (42501);
-- - a merge of two records sharing no email or name, with no reason, is
--   refused (22023); with a reason it runs;
-- - a merge of two records with the same name and no reason runs;
-- - the unchecked function is not executable by service_role, anon or
--   authenticated;
-- - an automation member cannot be added to a group (23514); a person can.
--
-- Run 2026-10-18 against the dev project, 8 of 8 as expected: own record
-- as survivor 42501, as merged 42501; no match without reason 22023, with
-- reason ok; same name without reason ok; unchecked function
-- false/false/false; automation member into a group 23514; person ok.

do $$
declare
  t constant uuid := 'aaaaaaaa-2020-0000-0000-000000000001';
  me constant uuid := '11111111-2020-0000-0000-000000000001';
  p constant uuid := '22222222-2020-0000-0000-000000000002';
  bot constant uuid := '33333333-2020-0000-0000-000000000003';
  mine uuid;
  hr constant uuid := 'a2020000-0000-0000-0000-0000000000a2';
  ada1 constant uuid := 'a2020000-0000-0000-0000-0000000000b1';
  ada2 constant uuid := 'a2020000-0000-0000-0000-0000000000b2';
  bob constant uuid := 'a2020000-0000-0000-0000-0000000000c1';
  carol constant uuid := 'a2020000-0000-0000-0000-0000000000c2';
  g constant uuid := 'a2020000-0000-0000-0000-0000000000d1';
  results text := '';
begin
  insert into tenants (id, name, slug) values (t, 'Fixture Tenant 202', 'fixture-tenant-202-test');
  insert into auth.users (id, email) values (me, 'fixture-me202@example.test'), (p, 'fixture-p202@example.test'), (bot, 'fixture-bot202@example.test');
  insert into users (id, email) values (me, 'fixture-me202@example.test'), (p, 'fixture-p202@example.test'), (bot, 'fixture-bot202@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (t, me, 'active'), (t, p, 'active');
  insert into tenant_memberships (tenant_id, user_id, status, account_type) values (t, bot, 'active', 'automation');
  -- A membership creates the member's own identity record.
  select id into strict mine from identities where tenant_id = t and user_id = me;
  insert into identities (id, tenant_id, identity_type, display_name, email) values
    (hr, t, 'HUMAN', 'Privileged Colleague', 'colleague@example.test'),
    (ada1, t, 'HUMAN', 'Ada Lovelace', 'ada@one.example'),
    (ada2, t, 'HUMAN', 'ada  lovelace', 'ada@two.example'),
    (bob, t, 'HUMAN', 'Bob Ross', 'bob@example.test'),
    (carol, t, 'HUMAN', 'Carol Danvers', 'carol@example.test');

  begin
    perform merge_identities(t, mine, hr, '{}', me, 'mine now');
    results := results || E'\nmerge into own record (expect 42501): ALLOWED';
  exception when others then results := results || E'\nmerge into own record (expect 42501): ' || sqlstate; end;
  begin
    perform merge_identities(t, hr, mine, '{}', me, 'mine now');
    results := results || E'\nmerge own record away (expect 42501): ALLOWED';
  exception when others then results := results || E'\nmerge own record away (expect 42501): ' || sqlstate; end;
  begin
    perform merge_identities(t, bob, carol, '{}', p, null);
    results := results || E'\nno match, no reason (expect 22023): ALLOWED';
  exception when others then results := results || E'\nno match, no reason (expect 22023): ' || sqlstate; end;
  begin
    perform merge_identities(t, bob, carol, '{}', p, 'HR confirmed the name change');
    results := results || E'\nno match, with reason (expect ok): ok';
  exception when others then results := results || E'\nno match, with reason (expect ok): ' || sqlstate; end;
  begin
    perform merge_identities(t, ada1, ada2, '{}', p, null);
    results := results || E'\nsame name, no reason (expect ok): ok';
  exception when others then results := results || E'\nsame name, no reason (expect ok): ' || sqlstate; end;

  results := results || E'\nunchecked executable by service_role/anon/authenticated (expect f/f/f): '
    || has_function_privilege('service_role', 'merge_identities_unchecked(uuid, uuid, uuid, text[], uuid, text)', 'execute')::text || '/'
    || has_function_privilege('anon', 'merge_identities_unchecked(uuid, uuid, uuid, text[], uuid, text)', 'execute')::text || '/'
    || has_function_privilege('authenticated', 'merge_identities_unchecked(uuid, uuid, uuid, text[], uuid, text)', 'execute')::text;

  insert into groups (id, tenant_id, name) values (g, t, 'Fixture Group 202');
  begin
    insert into group_members (group_id, tenant_id, user_id, added_by) values (g, t, bot, me);
    results := results || E'\nautomation member joins group (expect 23514): ALLOWED';
  exception when others then results := results || E'\nautomation member joins group (expect 23514): ' || sqlstate; end;
  begin
    insert into group_members (group_id, tenant_id, user_id, added_by) values (g, t, p, me);
    results := results || E'\nperson joins group (expect ok): ok';
  exception when others then results := results || E'\nperson joins group (expect ok): ' || sqlstate; end;

  raise exception 'RESULTS:%', results;
end
$$;
