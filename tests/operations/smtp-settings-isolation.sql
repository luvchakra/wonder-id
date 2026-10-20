-- Tenant isolation for tenant_smtp_settings (migration 0208, owner test
-- feedback item 14). The table has RLS on and no client policy: only the
-- service role reads or writes it, filtered by tenant in
-- modules/operations/smtpSettings.ts. So no customer session sees any row,
-- not even its own organization's, let alone another's. Run against the
-- dev project in one call; it rolls back. Expected: 0. (Ran 2026-10-20: 0.)

begin;
insert into tenant_smtp_settings (tenant_id, host, port, security, from_email)
select id, 'smtp.example.com', 465, 'ssl', 'a@b.example' from tenants limit 1;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select user_id from tenant_memberships m join tenant_smtp_settings s using (tenant_id) limit 1), 'role', 'authenticated')::text,
  true
);
select count(*) as visible_to_member from tenant_smtp_settings; -- expect 0
rollback;
