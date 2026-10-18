-- Access Agent — approval workflows: live verification of migration 0204
-- (approval_workflows, access_request_policies.approval_workflow_id,
-- the group and stage-rule columns of access_request_approvals). Run via
-- the Supabase MCP execute_sql tool as one statement; it ends by raising an
-- exception that carries the results, so every fixture row rolls back.
--
-- Proves:
-- - a workflow gets its number in its organization; an empty or too long
--   list of levels is refused; a second workflow with the same name
--   (ignoring case and spaces) is refused;
-- - a policy can name its own organization's workflow, never another's
--   (foreign key);
-- - a member reads their organization's workflows; another organization's
--   member reads none; no member can write one directly.
--
-- Run 2026-10-18 against the dev project, 11 of 11 as expected: first
-- number 1; no levels and seven levels 23514 each; same name 23505; same
-- name in another organization ok; own workflow ok; another organization's
-- workflow 23503; A member sees 1, cannot insert (42501) and updates 0 rows;
-- B member sees 0. The new approval-step constraints (group steps name no
-- person; the widened kinds; the open-step key with the group) were read
-- back from the catalog the same day.

do $$
declare
  a constant uuid := 'aaaaaaaa-2040-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-2040-0000-0000-000000000002';
  x constant uuid := '11111111-2040-0000-0000-000000000001';
  z constant uuid := '33333333-2040-0000-0000-000000000003';
  wa constant uuid := 'a2040000-0000-0000-0000-0000000000a1';
  wb constant uuid := 'b2040000-0000-0000-0000-0000000000b1';
  lv constant jsonb := '[{"name":"Manager","rule":"all","minRisk":null,"approvers":[{"kind":"manager"}]}]';
  results text := '';
  c integer;
  r bigint;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A204', 'fixture-tenant-a204-test'), (b, 'Fixture Tenant B204', 'fixture-tenant-b204-test');
  insert into auth.users (id, email) values (x, 'fixture-x204@example.test'), (z, 'fixture-z204@example.test');
  insert into users (id, email) values (x, 'fixture-x204@example.test'), (z, 'fixture-z204@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into approval_workflows (id, tenant_id, name, levels) values (wa, a, 'Manager then security', lv), (wb, b, 'Other org workflow', lv);
  select ref into r from approval_workflows where id = wa;
  results := results || E'\nfirst workflow number in A (expect 1): ' || coalesce(r::text, 'null');

  begin
    insert into approval_workflows (tenant_id, name, levels) values (a, 'No levels', '[]');
    results := results || E'\nno levels (expect 23514): ALLOWED';
  exception when others then results := results || E'\nno levels (expect 23514): ' || sqlstate; end;
  begin
    insert into approval_workflows (tenant_id, name, levels) values (a, 'Seven levels', lv || lv || lv || lv || lv || lv || lv);
    results := results || E'\nseven levels (expect 23514): ALLOWED';
  exception when others then results := results || E'\nseven levels (expect 23514): ' || sqlstate; end;
  begin
    insert into approval_workflows (tenant_id, name, levels) values (a, '  manager THEN security ', lv);
    results := results || E'\nsame name (expect 23505): ALLOWED';
  exception when others then results := results || E'\nsame name (expect 23505): ' || sqlstate; end;
  insert into approval_workflows (tenant_id, name, levels) values (b, 'Manager then security', lv);
  results := results || E'\nsame name in another organization (expect ok): ok';

  insert into access_request_policies (tenant_id, name, approval_workflow_id) values (a, 'Uses own workflow', wa);
  results := results || E'\npolicy names its own workflow (expect ok): ok';
  begin
    update access_request_policies set approval_workflow_id = wb where tenant_id = a;
    results := results || E'\npolicy names another organization''s workflow (expect 23503): ALLOWED';
  exception when others then results := results || E'\npolicy names another organization''s workflow (expect 23503): ' || sqlstate; end;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from approval_workflows where tenant_id in (a, b);
  results := results || E'\nA member sees (expect 1): ' || c;
  begin
    insert into approval_workflows (tenant_id, name, levels) values (a, 'Written directly', lv);
    results := results || E'\nA member writes directly (expect 42501): ALLOWED';
  exception when others then results := results || E'\nA member writes directly (expect 42501): ' || sqlstate; end;
  update approval_workflows set name = 'Renamed directly' where id = wa;
  get diagnostics c = row_count;
  results := results || E'\nA member updates directly (expect 0 rows): ' || c;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from approval_workflows where tenant_id = a;
  results := results || E'\nB member sees A''s (expect 0): ' || c;
  reset role;

  raise exception 'RESULTS:%', results;
end
$$;
