-- Operations Agent — the organization's own outgoing mail server (owner
-- test feedback item 14, 2026-10-20): Administration › Organization
-- Settings › Email (SMTP). When it is set and turned on, the
-- organization's e-mails (notifications, invitations) go out through it;
-- otherwise WonderID's own provider sends them, as before.
--
-- One row per organization. The password is encrypted by the application
-- (AES-256-GCM, lib/security/encryptSecret.ts) and is never returned to a
-- browser. No client policy: only the service role reads or writes it,
-- filtered by tenant in modules/operations/smtpSettings.ts (same pattern as
-- integration_credentials, 0021, and platform_ai_provider_configs, 0057).
--
-- Additive: one new table.

create table tenant_smtp_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  enabled boolean not null default true,
  host text not null check (char_length(host) between 1 and 253),
  port integer not null check (port between 1 and 65535),
  security text not null check (security in ('ssl', 'starttls')),
  username text check (username is null or char_length(username) between 1 and 320),
  encrypted_password text,
  from_email text not null check (char_length(from_email) between 3 and 320),
  from_name text check (from_name is null or char_length(from_name) <= 120),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text check (last_test_error is null or char_length(last_test_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table tenant_smtp_settings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['tenant_smtp_settings'] loop
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;
