-- Access Agent — ACCESS-P0-21 live verification of migration 0203
-- (access_packages.kind, access_package_includes). Run via the Supabase MCP
-- execute_sql tool as one statement; it ends by raising an exception that
-- carries the results, so every fixture row rolls back.
--
-- Proves:
-- - a role can be stored as a business or IT role; an unknown kind is refused;
-- - a role includes another; including itself, or one that already includes
--   it (directly or two levels down), is refused;
-- - another organization's package can never be included (foreign key);
-- - a member reads their organization's includes; another organization's
--   member reads none; no member can write one directly.
--
-- Run 2026-10-18 against the dev project, 9 of 9 as expected: unknown kind
-- 23514; two-level include ok; itself, direct loop and two-level loop 23514
-- each; another organization's role 23503; A member sees 2 and cannot write
-- (42501); B member sees 0.

do $$
declare
  a constant uuid := 'aaaaaaaa-2030-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-2030-0000-0000-000000000002';
  x constant uuid := '11111111-2030-0000-0000-000000000001';
  z constant uuid := '33333333-2030-0000-0000-000000000003';
  r1 constant uuid := 'a2030000-0000-0000-0000-0000000000a1';
  r2 constant uuid := 'a2030000-0000-0000-0000-0000000000a2';
  r3 constant uuid := 'a2030000-0000-0000-0000-0000000000a3';
  ob constant uuid := 'b2030000-0000-0000-0000-0000000000b1';
  results text := '';
  c integer;
begin
  insert into tenants (id, name, slug) values (a, 'Fixture Tenant A203', 'fixture-tenant-a203-test'), (b, 'Fixture Tenant B203', 'fixture-tenant-b203-test');
  insert into auth.users (id, email) values (x, 'fixture-x203@example.test'), (z, 'fixture-z203@example.test');
  insert into users (id, email) values (x, 'fixture-x203@example.test'), (z, 'fixture-z203@example.test') on conflict (id) do nothing;
  insert into tenant_memberships (tenant_id, user_id, status) values (a, x, 'active'), (b, z, 'active');
  insert into access_packages (id, tenant_id, name, kind, status) values
    (r1, a, 'Finance analyst', 'business_role', 'active'),
    (r2, a, 'SAP reporting', 'it_role', 'active'),
    (r3, a, 'Base access', 'package', 'active'),
    (ob, b, 'Other org role', 'business_role', 'active');

  begin
    insert into access_packages (tenant_id, name, kind) values (a, 'Bad kind', 'team');
    results := results || E'\nunknown kind (expect 23514): ALLOWED';
  exception when others then results := results || E'\nunknown kind (expect 23514): ' || sqlstate; end;

  insert into access_package_includes (tenant_id, package_id, included_package_id) values (a, r1, r2), (a, r2, r3);
  results := results || E'\nrole includes role, two levels (expect ok): ok';

  begin
    insert into access_package_includes (tenant_id, package_id, included_package_id) values (a, r1, r1);
    results := results || E'\nincludes itself (expect 23514): ALLOWED';
  exception when others then results := results || E'\nincludes itself (expect 23514): ' || sqlstate; end;
  begin
    insert into access_package_includes (tenant_id, package_id, included_package_id) values (a, r2, r1);
    results := results || E'\ndirect loop (expect 23514): ALLOWED';
  exception when others then results := results || E'\ndirect loop (expect 23514): ' || sqlstate; end;
  begin
    insert into access_package_includes (tenant_id, package_id, included_package_id) values (a, r3, r1);
    results := results || E'\nloop two levels down (expect 23514): ALLOWED';
  exception when others then results := results || E'\nloop two levels down (expect 23514): ' || sqlstate; end;
  begin
    insert into access_package_includes (tenant_id, package_id, included_package_id) values (a, r1, ob);
    results := results || E'\nanother organization''s role (expect 23503): ALLOWED';
  exception when others then results := results || E'\nanother organization''s role (expect 23503): ' || sqlstate; end;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from access_package_includes where tenant_id in (a, b);
  results := results || E'\nA member sees (expect 2): ' || c;
  begin
    insert into access_package_includes (tenant_id, package_id, included_package_id) values (a, r1, r3);
    results := results || E'\nA member writes directly (expect 42501): ALLOWED';
  exception when others then results := results || E'\nA member writes directly (expect 42501): ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from access_package_includes where tenant_id in (a, b);
  results := results || E'\nB member sees (expect 0): ' || c;
  reset role;

  raise exception 'RESULTS:%', results;
end
$$;
