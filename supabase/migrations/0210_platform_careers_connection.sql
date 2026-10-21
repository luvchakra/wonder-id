-- Platform Agent — WonderID's careers connection (owner request,
-- 2026-10-21). The careers page (/careers and the landing page's Careers
-- section) is run by WonderJobs and needs that career site's key. A
-- platform administrator now sets it in the vendor console
-- (/platform-admin/careers) instead of a Vercel environment variable, so a
-- new or rotated key takes effect without a deployment.
--
-- One row (id = true). The key is encrypted by the application (AES-256-GCM,
-- lib/security/encryptSecret.ts); only its last four characters are kept in
-- clear to tell keys apart. It is WonderID's own vendor setting, not an
-- organization's data, so it has no tenant_id. No client policy: only the
-- service role reads or writes it, from modules/careers/connection.ts (same
-- pattern as platform_ai_provider_configs, 0057).
--
-- Additive: one new table.

create table platform_careers_connection (
  id boolean primary key default true check (id),
  encrypted_key text not null,
  key_hint text not null check (char_length(key_hint) between 1 and 8),
  base_url text check (base_url is null or char_length(base_url) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table platform_careers_connection enable row level security;
revoke all on platform_careers_connection from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['platform_careers_connection'] loop
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;
