-- Access Agent — approval workflows (owner request 2026-10-18): reusable,
-- named approval patterns with several levels, used by the request policies
-- of many applications.
--
-- 1. approval_workflows: a pattern. `levels` is an ordered list; each level
--    names its approvers (the subject's manager, the manager's manager, the
--    resource owner, the application owner, a named person, a group, access
--    managers), whether all of them or any one must approve, and optionally
--    the lowest risk at which the level applies. The service validates the
--    shape (approvalWorkflowRules.ts). Members read; only the service writes.
-- 2. access_request_policies.approval_workflow_id: a policy that names a
--    workflow is approved by it instead of its built-in route.
-- 3. access_request_approvals: a step can be open to a group's members
--    (approver_group_id), and a stage is decided by all its steps or by any
--    one (stage_rule). New approver kinds for the new approvers.
--
-- Additive: new table and nullable columns; the kind check widens; the
-- named-approver check and the open-step key gain the group.

create table approval_workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ref bigint,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  levels jsonb not null check (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) between 1 and 6),
  status text not null default 'active' check (status in ('active', 'retired')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (id, tenant_id)
);
create unique index approval_workflows_name_key on approval_workflows (tenant_id, lower(btrim(name)));
create unique index approval_workflows_ref_key on approval_workflows (tenant_id, ref);
create index approval_workflows_tenant_idx on approval_workflows (tenant_id, status);

alter table approval_workflows enable row level security;
create policy approval_workflows_select on approval_workflows for select using (tenant_id in (select current_tenant_ids()));

create trigger assign_object_ref before insert on approval_workflows for each row execute function assign_object_ref();
create trigger keep_object_ref before update of ref on approval_workflows for each row execute function keep_object_ref();

do $$
declare
  t text;
begin
  foreach t in array array['approval_workflows'] loop
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;

alter table access_request_policies add column approval_workflow_id uuid;
alter table access_request_policies
  add constraint access_request_policies_workflow_fkey foreign key (approval_workflow_id, tenant_id) references approval_workflows (id, tenant_id);
create index access_request_policies_workflow_idx on access_request_policies (approval_workflow_id, tenant_id) where approval_workflow_id is not null;

alter table access_request_approvals add column approver_group_id uuid;
alter table access_request_approvals add column stage_rule text not null default 'all' check (stage_rule in ('all', 'any'));
alter table access_request_approvals
  add constraint access_request_approvals_group_fkey foreign key (approver_group_id, tenant_id) references groups (id, tenant_id) on delete set null (approver_group_id);
create index access_request_approvals_group_idx on access_request_approvals (approver_group_id, tenant_id) where approver_group_id is not null;

alter table access_request_approvals drop constraint access_request_approvals_approver_kind_check;
alter table access_request_approvals add constraint access_request_approvals_approver_kind_check
  check (approver_kind in ('manager', 'managers_manager', 'entitlement_owner', 'application_owner', 'package_owner', 'named_approver', 'group', 'access_managers'));
-- A named step names a person; a group or access-manager step names nobody.
alter table access_request_approvals drop constraint access_request_approvals_check;
alter table access_request_approvals add constraint access_request_approvals_check
  check ((approver_kind in ('access_managers', 'group')) = (approver_user_id is null));
-- A group deleted while its step is open leaves the step to access managers (the service decides that).

drop index access_request_approvals_open_key;
create unique index access_request_approvals_open_key on access_request_approvals (
  request_id, stage, approver_kind,
  coalesce(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(approver_group_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status in ('waiting', 'pending');
