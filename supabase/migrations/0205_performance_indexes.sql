-- QA Agent — performance review (2026-10-19, owner request "make the
-- application fast and snappier"). Indexes only, plus one data repair; no
-- table, column, policy or function changes.
--
-- 1. The audit log filtered by action (Audit Log's action filter, the
--    access ledger's evidence of administrators' grants): averaged 1.1 s
--    (pg_stat_statements) with only (tenant_id, created_at) and
--    (tenant_id, object_id, created_at) to choose from.
-- 2. The two open-findings counts behind the sidebar's risk badge run on
--    every page of the product: partial indexes matching each.
-- 3. The eleven foreign keys the performance advisor lists without a
--    covering index (each tenant-scoped pair, in the constraint's order).
-- 4. Repair: approval steps left open on requests that are no longer
--    waiting (cancelled before this fix) are skipped, so the timeout sweep
--    stops reading them. cancelAccessRequest now skips them itself.

create index if not exists audit_logs_tenant_action_created_idx on audit_logs (tenant_id, action, created_at desc);

create index if not exists risk_findings_open_agent_idx on risk_findings (tenant_id) where status = 'open' and agent_id is not null;
create index if not exists risk_findings_open_rogue_access_idx on risk_findings (tenant_id) where status = 'open' and category = 'rogue_access';

create index if not exists access_approval_links_request_tenant_idx on access_approval_links (request_id, tenant_id);
create index if not exists access_fulfilment_tasks_group_tenant_idx on access_fulfilment_tasks (assignee_group_id, tenant_id) where assignee_group_id is not null;
create index if not exists access_grants_account_tenant_idx on access_grants (account_id, tenant_id);
create index if not exists accounts_application_tenant_idx on accounts (application_id, tenant_id);
create index if not exists application_entitlement_types_application_tenant_idx on application_entitlement_types (application_id, tenant_id);
create index if not exists application_fulfilment_assignments_application_tenant_idx on application_fulfilment_assignments (application_id, tenant_id);
create index if not exists entitlement_classification_rule_versions_rule_tenant_idx on entitlement_classification_rule_versions (rule_id, tenant_id);
create index if not exists entitlements_application_tenant_idx on entitlements (application_id, tenant_id);
create index if not exists identity_source_conflicts_identity_tenant_idx on identity_source_conflicts (identity_id, tenant_id);
create index if not exists integration_sync_jobs_integration_tenant_idx on integration_sync_jobs (integration_id, tenant_id);
create index if not exists lifecycle_rule_versions_rule_tenant_idx on lifecycle_rule_versions (rule_id, tenant_id);

update access_request_approvals a
   set status = 'skipped'
  from access_requests r
 where r.id = a.request_id
   and r.tenant_id = a.tenant_id
   and a.status in ('pending', 'waiting')
   and r.status <> 'pending';
