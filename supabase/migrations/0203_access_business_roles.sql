-- Access Agent — ACCESS-P0-21: business and IT roles (owner decision
-- 2026-10-18: a kind of access package, not a separate object).
--
-- 1. access_packages.kind: 'package' (default, every existing row),
--    'business_role' or 'it_role'. A role is requested, approved, assigned,
--    provisioned and reviewed exactly as a package is.
-- 2. access_package_includes: a role (or package) includes other active
--    roles or packages; what it grants is its own resources plus theirs,
--    flattened when an assignment is made (the service reads it). No cycles
--    (a package never includes itself, directly or through others), same
--    tenant only. Members read; only the service writes.
--
-- Additive: one column with a default, one new table.

alter table access_packages add column kind text not null default 'package'
  check (kind in ('package', 'business_role', 'it_role'));
create index access_packages_kind_idx on access_packages (tenant_id, kind);

create table access_package_includes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  package_id uuid not null,
  included_package_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (package_id, included_package_id),
  constraint access_package_includes_not_self check (package_id <> included_package_id),
  constraint access_package_includes_package_id_tenant_id_fkey foreign key (package_id, tenant_id) references access_packages (id, tenant_id) on delete cascade,
  constraint access_package_includes_included_package_id_tenant_id_fkey foreign key (included_package_id, tenant_id) references access_packages (id, tenant_id) on delete cascade
);
create index access_package_includes_package_idx on access_package_includes (package_id, tenant_id);
create index access_package_includes_included_idx on access_package_includes (included_package_id, tenant_id);
create index access_package_includes_tenant_idx on access_package_includes (tenant_id);

alter table access_package_includes enable row level security;
create policy access_package_includes_select on access_package_includes for select using (tenant_id in (select current_tenant_ids()));

-- No cycle: the new included package must not (transitively) include the package.
create or replace function access_package_includes_no_cycle() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (
    with recursive below(id) as (
      select new.included_package_id
      union
      select i.included_package_id from access_package_includes i join below b on i.package_id = b.id where i.tenant_id = new.tenant_id
    )
    select 1 from below where id = new.package_id
  ) then
    raise exception 'a role cannot include itself, directly or through another role' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function access_package_includes_no_cycle() from public;
revoke execute on function access_package_includes_no_cycle() from anon, authenticated;

create trigger access_package_includes_no_cycle
  before insert or update of package_id, included_package_id on access_package_includes
  for each row execute function access_package_includes_no_cycle();

-- CLAUDE.md §19.10: record provenance, as migration 0115.
do $$
declare
  t text;
begin
  foreach t in array array['access_package_includes'] loop
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;
