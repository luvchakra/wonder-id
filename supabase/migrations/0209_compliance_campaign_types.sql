-- Compliance Agent — COMPLIANCE-P0-15: certification campaign types.
-- Six ready-made designs over the existing campaign scopes: user manager,
-- entitlement owner, application owner, role-based, event-based and
-- micro-certification (modules/certification-compliance/campaignTypes.ts).
--
-- 1. A template keeps the type it was designed from and, for an
--    event-based one, the lifecycle events that start it.
-- 2. A people's-access campaign may be reviewed by the entitlement's owner.
-- 3. A new scope, 'role_membership': one item per person assigned to a
--    business role (an access package), reviewed by its owner. The item
--    keeps the assignment (package_assignment_id); a revoke ends it through
--    Access. A people's-access campaign may hold these items too.
-- 4. A campaign records the template it came from and, when an event
--    started it, the lifecycle event: at most one campaign per template and
--    event, so a replayed event starts nothing new.
--
-- Additive: no table is created; check constraints are widened; new
-- columns are nullable or defaulted. RLS on every table is unchanged.

alter table certification_campaign_templates
  add column campaign_type text not null default 'custom'
    check (campaign_type in ('user_manager', 'entitlement_owner', 'application_owner', 'role_based', 'event_based', 'micro', 'custom')),
  add column trigger_events text[] not null default '{}'
    check (trigger_events <@ array['mover', 'manager_change', 'conversion', 'rehire']::text[]),
  add constraint certification_campaign_templates_event_check check ((campaign_type = 'event_based') = (cardinality(trigger_events) > 0));
-- The lifecycle hook looks up a tenant's live event-based templates on every event.
create index certification_campaign_templates_event_idx on certification_campaign_templates (tenant_id)
  where campaign_type = 'event_based' and archived_at is null;

alter table certification_campaign_templates drop constraint certification_campaign_templates_reviewer_kind_check;
alter table certification_campaign_templates add constraint certification_campaign_templates_reviewer_kind_check
  check (reviewer_kind in ('named', 'manager', 'application_owner', 'entitlement_owner'));
alter table certification_campaigns drop constraint certification_campaigns_reviewer_kind_check;
alter table certification_campaigns add constraint certification_campaigns_reviewer_kind_check
  check (reviewer_kind in ('named', 'manager', 'application_owner', 'entitlement_owner'));

alter table certification_campaigns drop constraint certification_campaigns_scope_type_check;
alter table certification_campaigns add constraint certification_campaigns_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments', 'package_contents', 'application_contents', 'role_membership'));
alter table certification_campaign_templates drop constraint certification_campaign_templates_scope_type_check;
alter table certification_campaign_templates add constraint certification_campaign_templates_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments', 'package_contents', 'application_contents', 'role_membership'));

-- An item about a person's business-role assignment. It stays evidence after
-- the assignment ends (an ended assignment is kept, so the key holds).
alter table certification_items
  add column package_assignment_id uuid,
  add constraint certification_items_package_assignment_same_tenant foreign key (package_assignment_id, tenant_id)
    references access_package_assignments (id, tenant_id) on delete set null (package_assignment_id);
create index certification_items_package_assignment_id_idx on certification_items (package_assignment_id) where package_assignment_id is not null;
-- Covers the composite foreign key (performance advisor).
create index certification_items_package_assignment_fk_idx on certification_items (package_assignment_id, tenant_id);

alter table certification_campaigns
  add column template_id uuid references certification_campaign_templates (id) on delete set null,
  add column trigger_event_id uuid;
create index certification_campaigns_template_id_idx on certification_campaigns (template_id) where template_id is not null;
create unique index certification_campaigns_template_event_key on certification_campaigns (tenant_id, template_id, trigger_event_id)
  where trigger_event_id is not null;
