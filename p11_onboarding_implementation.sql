-- P11 Onboarding Mapping And Sync Blueprint Implementation
-- Target project: P11 Data Lake (qkkevxnbmaamtdtgtkmb)
-- This script creates onboarding application tables, crosswalks, views,
-- RLS policies, and ingest/sync helper functions.

create schema if not exists onboarding;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'onboarding_status'
      and n.nspname = 'onboarding'
  ) then
    create type onboarding.onboarding_status as enum (
      'draft',
      'submitted',
      'in_review',
      'approved',
      'resubmitted',
      'abandoned',
      'archived'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'onboarding_stage'
      and n.nspname = 'onboarding'
  ) then
    create type onboarding.onboarding_stage as enum (
      'contract_signed',
      'intake_form',
      'account_access',
      'creative_kickoff',
      'campaign_build',
      'prelaunch_review',
      'go_live'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'submission_status'
      and n.nspname = 'onboarding'
  ) then
    create type onboarding.submission_status as enum (
      'draft',
      'submitted',
      'resubmitted'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'platform_status'
      and n.nspname = 'onboarding'
  ) then
    create type onboarding.platform_status as enum (
      'not_requested',
      'requested',
      'invited',
      'granted',
      'verified',
      'blocked'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'approval_status'
      and n.nspname = 'onboarding'
  ) then
    create type onboarding.approval_status as enum (
      'pending',
      'approved',
      'rejected',
      'needs_revision'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Utility Functions
-- -----------------------------------------------------------------------------
create or replace function onboarding.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function onboarding.is_internal_user()
returns boolean
language plpgsql
stable
as $$
declare
  v_has_access boolean := false;
begin
  if coalesce((auth.jwt() ->> 'role') = 'service_role', false) then
    return true;
  end if;

  if coalesce((auth.jwt() -> 'app_metadata' ->> 'portal_role') in ('internal', 'admin'), false) then
    return true;
  end if;

  if to_regclass('onboarding.internal_user_access') is null then
    return false;
  end if;

  execute $sql$
    select exists (
      select 1
      from onboarding.internal_user_access i
      where i.auth_user_id = auth.uid()
        and i.portal_role in ('internal', 'admin')
    )
  $sql$
  into v_has_access;

  return coalesce(v_has_access, false);
end;
$$;

create or replace function onboarding.is_admin_user()
returns boolean
language plpgsql
stable
as $$
declare
  v_has_access boolean := false;
begin
  if coalesce((auth.jwt() ->> 'role') = 'service_role', false) then
    return true;
  end if;

  if coalesce((auth.jwt() -> 'app_metadata' ->> 'portal_role') = 'admin', false) then
    return true;
  end if;

  if to_regclass('onboarding.internal_user_access') is null then
    return false;
  end if;

  execute $sql$
    select exists (
      select 1
      from onboarding.internal_user_access i
      where i.auth_user_id = auth.uid()
        and i.portal_role = 'admin'
    )
  $sql$
  into v_has_access;

  return coalesce(v_has_access, false);
end;
$$;

-- Membership checks for RLS
create or replace function onboarding.has_client_access(p_onboarding_client_id bigint)
returns boolean
language plpgsql
stable
as $$
declare
  v_has_access boolean := false;
begin
  if to_regclass('onboarding.portal_user_company_access') is null then
    return false;
  end if;

  execute $sql$
    select exists (
      select 1
      from onboarding.portal_user_company_access p
      where p.onboarding_client_id = $1
        and p.auth_user_id = auth.uid()
        and p.is_active = true
    )
  $sql$
  into v_has_access
  using p_onboarding_client_id;

  return coalesce(v_has_access, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Crosswalks / Lookups
-- -----------------------------------------------------------------------------
create table if not exists onboarding.property_type_crosswalk (
  id bigint generated always as identity primary key,
  source_value text not null unique,
  normalized_value text not null,
  target_company_profile_value text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.service_code_lookup (
  service_code text primary key,
  display_name text not null,
  legacy_contract_profile_value text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.stage_crosswalk (
  stage_code onboarding.onboarding_stage primary key,
  portal_label text not null,
  sequence_no integer not null,
  accelo_hint text,
  basecamp_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.platform_code_lookup (
  platform_code text primary key,
  display_name text not null,
  is_required_default boolean not null default true,
  requires_secure_reference boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into onboarding.property_type_crosswalk
  (source_value, normalized_value, target_company_profile_value)
values
  ('Multi-Family', 'Multifamily', 'Multifamily'),
  ('Homebuilding / For-Sale', 'For Sale', 'For Sale'),
  ('Master-Planned Community', 'MPC', 'MPC'),
  ('Build-to-Rent (BTR)', 'Build-to-Rent', 'Build-to-Rent'),
  ('Active Adult / 55+', 'Active Living', 'Active Living'),
  ('Luxury', 'Other', 'Other'),
  ('Affordable / Workforce Housing', 'Other', 'Other'),
  ('Student / Academic Housing', 'Other', 'Other'),
  ('Mixed-Use', 'Other', 'Other'),
  ('Other', 'Other', 'Other')
on conflict (source_value) do update
set normalized_value = excluded.normalized_value,
    target_company_profile_value = excluded.target_company_profile_value,
    is_active = true,
    updated_at = now();

insert into onboarding.service_code_lookup
  (service_code, display_name, legacy_contract_profile_value)
values
  ('paid_search', 'Paid Search', 'PPC/SEM/Media'),
  ('paid_social', 'Paid Social', 'Social Management'),
  ('seo', 'SEO', 'SEO'),
  ('display', 'Display', 'PPC/SEM/Media'),
  ('email_marketing', 'Email Marketing', 'Content Marketing'),
  ('ctv', 'CTV', 'Other'),
  ('ils_management', 'ILS Management', 'Other'),
  ('reporting_analytics', 'Reporting & Analytics', 'Other')
on conflict (service_code) do update
set display_name = excluded.display_name,
    legacy_contract_profile_value = excluded.legacy_contract_profile_value,
    is_active = true,
    updated_at = now();

insert into onboarding.stage_crosswalk
  (stage_code, portal_label, sequence_no, accelo_hint, basecamp_hint)
values
  ('contract_signed', 'Contract Signed', 1, 'Contracted', 'Created'),
  ('intake_form', 'Intake Form', 2, 'Intake Pending', 'Intake Checklist'),
  ('account_access', 'Account Access', 3, 'Access Pending', 'Access Checklist'),
  ('creative_kickoff', 'Creative Kickoff', 4, 'Kickoff', 'Kickoff Tasks'),
  ('campaign_build', 'Campaign Build', 5, 'Build In Progress', 'Build Tasks'),
  ('prelaunch_review', 'Pre-Launch Review', 6, 'QA Review', 'Prelaunch QA'),
  ('go_live', 'Go Live', 7, 'Active', 'Launch Complete')
on conflict (stage_code) do update
set portal_label = excluded.portal_label,
    sequence_no = excluded.sequence_no,
    accelo_hint = excluded.accelo_hint,
    basecamp_hint = excluded.basecamp_hint,
    updated_at = now();

insert into onboarding.platform_code_lookup
  (platform_code, display_name, is_required_default, requires_secure_reference)
values
  ('google_ads', 'Google Ads Manager', true, false),
  ('ga4', 'Google Analytics 4', true, false),
  ('gtm', 'Google Tag Manager', true, false),
  ('google_search_console', 'Google Search Console', true, false),
  ('google_business_profile', 'Google Business Profile', false, false),
  ('meta_business_suite', 'Meta Business Suite / Pages', false, false),
  ('meta_ads', 'Meta Ads Manager', false, false),
  ('website_cms', 'Website CMS', true, true),
  ('crm', 'CRM Platform', true, true),
  ('ils', 'ILS Platform', false, false)
on conflict (platform_code) do update
set display_name = excluded.display_name,
    is_required_default = excluded.is_required_default,
    requires_secure_reference = excluded.requires_secure_reference,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Core Onboarding Tables
-- -----------------------------------------------------------------------------
create table if not exists onboarding.onboarding_client (
  id bigint generated always as identity primary key,
  company_id bigint,
  contract_id bigint,
  job_id bigint,
  status onboarding.onboarding_status not null default 'draft',
  current_stage onboarding.onboarding_stage not null default 'contract_signed',
  target_go_live_at date,
  display_name text not null,
  community_phone text,
  community_email text,
  hours_of_operation text,
  website_url text,
  property_type_raw text,
  property_type_normalized text,
  parent_company_raw text,
  address_raw text,
  address_street1 text,
  address_street2 text,
  address_city text,
  address_state text,
  address_postal text,
  preferred_communication_method text,
  final_notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_submission (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  source_tool text not null default 'portal_form',
  submission_status onboarding.submission_status not null default 'draft',
  raw_payload_json jsonb not null default '{}'::jsonb,
  normalized_payload_json jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_contact (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  contact_id bigint,
  role_code text not null,
  full_name text,
  email text,
  phone text,
  title text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_contact_role_check check (
    role_code in ('reporting_primary', 'billing', 'approver', 'report_recipient', 'other')
  )
);

create table if not exists onboarding.onboarding_website (
  onboarding_client_id bigint primary key references onboarding.onboarding_client(id) on delete cascade,
  manager_type text,
  cms_platform text,
  direct_edit_permission text,
  last_updated_note text,
  conversion_actions text,
  technical_notes text,
  vendor_contacts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_strategy (
  onboarding_client_id bigint primary key references onboarding.onboarding_client(id) on delete cascade,
  competitors text,
  differentiators text,
  primary_goals text,
  area_employers text,
  target_geographies text,
  relocation_targets text,
  excluded_geographies text,
  disallowed_terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_brand (
  onboarding_client_id bigint primary key references onboarding.onboarding_client(id) on delete cascade,
  voice_tone text,
  approved_messages text,
  disallowed_messaging text,
  promotions text,
  asset_milestones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_brand_asset (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  asset_type text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_path text,
  external_url text,
  review_status onboarding.approval_status not null default 'pending',
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_service (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  service_code text not null references onboarding.service_code_lookup(service_code),
  legacy_service_type text,
  is_selected boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_client_id, service_code)
);

create table if not exists onboarding.onboarding_service_config (
  id bigint generated always as identity primary key,
  onboarding_service_id bigint not null references onboarding.onboarding_service(id) on delete cascade,
  monthly_budget numeric(12,2),
  account_exists boolean,
  keyword_themes text,
  target_audience text,
  primary_goals text,
  remarketing_focus text,
  email_platform text,
  list_size integer,
  email_goals text,
  video_assets_status text,
  ils_platforms text[],
  report_frequency text,
  report_delivery_preference text,
  key_metrics text,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_service_id)
);

create table if not exists onboarding.onboarding_platform_access (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  platform_code text not null references onboarding.platform_code_lookup(platform_code),
  platform_label text not null,
  is_required boolean not null default true,
  requested_status onboarding.platform_status not null default 'not_requested',
  granted_status onboarding.platform_status not null default 'not_requested',
  verified_status onboarding.platform_status not null default 'not_requested',
  invite_email text,
  granted_at timestamptz,
  verified_at timestamptz,
  verified_by_user_id uuid,
  notes text,
  vendor_contact text,
  credential_request_status text not null default 'not_requested',
  credential_received_status text not null default 'not_received',
  vault_reference_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_client_id, platform_code)
);

create table if not exists onboarding.onboarding_link (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  system_code text not null,
  external_id text,
  external_url text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_client_id, system_code)
);

create table if not exists onboarding.onboarding_assignment (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  role_code text not null,
  staff_user_id uuid,
  staff_name text,
  staff_email text,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_approval (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  approval_type text not null,
  status onboarding.approval_status not null default 'pending',
  approved_by_contact_id bigint,
  approved_by_name text,
  approved_at timestamptz,
  approval_source text,
  notes text,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_stage_event (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  stage_code onboarding.onboarding_stage not null,
  event_type text not null,
  actor_type text not null,
  actor_user_id uuid,
  actor_name text,
  event_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists onboarding.portal_user_company_access (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null,
  company_id bigint,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  portal_role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, onboarding_client_id, portal_role),
  constraint portal_role_check check (portal_role in ('client', 'internal', 'admin'))
);

-- Stores canonical source-to-target mapping entries as data for reference.
create table if not exists onboarding.field_mapping_spec (
  id bigint generated always as identity primary key,
  intake_field text not null,
  source_section text not null,
  target_table text not null,
  target_column text not null,
  sync_rule text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.onboarding_sync_job (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  onboarding_submission_id bigint references onboarding.onboarding_submission(id) on delete set null,
  job_type text not null default 'canonical_sync',
  status text not null default 'queued',
  payload_json jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists idx_onboarding_client_company_id on onboarding.onboarding_client(company_id);
create index if not exists idx_onboarding_client_contract_id on onboarding.onboarding_client(contract_id);
create index if not exists idx_onboarding_client_job_id on onboarding.onboarding_client(job_id);
create index if not exists idx_onboarding_client_status on onboarding.onboarding_client(status);
create index if not exists idx_onboarding_client_stage on onboarding.onboarding_client(current_stage);
create index if not exists idx_onboarding_submission_client_id on onboarding.onboarding_submission(onboarding_client_id);
create index if not exists idx_onboarding_submission_status on onboarding.onboarding_submission(submission_status);
create index if not exists idx_onboarding_contact_client_id on onboarding.onboarding_contact(onboarding_client_id);
create index if not exists idx_onboarding_service_client_id on onboarding.onboarding_service(onboarding_client_id);
create index if not exists idx_onboarding_platform_access_client_id on onboarding.onboarding_platform_access(onboarding_client_id);
create index if not exists idx_onboarding_platform_access_verified on onboarding.onboarding_platform_access(verified_status);
create index if not exists idx_portal_user_company_access_user on onboarding.portal_user_company_access(auth_user_id);
create index if not exists idx_onboarding_sync_job_status on onboarding.onboarding_sync_job(status);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
drop trigger if exists trg_property_type_crosswalk_updated_at on onboarding.property_type_crosswalk;
create trigger trg_property_type_crosswalk_updated_at
before update on onboarding.property_type_crosswalk
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_service_code_lookup_updated_at on onboarding.service_code_lookup;
create trigger trg_service_code_lookup_updated_at
before update on onboarding.service_code_lookup
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_stage_crosswalk_updated_at on onboarding.stage_crosswalk;
create trigger trg_stage_crosswalk_updated_at
before update on onboarding.stage_crosswalk
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_platform_code_lookup_updated_at on onboarding.platform_code_lookup;
create trigger trg_platform_code_lookup_updated_at
before update on onboarding.platform_code_lookup
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_client_updated_at on onboarding.onboarding_client;
create trigger trg_onboarding_client_updated_at
before update on onboarding.onboarding_client
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_submission_updated_at on onboarding.onboarding_submission;
create trigger trg_onboarding_submission_updated_at
before update on onboarding.onboarding_submission
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_contact_updated_at on onboarding.onboarding_contact;
create trigger trg_onboarding_contact_updated_at
before update on onboarding.onboarding_contact
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_website_updated_at on onboarding.onboarding_website;
create trigger trg_onboarding_website_updated_at
before update on onboarding.onboarding_website
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_strategy_updated_at on onboarding.onboarding_strategy;
create trigger trg_onboarding_strategy_updated_at
before update on onboarding.onboarding_strategy
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_brand_updated_at on onboarding.onboarding_brand;
create trigger trg_onboarding_brand_updated_at
before update on onboarding.onboarding_brand
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_brand_asset_updated_at on onboarding.onboarding_brand_asset;
create trigger trg_onboarding_brand_asset_updated_at
before update on onboarding.onboarding_brand_asset
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_service_updated_at on onboarding.onboarding_service;
create trigger trg_onboarding_service_updated_at
before update on onboarding.onboarding_service
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_service_config_updated_at on onboarding.onboarding_service_config;
create trigger trg_onboarding_service_config_updated_at
before update on onboarding.onboarding_service_config
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_platform_access_updated_at on onboarding.onboarding_platform_access;
create trigger trg_onboarding_platform_access_updated_at
before update on onboarding.onboarding_platform_access
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_link_updated_at on onboarding.onboarding_link;
create trigger trg_onboarding_link_updated_at
before update on onboarding.onboarding_link
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_assignment_updated_at on onboarding.onboarding_assignment;
create trigger trg_onboarding_assignment_updated_at
before update on onboarding.onboarding_assignment
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_approval_updated_at on onboarding.onboarding_approval;
create trigger trg_onboarding_approval_updated_at
before update on onboarding.onboarding_approval
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_portal_user_company_access_updated_at on onboarding.portal_user_company_access;
create trigger trg_portal_user_company_access_updated_at
before update on onboarding.portal_user_company_access
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_field_mapping_spec_updated_at on onboarding.field_mapping_spec;
create trigger trg_field_mapping_spec_updated_at
before update on onboarding.field_mapping_spec
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_onboarding_sync_job_updated_at on onboarding.onboarding_sync_job;
create trigger trg_onboarding_sync_job_updated_at
before update on onboarding.onboarding_sync_job
for each row execute function onboarding.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Mapping Data Seed
-- -----------------------------------------------------------------------------
insert into onboarding.field_mapping_spec
  (intake_field, source_section, target_table, target_column, sync_rule, notes)
values
  ('Community Name', 'Community Information', 'public.Company', '"Name"', 'write-through', 'Mirrors to onboarding_client.display_name.'),
  ('Community Type', 'Community Information', 'public.CompanyProfileValue', 'value (field_name = Property Type)', 'write-through', 'Uses property_type_crosswalk.'),
  ('Community Address', 'Community Information', 'public.Address', 'Street1/Street2/City/State/Postal', 'write-through', 'Raw captured in onboarding_client.address_raw.'),
  ('Community Phone', 'Community Information', 'public.Company', '"Phone"', 'write-through', null),
  ('Community Email', 'Community Information', 'onboarding.onboarding_client', 'community_email', 'onboarding-only', null),
  ('Hours of Operation', 'Community Information', 'onboarding.onboarding_client', 'hours_of_operation', 'onboarding-only', null),
  ('Parent Company / Developer', 'Community Information', 'public.CompanyProfileValue', 'value (field_name = Parent Company)', 'write-through', null),
  ('Primary Reporting Contact Name', 'Community Information', 'public.Contact', '"Firstname"/"Lastname"', 'write-through', 'Linked via Affiliation.'),
  ('Reporting Contact Email', 'Community Information', 'public.Contact', 'email', 'write-through', null),
  ('Additional Report Recipients', 'Community Information', 'onboarding.onboarding_contact', 'role_code = report_recipient', 'onboarding-only', null),
  ('Property Website URL', 'Website Information', 'public.Company', '"Website"', 'write-through', null),
  ('Who manages the website?', 'Website Information', 'onboarding.onboarding_website', 'manager_type', 'onboarding-only', null),
  ('Website CMS / Platform', 'Website Information', 'onboarding.onboarding_website', 'cms_platform', 'onboarding-only', null),
  ('Can P11creative make direct edits?', 'Website Information', 'onboarding.onboarding_website', 'direct_edit_permission', 'onboarding-only', null),
  ('What site actions should be tracked as conversions?', 'Website Information', 'onboarding.onboarding_website', 'conversion_actions', 'onboarding-only', null),
  ('Technical notes, special vendors, or site restrictions?', 'Website Information', 'onboarding.onboarding_website', 'technical_notes', 'onboarding-only', null),
  ('Top competitors', 'Market and Strategy', 'onboarding.onboarding_strategy', 'competitors', 'onboarding-only', null),
  ('Primary marketing goals', 'Market and Strategy', 'onboarding.onboarding_strategy', 'primary_goals', 'onboarding-only', null),
  ('Brand voice and tone', 'Brand and Creative Direction', 'onboarding.onboarding_brand', 'voice_tone', 'onboarding-only', null),
  ('Uploaded assets', 'Brand and Creative Direction', 'onboarding.onboarding_brand_asset', 'storage_path/external_url', 'onboarding-only', null),
  ('Selected services', 'Services Contracted', 'public.ContractProfileValue', 'value (field_name = Service Type)', 'write-through', 'Uses service_code_lookup crosswalk.'),
  ('Monthly SEM Budget', 'Services Contracted', 'public.ContractProfileValue', 'value (field_name = SEM - Monthly P11 Ad Spend)', 'write-through', null),
  ('Monthly Social Ad Budget', 'Services Contracted', 'public.ContractProfileValue', 'value (field_name = Social - Monthly P11 Spend)', 'write-through', null),
  ('Platform Admin Access Status', 'Platform Admin Access', 'onboarding.onboarding_platform_access', 'requested/granted/verified statuses', 'onboarding-only', 'Per platform row model.'),
  ('Preferred communication method', 'Preferences and Final Notes', 'onboarding.onboarding_client', 'preferred_communication_method', 'onboarding-only', null),
  ('Target campaign go-live date', 'Preferences and Final Notes', 'onboarding.onboarding_client', 'target_go_live_at', 'write-through', 'Optionally syncs to Contract.DateStarted.'),
  ('CMS / CRM credentials', 'Platform Admin Access', 'onboarding.onboarding_platform_access', 'vault_reference_id only', 'secure-reference-only', 'Never store raw secrets.')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Normalization / Crosswalk Functions
-- -----------------------------------------------------------------------------
create or replace function onboarding.normalize_property_type(p_source_value text)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select c.normalized_value
      from onboarding.property_type_crosswalk c
      where lower(trim(c.source_value)) = lower(trim(p_source_value))
        and c.is_active = true
      limit 1
    ),
    'Other'
  );
$$;

create or replace function onboarding.map_property_type_to_company_profile_value(p_source_value text)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select c.target_company_profile_value
      from onboarding.property_type_crosswalk c
      where lower(trim(c.source_value)) = lower(trim(p_source_value))
        and c.is_active = true
      limit 1
    ),
    'Other'
  );
$$;

create or replace function onboarding.map_service_code_to_legacy(p_service_code text)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select s.legacy_contract_profile_value
      from onboarding.service_code_lookup s
      where s.service_code = p_service_code
        and s.is_active = true
      limit 1
    ),
    'Other'
  );
$$;

-- -----------------------------------------------------------------------------
-- Ingest / Sync Functions
-- -----------------------------------------------------------------------------
create or replace function onboarding.enqueue_sync_job(
  p_onboarding_client_id bigint,
  p_onboarding_submission_id bigint default null,
  p_job_type text default 'canonical_sync',
  p_payload_json jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = onboarding, public
as $$
declare
  v_job_id bigint;
begin
  insert into onboarding.onboarding_sync_job (
    onboarding_client_id,
    onboarding_submission_id,
    job_type,
    payload_json
  )
  values (
    p_onboarding_client_id,
    p_onboarding_submission_id,
    p_job_type,
    coalesce(p_payload_json, '{}'::jsonb)
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

create or replace function onboarding.ingest_submission(
  p_onboarding_client_id bigint,
  p_raw_payload_json jsonb,
  p_source_tool text default 'portal_form',
  p_submission_status onboarding.submission_status default 'submitted'
)
returns bigint
language plpgsql
security definer
set search_path = onboarding, public
as $$
declare
  v_submission_id bigint;
  v_company_name text;
  v_property_type_raw text;
  v_property_type_normalized text;
  v_community_phone text;
  v_community_email text;
  v_website_url text;
  v_parent_company text;
  v_go_live_date date;
  v_preferred_communication text;
  v_final_notes text;
  v_payload jsonb;
begin
  if p_onboarding_client_id is null then
    raise exception 'p_onboarding_client_id is required';
  end if;

  v_payload := coalesce(p_raw_payload_json, '{}'::jsonb);

  v_company_name := coalesce(
    v_payload ->> 'community_name',
    v_payload ->> 'Community Name',
    v_payload ->> 'communityName'
  );

  v_property_type_raw := coalesce(
    v_payload ->> 'community_type',
    v_payload ->> 'Community Type',
    v_payload ->> 'communityType'
  );

  v_community_phone := coalesce(
    v_payload ->> 'community_phone',
    v_payload ->> 'Community Phone',
    v_payload ->> 'communityPhone'
  );

  v_community_email := coalesce(
    v_payload ->> 'community_email',
    v_payload ->> 'Community Email',
    v_payload ->> 'communityEmail'
  );

  v_website_url := coalesce(
    v_payload ->> 'property_website_url',
    v_payload ->> 'Property Website URL',
    v_payload ->> 'propertyWebsiteUrl'
  );

  v_parent_company := coalesce(
    v_payload ->> 'parent_company',
    v_payload ->> 'Parent Company / Developer',
    v_payload ->> 'parentCompany'
  );

  v_preferred_communication := coalesce(
    v_payload ->> 'preferred_communication_method',
    v_payload ->> 'Preferred communication method',
    v_payload ->> 'preferredCommunicationMethod'
  );

  v_final_notes := coalesce(
    v_payload ->> 'final_notes',
    v_payload ->> 'Anything else we should know before building your campaigns?',
    v_payload ->> 'anythingElseWeShouldKnow'
  );

  begin
    v_go_live_date := coalesce(
      nullif(v_payload ->> 'target_campaign_go_live_date', '')::date,
      nullif(v_payload ->> 'Target campaign go-live date', '')::date,
      nullif(v_payload ->> 'targetCampaignGoLiveDate', '')::date
    );
  exception
    when others then
      v_go_live_date := null;
  end;

  v_property_type_normalized := onboarding.normalize_property_type(v_property_type_raw);

  update onboarding.onboarding_client c
  set display_name = coalesce(v_company_name, c.display_name),
      community_phone = coalesce(v_community_phone, c.community_phone),
      community_email = coalesce(v_community_email, c.community_email),
      website_url = coalesce(v_website_url, c.website_url),
      parent_company_raw = coalesce(v_parent_company, c.parent_company_raw),
      property_type_raw = coalesce(v_property_type_raw, c.property_type_raw),
      property_type_normalized = coalesce(v_property_type_normalized, c.property_type_normalized),
      target_go_live_at = coalesce(v_go_live_date, c.target_go_live_at),
      preferred_communication_method = coalesce(v_preferred_communication, c.preferred_communication_method),
      final_notes = coalesce(v_final_notes, c.final_notes),
      status = case
        when p_submission_status = 'submitted' then 'submitted'::onboarding.onboarding_status
        when p_submission_status = 'resubmitted' then 'resubmitted'::onboarding.onboarding_status
        else c.status
      end
  where c.id = p_onboarding_client_id;

  insert into onboarding.onboarding_submission (
    onboarding_client_id,
    source_tool,
    submission_status,
    raw_payload_json,
    normalized_payload_json,
    submitted_at,
    created_by
  )
  values (
    p_onboarding_client_id,
    coalesce(p_source_tool, 'portal_form'),
    p_submission_status,
    v_payload,
    jsonb_build_object(
      'community_name', v_company_name,
      'community_type_raw', v_property_type_raw,
      'community_type_normalized', v_property_type_normalized,
      'community_phone', v_community_phone,
      'community_email', v_community_email,
      'website_url', v_website_url,
      'parent_company', v_parent_company,
      'target_go_live_at', v_go_live_date,
      'preferred_communication_method', v_preferred_communication,
      'final_notes', v_final_notes
    ),
    case when p_submission_status in ('submitted', 'resubmitted') then now() else null end,
    auth.uid()
  )
  returning id into v_submission_id;

  perform onboarding.enqueue_sync_job(
    p_onboarding_client_id,
    v_submission_id,
    'canonical_sync',
    jsonb_build_object('trigger', 'ingest_submission')
  );

  return v_submission_id;
end;
$$;

create or replace function onboarding.sync_canonical_fields(p_onboarding_client_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = onboarding, public
as $$
declare
  v_client onboarding.onboarding_client%rowtype;
  v_service_type_value text;
  v_account_manager text;
  v_sem_budget text;
  v_social_budget text;
  v_updated_company_count integer := 0;
  v_updated_contract_count integer := 0;
  v_profile_updates integer := 0;
  v_row_count integer := 0;
  v_sync_summary jsonb;
begin
  select *
  into v_client
  from onboarding.onboarding_client
  where id = p_onboarding_client_id;

  if not found then
    raise exception 'onboarding_client % not found', p_onboarding_client_id;
  end if;

  select string_agg(distinct coalesce(s.legacy_service_type, onboarding.map_service_code_to_legacy(s.service_code)), ', ')
  into v_service_type_value
  from onboarding.onboarding_service s
  where s.onboarding_client_id = p_onboarding_client_id
    and s.is_selected = true;

  select a.staff_name
  into v_account_manager
  from onboarding.onboarding_assignment a
  where a.onboarding_client_id = p_onboarding_client_id
    and a.role_code = 'account_manager'
    and a.is_active = true
  order by a.assigned_at desc
  limit 1;

  select sc.monthly_budget::text
  into v_sem_budget
  from onboarding.onboarding_service s
  join onboarding.onboarding_service_config sc on sc.onboarding_service_id = s.id
  where s.onboarding_client_id = p_onboarding_client_id
    and s.service_code = 'paid_search'
    and s.is_selected = true
  limit 1;

  select sc.monthly_budget::text
  into v_social_budget
  from onboarding.onboarding_service s
  join onboarding.onboarding_service_config sc on sc.onboarding_service_id = s.id
  where s.onboarding_client_id = p_onboarding_client_id
    and s.service_code = 'paid_social'
    and s.is_selected = true
  limit 1;

  -- Company and community are distinct entities. A community intake submission
  -- must not overwrite canonical company-level records in the mirrored lake.

  if v_client.contract_id is not null then
    update public."Contract" c
    set "DateStarted" = coalesce(
      case when v_client.target_go_live_at is not null then extract(epoch from v_client.target_go_live_at::timestamp)::bigint else null end,
      c."DateStarted"
    )
    where c."ID" = v_client.contract_id;
    get diagnostics v_updated_contract_count = row_count;

    if v_service_type_value is not null then
      update public."ContractProfileValue" cpv
      set value = v_service_type_value,
          field_name = 'Service Type',
          link_id = v_client.contract_id::text
      where cpv.field_name = 'Service Type'
        and cpv.link_id = v_client.contract_id::text;
      get diagnostics v_row_count = row_count;
      v_profile_updates := v_profile_updates + v_row_count;
    end if;

    if v_account_manager is not null then
      update public."ContractProfileValue" cpv
      set value = v_account_manager,
          field_name = 'Account Manager',
          link_id = v_client.contract_id::text
      where cpv.field_name = 'Account Manager'
        and cpv.link_id = v_client.contract_id::text;
      get diagnostics v_row_count = row_count;
      v_profile_updates := v_profile_updates + v_row_count;
    end if;

    if v_sem_budget is not null then
      update public."ContractProfileValue" cpv
      set value = v_sem_budget,
          field_name = 'SEM - Monthly P11 Ad Spend',
          link_id = v_client.contract_id::text
      where cpv.field_name = 'SEM - Monthly P11 Ad Spend'
        and cpv.link_id = v_client.contract_id::text;
      get diagnostics v_row_count = row_count;
      v_profile_updates := v_profile_updates + v_row_count;
    end if;

    if v_social_budget is not null then
      update public."ContractProfileValue" cpv
      set value = v_social_budget,
          field_name = 'Social - Monthly P11 Spend',
          link_id = v_client.contract_id::text
      where cpv.field_name = 'Social - Monthly P11 Spend'
        and cpv.link_id = v_client.contract_id::text;
      get diagnostics v_row_count = row_count;
      v_profile_updates := v_profile_updates + v_row_count;
    end if;
  end if;

  update onboarding.onboarding_sync_job j
  set status = 'processed',
      processed_at = now(),
      attempt_count = j.attempt_count + 1
  where j.onboarding_client_id = p_onboarding_client_id
    and j.status = 'queued'
    and j.job_type = 'canonical_sync';

  v_sync_summary := jsonb_build_object(
    'onboarding_client_id', p_onboarding_client_id,
    'updated_company_rows', v_updated_company_count,
    'updated_contract_rows', v_updated_contract_count,
    'updated_profile_rows', v_profile_updates
  );

  return v_sync_summary;
end;
$$;

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------
create or replace view onboarding.onboarding_services_v
with (security_invoker = true)
as
select
  c.id as onboarding_client_id,
  c.display_name,
  c.company_id,
  s.id as onboarding_service_id,
  s.service_code,
  l.display_name as service_display_name,
  coalesce(s.legacy_service_type, l.legacy_contract_profile_value) as legacy_service_type,
  s.is_selected,
  sc.monthly_budget,
  sc.account_exists,
  sc.report_frequency,
  sc.report_delivery_preference,
  sc.key_metrics
from onboarding.onboarding_client c
left join onboarding.onboarding_service s on s.onboarding_client_id = c.id
left join onboarding.service_code_lookup l on l.service_code = s.service_code
left join onboarding.onboarding_service_config sc on sc.onboarding_service_id = s.id;

create or replace view onboarding.onboarding_platform_access_v
with (security_invoker = true)
as
select
  c.id as onboarding_client_id,
  c.display_name,
  p.platform_code,
  p.platform_label,
  p.is_required,
  p.requested_status,
  p.granted_status,
  p.verified_status,
  p.credential_request_status,
  p.credential_received_status,
  (p.verified_status = 'verified') as is_verified,
  (p.is_required and p.verified_status <> 'verified') as is_blocker
from onboarding.onboarding_client c
left join onboarding.onboarding_platform_access p on p.onboarding_client_id = c.id;

create or replace view onboarding.onboarding_readiness_v
with (security_invoker = true)
as
select
  c.id as onboarding_client_id,
  c.display_name,
  c.current_stage,
  c.status,
  c.target_go_live_at,
  count(*) filter (where p.is_required) as required_platform_count,
  count(*) filter (where p.is_required and p.verified_status = 'verified') as required_platform_verified_count,
  count(*) filter (where p.is_required and p.verified_status <> 'verified') as required_platform_outstanding_count,
  count(*) filter (where a.status = 'pending') as pending_approval_count,
  count(*) filter (where j.status = 'queued') as queued_sync_jobs
from onboarding.onboarding_client c
left join onboarding.onboarding_platform_access p on p.onboarding_client_id = c.id
left join onboarding.onboarding_approval a on a.onboarding_client_id = c.id
left join onboarding.onboarding_sync_job j on j.onboarding_client_id = c.id
group by c.id, c.display_name, c.current_stage, c.status, c.target_go_live_at;

create or replace view onboarding.onboarding_company_360_v
with (security_invoker = true)
as
select
  c.id as onboarding_client_id,
  c.display_name as onboarding_display_name,
  c.status as onboarding_status,
  c.current_stage,
  c.target_go_live_at,
  c.property_type_raw,
  c.property_type_normalized,
  c.company_id,
  pc."Name" as company_name,
  pc."Website" as company_website,
  pc."Phone" as company_phone,
  c.contract_id,
  ct."Title" as contract_title,
  c.job_id,
  j."Title" as job_title
from onboarding.onboarding_client c
left join public."Company" pc on pc."ID" = c.company_id
left join public."Contract" ct on ct."ID" = c.contract_id
left join public."Job" j on j."ID" = c.job_id;

create or replace view onboarding.portal_client_dashboard_v
with (security_invoker = true)
as
select
  r.onboarding_client_id,
  r.display_name,
  r.current_stage,
  r.status,
  r.target_go_live_at,
  r.required_platform_count,
  r.required_platform_verified_count,
  r.required_platform_outstanding_count,
  r.pending_approval_count,
  l.external_url as portal_link
from onboarding.onboarding_readiness_v r
left join onboarding.onboarding_link l
  on l.onboarding_client_id = r.onboarding_client_id
 and l.system_code = 'portal';

create or replace view onboarding.portal_internal_dashboard_v
with (security_invoker = true)
as
select
  r.onboarding_client_id,
  r.display_name,
  r.current_stage,
  r.status,
  r.target_go_live_at,
  r.required_platform_outstanding_count,
  r.pending_approval_count,
  r.queued_sync_jobs,
  (
    select jsonb_agg(
      jsonb_build_object(
        'role_code', a.role_code,
        'staff_name', a.staff_name,
        'staff_email', a.staff_email,
        'is_active', a.is_active
      ) order by a.role_code
    )
    from onboarding.onboarding_assignment a
    where a.onboarding_client_id = r.onboarding_client_id
  ) as assignments_json
from onboarding.onboarding_readiness_v r;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table onboarding.onboarding_client enable row level security;
alter table onboarding.onboarding_submission enable row level security;
alter table onboarding.onboarding_contact enable row level security;
alter table onboarding.onboarding_website enable row level security;
alter table onboarding.onboarding_strategy enable row level security;
alter table onboarding.onboarding_brand enable row level security;
alter table onboarding.onboarding_brand_asset enable row level security;
alter table onboarding.onboarding_service enable row level security;
alter table onboarding.onboarding_service_config enable row level security;
alter table onboarding.onboarding_platform_access enable row level security;
alter table onboarding.onboarding_link enable row level security;
alter table onboarding.onboarding_assignment enable row level security;
alter table onboarding.onboarding_approval enable row level security;
alter table onboarding.onboarding_stage_event enable row level security;
alter table onboarding.portal_user_company_access enable row level security;
alter table onboarding.onboarding_sync_job enable row level security;

drop policy if exists onboarding_client_select_policy on onboarding.onboarding_client;
create policy onboarding_client_select_policy
on onboarding.onboarding_client
for select
using (onboarding.is_internal_user() or onboarding.has_client_access(id));

drop policy if exists onboarding_client_modify_internal_policy on onboarding.onboarding_client;
create policy onboarding_client_modify_internal_policy
on onboarding.onboarding_client
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_submission_select_policy on onboarding.onboarding_submission;
create policy onboarding_submission_select_policy
on onboarding.onboarding_submission
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_submission_insert_policy on onboarding.onboarding_submission;
create policy onboarding_submission_insert_policy
on onboarding.onboarding_submission
for insert
with check (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_submission_update_policy on onboarding.onboarding_submission;
create policy onboarding_submission_update_policy
on onboarding.onboarding_submission
for update
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
)
with check (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_contact_select_policy on onboarding.onboarding_contact;
create policy onboarding_contact_select_policy
on onboarding.onboarding_contact
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_contact_modify_internal_policy on onboarding.onboarding_contact;
create policy onboarding_contact_modify_internal_policy
on onboarding.onboarding_contact
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_website_select_policy on onboarding.onboarding_website;
create policy onboarding_website_select_policy
on onboarding.onboarding_website
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_website_modify_internal_policy on onboarding.onboarding_website;
create policy onboarding_website_modify_internal_policy
on onboarding.onboarding_website
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_strategy_select_policy on onboarding.onboarding_strategy;
create policy onboarding_strategy_select_policy
on onboarding.onboarding_strategy
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_strategy_modify_internal_policy on onboarding.onboarding_strategy;
create policy onboarding_strategy_modify_internal_policy
on onboarding.onboarding_strategy
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_brand_select_policy on onboarding.onboarding_brand;
create policy onboarding_brand_select_policy
on onboarding.onboarding_brand
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_brand_modify_internal_policy on onboarding.onboarding_brand;
create policy onboarding_brand_modify_internal_policy
on onboarding.onboarding_brand
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_brand_asset_select_policy on onboarding.onboarding_brand_asset;
create policy onboarding_brand_asset_select_policy
on onboarding.onboarding_brand_asset
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_brand_asset_insert_policy on onboarding.onboarding_brand_asset;
create policy onboarding_brand_asset_insert_policy
on onboarding.onboarding_brand_asset
for insert
with check (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_brand_asset_update_policy on onboarding.onboarding_brand_asset;
create policy onboarding_brand_asset_update_policy
on onboarding.onboarding_brand_asset
for update
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
)
with check (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_service_select_policy on onboarding.onboarding_service;
create policy onboarding_service_select_policy
on onboarding.onboarding_service
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_service_modify_internal_policy on onboarding.onboarding_service;
create policy onboarding_service_modify_internal_policy
on onboarding.onboarding_service
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_service_config_select_policy on onboarding.onboarding_service_config;
create policy onboarding_service_config_select_policy
on onboarding.onboarding_service_config
for select
using (
  onboarding.is_internal_user()
  or exists (
    select 1
    from onboarding.onboarding_service s
    where s.id = onboarding_service_id
      and onboarding.has_client_access(s.onboarding_client_id)
  )
);

drop policy if exists onboarding_service_config_modify_internal_policy on onboarding.onboarding_service_config;
create policy onboarding_service_config_modify_internal_policy
on onboarding.onboarding_service_config
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_platform_access_select_policy on onboarding.onboarding_platform_access;
create policy onboarding_platform_access_select_policy
on onboarding.onboarding_platform_access
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_platform_access_modify_internal_policy on onboarding.onboarding_platform_access;
create policy onboarding_platform_access_modify_internal_policy
on onboarding.onboarding_platform_access
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_link_select_policy on onboarding.onboarding_link;
create policy onboarding_link_select_policy
on onboarding.onboarding_link
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_link_modify_internal_policy on onboarding.onboarding_link;
create policy onboarding_link_modify_internal_policy
on onboarding.onboarding_link
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_assignment_select_policy on onboarding.onboarding_assignment;
create policy onboarding_assignment_select_policy
on onboarding.onboarding_assignment
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_assignment_modify_internal_policy on onboarding.onboarding_assignment;
create policy onboarding_assignment_modify_internal_policy
on onboarding.onboarding_assignment
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_approval_select_policy on onboarding.onboarding_approval;
create policy onboarding_approval_select_policy
on onboarding.onboarding_approval
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_approval_modify_internal_policy on onboarding.onboarding_approval;
create policy onboarding_approval_modify_internal_policy
on onboarding.onboarding_approval
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_stage_event_select_policy on onboarding.onboarding_stage_event;
create policy onboarding_stage_event_select_policy
on onboarding.onboarding_stage_event
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_stage_event_modify_internal_policy on onboarding.onboarding_stage_event;
create policy onboarding_stage_event_modify_internal_policy
on onboarding.onboarding_stage_event
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists portal_user_company_access_select_policy on onboarding.portal_user_company_access;
create policy portal_user_company_access_select_policy
on onboarding.portal_user_company_access
for select
using (
  onboarding.is_internal_user()
  or auth_user_id = auth.uid()
);

drop policy if exists portal_user_company_access_modify_internal_policy on onboarding.portal_user_company_access;
create policy portal_user_company_access_modify_internal_policy
on onboarding.portal_user_company_access
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

drop policy if exists onboarding_sync_job_select_internal_policy on onboarding.onboarding_sync_job;
create policy onboarding_sync_job_select_internal_policy
on onboarding.onboarding_sync_job
for select
using (onboarding.is_internal_user());

drop policy if exists onboarding_sync_job_modify_internal_policy on onboarding.onboarding_sync_job;
create policy onboarding_sync_job_modify_internal_policy
on onboarding.onboarding_sync_job
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant usage on schema onboarding to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema onboarding to authenticated, service_role;
grant usage, select on all sequences in schema onboarding to authenticated, service_role;

grant execute on function onboarding.is_internal_user() to authenticated, service_role;
grant execute on function onboarding.has_client_access(bigint) to authenticated, service_role;
grant execute on function onboarding.normalize_property_type(text) to authenticated, service_role;
grant execute on function onboarding.map_property_type_to_company_profile_value(text) to authenticated, service_role;
grant execute on function onboarding.map_service_code_to_legacy(text) to authenticated, service_role;
grant execute on function onboarding.ingest_submission(bigint, jsonb, text, onboarding.submission_status) to authenticated, service_role;
grant execute on function onboarding.enqueue_sync_job(bigint, bigint, text, jsonb) to authenticated, service_role;
grant execute on function onboarding.sync_canonical_fields(bigint) to authenticated, service_role;

grant select on onboarding.onboarding_company_360_v to authenticated, service_role;
grant select on onboarding.onboarding_services_v to authenticated, service_role;
grant select on onboarding.onboarding_platform_access_v to authenticated, service_role;
grant select on onboarding.onboarding_readiness_v to authenticated, service_role;
grant select on onboarding.portal_client_dashboard_v to authenticated, service_role;
grant select on onboarding.portal_internal_dashboard_v to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Public Portal RPCs
-- -----------------------------------------------------------------------------
alter table onboarding.onboarding_client
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists idx_onboarding_client_public_token
  on onboarding.onboarding_client(public_token);

create or replace function onboarding.public_submit_intake(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = onboarding, public
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_onboarding_client_id bigint;
  v_public_token uuid;
  v_existing_client_id bigint;
  v_existing_token uuid;
  v_submission_id bigint;
  v_display_name text;
begin
  begin
    v_existing_client_id := nullif(v_payload ->> 'onboarding_client_id', '')::bigint;
  exception
    when others then
      v_existing_client_id := null;
  end;

  begin
    v_existing_token := nullif(v_payload ->> 'public_token', '')::uuid;
  exception
    when others then
      v_existing_token := null;
  end;

  if v_existing_client_id is not null and v_existing_token is not null then
    select c.id, c.public_token
    into v_onboarding_client_id, v_public_token
    from onboarding.onboarding_client c
    where c.id = v_existing_client_id
      and c.public_token = v_existing_token;
  end if;

  if v_onboarding_client_id is null then
    v_display_name := coalesce(
      nullif(v_payload ->> 'community_name', ''),
      nullif(v_payload ->> 'Community Name', ''),
      nullif(v_payload ->> 'communityName', ''),
      'New Client'
    );

    insert into onboarding.onboarding_client (
      display_name,
      current_stage,
      status,
      property_type_raw,
      property_type_normalized,
      community_phone,
      community_email,
      website_url,
      parent_company_raw,
      preferred_communication_method,
      final_notes,
      metadata_json
    )
    values (
      v_display_name,
      'intake_form',
      'submitted',
      coalesce(v_payload ->> 'community_type', v_payload ->> 'Community Type', v_payload ->> 'communityType'),
      onboarding.normalize_property_type(coalesce(v_payload ->> 'community_type', v_payload ->> 'Community Type', v_payload ->> 'communityType')),
      coalesce(v_payload ->> 'community_phone', v_payload ->> 'Community Phone', v_payload ->> 'communityPhone'),
      coalesce(v_payload ->> 'community_email', v_payload ->> 'Community Email', v_payload ->> 'communityEmail'),
      coalesce(v_payload ->> 'property_website_url', v_payload ->> 'Property Website URL', v_payload ->> 'propertyWebsiteUrl'),
      coalesce(v_payload ->> 'parent_company', v_payload ->> 'Parent Company / Developer', v_payload ->> 'parentCompany'),
      coalesce(v_payload ->> 'preferred_communication_method', v_payload ->> 'Preferred communication method', v_payload ->> 'preferredCommunicationMethod'),
      coalesce(v_payload ->> 'final_notes', v_payload ->> 'Anything else we should know before building your campaigns?', v_payload ->> 'anythingElseWeShouldKnow'),
      jsonb_build_object('created_via', 'public_submit_intake')
    )
    returning id, public_token into v_onboarding_client_id, v_public_token;

    insert into onboarding.onboarding_platform_access (
      onboarding_client_id,
      platform_code,
      platform_label,
      is_required,
      requested_status,
      granted_status,
      verified_status
    )
    select
      v_onboarding_client_id,
      p.platform_code,
      p.display_name,
      p.is_required_default,
      case
        when exists (
          select 1
          from jsonb_array_elements(coalesce(v_payload -> 'platform_access', '[]'::jsonb)) elem
          where lower(elem ->> 'platform_code') = lower(p.platform_code)
            and coalesce((elem ->> 'requested')::boolean, false) = true
        ) then 'requested'::onboarding.platform_status
        else 'not_requested'::onboarding.platform_status
      end,
      'not_requested'::onboarding.platform_status,
      'not_requested'::onboarding.platform_status
    from onboarding.platform_code_lookup p
    on conflict (onboarding_client_id, platform_code) do nothing;

    insert into onboarding.onboarding_stage_event (
      onboarding_client_id,
      stage_code,
      event_type,
      actor_type,
      actor_name,
      metadata_json
    )
    values (
      v_onboarding_client_id,
      'intake_form',
      'submitted',
      'client',
      'public_user',
      jsonb_build_object('source', 'public_submit_intake')
    );
  end if;

  v_submission_id := onboarding.ingest_submission(
    v_onboarding_client_id,
    v_payload,
    'public_form',
    'submitted'
  );

  return jsonb_build_object(
    'onboarding_client_id', v_onboarding_client_id,
    'public_token', v_public_token,
    'submission_id', v_submission_id,
    'status', 'ok'
  );
end;
$$;

create or replace function onboarding.public_get_onboarding_snapshot(
  p_onboarding_client_id bigint,
  p_public_token uuid
)
returns jsonb
language sql
security definer
set search_path = onboarding, public
as $$
  with client_row as (
    select c.*
    from onboarding.onboarding_client c
    where c.id = p_onboarding_client_id
      and c.public_token = p_public_token
  ),
  readiness as (
    select r.*
    from onboarding.onboarding_readiness_v r
    where r.onboarding_client_id = p_onboarding_client_id
  )
  select case
    when exists (select 1 from client_row) then
      jsonb_build_object(
        'onboarding_client_id', c.id,
        'display_name', c.display_name,
        'status', c.status,
        'current_stage', c.current_stage,
        'target_go_live_at', c.target_go_live_at,
        'required_platform_count', coalesce(r.required_platform_count, 0),
        'required_platform_verified_count', coalesce(r.required_platform_verified_count, 0),
        'required_platform_outstanding_count', coalesce(r.required_platform_outstanding_count, 0),
        'pending_approval_count', coalesce(r.pending_approval_count, 0)
      )
    else null
  end
  from client_row c
  left join readiness r on true;
$$;

grant execute on function onboarding.public_submit_intake(jsonb) to anon, authenticated, service_role;
grant execute on function onboarding.public_get_onboarding_snapshot(bigint, uuid) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Internal Checklist Task State Persistence
-- -----------------------------------------------------------------------------
create table if not exists onboarding.onboarding_task_state (
  id bigint generated always as identity primary key,
  onboarding_client_id bigint not null references onboarding.onboarding_client(id) on delete cascade,
  task_key text not null,
  group_code text,
  task_text text,
  is_complete boolean not null default false,
  updated_by_source text not null default 'portal_ui',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_client_id, task_key)
);

create index if not exists idx_onboarding_task_state_client
  on onboarding.onboarding_task_state(onboarding_client_id);

create index if not exists idx_onboarding_task_state_group
  on onboarding.onboarding_task_state(group_code);

drop trigger if exists trg_onboarding_task_state_updated_at on onboarding.onboarding_task_state;
create trigger trg_onboarding_task_state_updated_at
before update on onboarding.onboarding_task_state
for each row execute function onboarding.tg_set_updated_at();

alter table onboarding.onboarding_task_state enable row level security;

drop policy if exists onboarding_task_state_select_policy on onboarding.onboarding_task_state;
create policy onboarding_task_state_select_policy
on onboarding.onboarding_task_state
for select
using (
  onboarding.is_internal_user()
  or onboarding.has_client_access(onboarding_client_id)
);

drop policy if exists onboarding_task_state_modify_internal_policy on onboarding.onboarding_task_state;
create policy onboarding_task_state_modify_internal_policy
on onboarding.onboarding_task_state
for all
using (onboarding.is_internal_user())
with check (onboarding.is_internal_user());

create or replace function onboarding.public_upsert_task_state(
  p_onboarding_client_id bigint,
  p_public_token uuid,
  p_task_key text,
  p_is_complete boolean,
  p_group_code text default null,
  p_task_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = onboarding, public
as $$
declare
  v_valid boolean := false;
begin
  select exists (
    select 1
    from onboarding.onboarding_client c
    where c.id = p_onboarding_client_id
      and c.public_token = p_public_token
  ) into v_valid;

  if not v_valid then
    raise exception 'Invalid onboarding token' using errcode = '28000';
  end if;

  if p_task_key is null or length(trim(p_task_key)) = 0 then
    raise exception 'task_key is required';
  end if;

  insert into onboarding.onboarding_task_state (
    onboarding_client_id,
    task_key,
    group_code,
    task_text,
    is_complete,
    updated_by_source
  )
  values (
    p_onboarding_client_id,
    trim(p_task_key),
    p_group_code,
    p_task_text,
    coalesce(p_is_complete, false),
    'public_portal'
  )
  on conflict (onboarding_client_id, task_key)
  do update set
    group_code = excluded.group_code,
    task_text = excluded.task_text,
    is_complete = excluded.is_complete,
    updated_by_source = excluded.updated_by_source,
    updated_at = now();

  return jsonb_build_object(
    'status', 'ok',
    'onboarding_client_id', p_onboarding_client_id,
    'task_key', trim(p_task_key),
    'is_complete', coalesce(p_is_complete, false)
  );
end;
$$;

create or replace function onboarding.public_list_task_states(
  p_onboarding_client_id bigint,
  p_public_token uuid
)
returns jsonb
language sql
security definer
set search_path = onboarding, public
as $$
  with valid_client as (
    select c.id
    from onboarding.onboarding_client c
    where c.id = p_onboarding_client_id
      and c.public_token = p_public_token
  )
  select case
    when exists (select 1 from valid_client) then
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'task_key', t.task_key,
              'group_code', t.group_code,
              'task_text', t.task_text,
              'is_complete', t.is_complete,
              'updated_at', t.updated_at
            )
            order by t.group_code nulls last, t.task_key
          )
          from onboarding.onboarding_task_state t
          where t.onboarding_client_id = p_onboarding_client_id
        ),
        '[]'::jsonb
      )
    else null
  end;
$$;

grant select, insert, update, delete on onboarding.onboarding_task_state to authenticated, service_role;
grant execute on function onboarding.public_upsert_task_state(bigint, uuid, text, boolean, text, text) to anon, authenticated, service_role;
grant execute on function onboarding.public_list_task_states(bigint, uuid) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Auth-Required Company Signup Flow
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create table if not exists onboarding.company_directory (
  id bigint generated always as identity primary key,
  public_company_id bigint,
  company_name text not null,
  normalized_name text not null,
  created_via text not null default 'import',
  created_by_auth_uid uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_company_directory_public_company_id
  on onboarding.company_directory(public_company_id)
  where public_company_id is not null;

create index if not exists idx_company_directory_normalized_name
  on onboarding.company_directory(normalized_name);

create index if not exists idx_company_directory_name_trgm
  on onboarding.company_directory using gin (company_name gin_trgm_ops);

create table if not exists onboarding.portal_user_profile (
  auth_user_id uuid primary key,
  email text,
  full_name text,
  company_directory_id bigint references onboarding.company_directory(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding.internal_user_access (
  auth_user_id uuid primary key,
  email text not null,
  full_name text,
  portal_role text not null default 'internal',
  invited_by_auth_user_id uuid,
  invite_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_user_access_role_check check (portal_role in ('internal', 'admin'))
);

create table if not exists onboarding.internal_signup_invite (
  id bigint generated always as identity primary key,
  invite_token_hash text not null unique,
  invited_email text not null,
  invited_full_name text,
  portal_role text not null default 'internal',
  invited_by_auth_user_id uuid not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_auth_user_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_signup_invite_role_check check (portal_role in ('internal', 'admin'))
);

create index if not exists idx_internal_user_access_role
  on onboarding.internal_user_access(portal_role);

create index if not exists idx_internal_signup_invite_email
  on onboarding.internal_signup_invite(lower(invited_email));

create index if not exists idx_internal_signup_invite_expires_at
  on onboarding.internal_signup_invite(expires_at);

drop trigger if exists trg_internal_user_access_updated_at on onboarding.internal_user_access;
create trigger trg_internal_user_access_updated_at
before update on onboarding.internal_user_access
for each row execute function onboarding.tg_set_updated_at();

drop trigger if exists trg_internal_signup_invite_updated_at on onboarding.internal_signup_invite;
create trigger trg_internal_signup_invite_updated_at
before update on onboarding.internal_signup_invite
for each row execute function onboarding.tg_set_updated_at();

alter table onboarding.onboarding_client
  add column if not exists company_directory_id bigint references onboarding.company_directory(id) on delete set null,
  add column if not exists owner_auth_user_id uuid;

insert into onboarding.company_directory (
  public_company_id,
  company_name,
  normalized_name,
  created_via,
  metadata_json
)
select
  c."ID",
  c."Name",
  regexp_replace(lower(coalesce(c."Name", '')), '[^a-z0-9]+', '', 'g'),
  'import',
  jsonb_build_object('source', 'public.Company')
from public."Company" c
where c."Name" is not null
  and length(trim(c."Name")) > 0
on conflict do nothing;

create or replace function onboarding.normalize_company_name(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(p_value, ''))), '[^a-z0-9]+', '', 'g');
$$;

create or replace function public.search_companies(
  p_query text,
  p_limit integer default 8
)
returns jsonb
language sql
security definer
set search_path = public, onboarding
as $$
  with params as (
    select trim(coalesce(p_query, '')) as q,
           greatest(1, least(coalesce(p_limit, 8), 20)) as lim
  ),
  matches as (
    select
      cd.id as company_directory_id,
      cd.public_company_id,
      cd.company_name,
      similarity(lower(cd.company_name), lower(p.q)) as score,
      cd.created_via
    from onboarding.company_directory cd
    cross join params p
    where p.q <> ''
      and (
        cd.company_name ilike '%' || p.q || '%'
        or cd.normalized_name % onboarding.normalize_company_name(p.q)
        or similarity(lower(cd.company_name), lower(p.q)) >= 0.2
      )
    order by
      case when lower(cd.company_name) = lower(p.q) then 1 else 0 end desc,
      case when lower(cd.company_name) like lower(p.q) || '%' then 1 else 0 end desc,
      score desc,
      cd.company_name asc
    limit (select lim from params)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'company_directory_id', company_directory_id,
        'public_company_id', public_company_id,
        'company_name', company_name,
        'score', score,
        'created_via', created_via
      )
    ),
    '[]'::jsonb
  )
  from matches;
$$;

create or replace function public.complete_portal_signup(
  p_full_name text,
  p_email text,
  p_company_directory_id bigint default null,
  p_company_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text := trim(coalesce(p_email, ''));
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_requested_company_name text := trim(coalesce(p_company_name, ''));
  v_requested_company_normalized text;
  v_company_directory_id bigint;
  v_public_company_id bigint;
  v_company_name text;
  v_onboarding_client_id bigint;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_full_name = '' or v_email = '' then
    raise exception 'Full name and email are required';
  end if;

  if p_company_directory_id is not null then
    select cd.id, cd.public_company_id, cd.company_name
    into v_company_directory_id, v_public_company_id, v_company_name
    from onboarding.company_directory cd
    where cd.id = p_company_directory_id;
  end if;

  if v_company_directory_id is null then
    if v_requested_company_name = '' then
      raise exception 'Company selection or company name is required';
    end if;
    v_requested_company_normalized := onboarding.normalize_company_name(v_requested_company_name);

    select cd.id, cd.public_company_id, cd.company_name
    into v_company_directory_id, v_public_company_id, v_company_name
    from onboarding.company_directory cd
    where cd.normalized_name = v_requested_company_normalized
    order by cd.id asc
    limit 1;

    if v_company_directory_id is null then
      insert into onboarding.company_directory (
        public_company_id,
        company_name,
        normalized_name,
        created_via,
        created_by_auth_uid,
        metadata_json
      )
      values (
        null,
        v_requested_company_name,
        v_requested_company_normalized,
        'signup',
        v_auth_user_id,
        jsonb_build_object('created_from', 'complete_portal_signup')
      )
      on conflict (normalized_name) where (public_company_id is null)
      do update set
        updated_at = now()
      returning id, public_company_id, company_name
      into v_company_directory_id, v_public_company_id, v_company_name;
    end if;
  end if;

  insert into onboarding.portal_user_profile (
    auth_user_id,
    email,
    full_name,
    company_directory_id
  )
  values (
    v_auth_user_id,
    v_email,
    v_full_name,
    v_company_directory_id
  )
  on conflict (auth_user_id)
  do update set
    email = excluded.email,
    full_name = excluded.full_name,
    company_directory_id = excluded.company_directory_id,
    updated_at = now();

  select c.id
  into v_onboarding_client_id
  from onboarding.onboarding_client c
  where c.company_directory_id = v_company_directory_id
    and c.display_name = 'New Community'
    and c.current_stage = 'contract_signed'
    and c.status = 'draft'
    and (c.owner_auth_user_id is null or c.owner_auth_user_id = v_auth_user_id)
    and not exists (
      select 1
      from onboarding.onboarding_submission s
      where s.onboarding_client_id = c.id
        and s.submission_status in ('submitted', 'resubmitted')
    )
  order by c.updated_at desc, c.id desc
  limit 1;

  if v_onboarding_client_id is null then
    insert into onboarding.onboarding_client (
      company_id,
      company_directory_id,
      status,
      current_stage,
      display_name,
      metadata_json,
      owner_auth_user_id
    )
    values (
      v_public_company_id,
      v_company_directory_id,
      'draft',
      'contract_signed',
      'New Community',
      jsonb_build_object(
        'created_via', 'complete_portal_signup',
        'company_name', v_company_name
      ),
      v_auth_user_id
    )
    returning id into v_onboarding_client_id;
  else
    update onboarding.onboarding_client c
    set owner_auth_user_id = coalesce(c.owner_auth_user_id, v_auth_user_id),
        company_id = coalesce(c.company_id, v_public_company_id),
        display_name = case
          when c.display_name is null
            or btrim(c.display_name) = ''
            or lower(btrim(c.display_name)) = lower(btrim(v_company_name))
          then 'New Community'
          else c.display_name
        end
    where id = v_onboarding_client_id;
  end if;

  insert into onboarding.portal_user_company_access (
    auth_user_id,
    company_id,
    onboarding_client_id,
    portal_role,
    is_active
  )
  values (
    v_auth_user_id,
    v_public_company_id,
    v_onboarding_client_id,
    'client',
    true
  )
  on conflict (auth_user_id, onboarding_client_id, portal_role)
  do update set
    company_id = excluded.company_id,
    is_active = true,
    updated_at = now();

  update onboarding.portal_user_company_access m
  set is_active = (m.onboarding_client_id = v_onboarding_client_id),
      updated_at = case
        when m.onboarding_client_id = v_onboarding_client_id then now()
        else m.updated_at
      end
  where m.auth_user_id = v_auth_user_id
    and m.portal_role = 'client';

  return jsonb_build_object(
    'status', 'ok',
    'auth_user_id', v_auth_user_id,
    'company_directory_id', v_company_directory_id,
    'public_company_id', v_public_company_id,
    'company_name', v_company_name,
    'onboarding_client_id', v_onboarding_client_id
  );
end;
$$;

create or replace function public.get_my_portal_context()
returns jsonb
language sql
security definer
set search_path = public, onboarding
as $$
  with profile as (
    select p.auth_user_id, p.email, p.full_name, p.company_directory_id
    from onboarding.portal_user_profile p
    where p.auth_user_id = auth.uid()
  ),
  membership as (
    select m.onboarding_client_id, m.company_id, m.portal_role
    from onboarding.portal_user_company_access m
    where m.auth_user_id = auth.uid()
      and m.is_active = true
    order by m.updated_at desc, m.id desc
    limit 1
  ),
  client_ctx as (
    select c.id, c.display_name, c.status, c.current_stage, c.target_go_live_at, c.company_directory_id, c.company_id
    from onboarding.onboarding_client c
    join membership m on m.onboarding_client_id = c.id
  ),
  company_ctx as (
    select d.id, d.company_name, d.public_company_id
    from onboarding.company_directory d
    join client_ctx c on c.company_directory_id = d.id
  )
  select case
    when exists (select 1 from profile) and exists (select 1 from membership) then
      jsonb_build_object(
        'auth_user_id', (select auth_user_id from profile),
        'email', (select email from profile),
        'full_name', (select full_name from profile),
        'portal_role', (select portal_role from membership),
        'onboarding_client_id', (select id from client_ctx),
        'community_name', (select display_name from client_ctx),
        'display_name', (select display_name from client_ctx),
        'status', (select status from client_ctx),
        'current_stage', (select current_stage from client_ctx),
        'target_go_live_at', (select target_go_live_at from client_ctx),
        'company_directory_id', (select id from company_ctx),
        'company_name', (select company_name from company_ctx),
        'public_company_id', (select public_company_id from company_ctx)
      )
    else null
  end;
$$;

create or replace function public.submit_my_intake(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_onboarding_client_id bigint;
  v_submission_id bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_company_id bigint;
  v_company_directory_id bigint;
  v_current_community_name text;
  v_requested_community_name text;
  v_existing_submission_count integer := 0;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.onboarding_client_id, c.company_id, c.company_directory_id, c.display_name
  into v_onboarding_client_id, v_company_id, v_company_directory_id, v_current_community_name
  from onboarding.portal_user_company_access m
  join onboarding.onboarding_client c on c.id = m.onboarding_client_id
  where m.auth_user_id = v_auth_user_id
    and m.is_active = true
  order by m.updated_at desc, m.id desc
  limit 1;

  if v_onboarding_client_id is null then
    raise exception 'No onboarding membership found for current user';
  end if;

  v_requested_community_name := nullif(
    trim(
      coalesce(
        v_payload ->> 'community_name',
        v_payload ->> 'Community Name',
        v_payload ->> 'communityName'
      )
    ),
    ''
  );

  select count(*)
  into v_existing_submission_count
  from onboarding.onboarding_submission s
  where s.onboarding_client_id = v_onboarding_client_id
    and s.submission_status in ('submitted', 'resubmitted');

  if v_requested_community_name is not null
    and v_existing_submission_count > 0
    and coalesce(lower(btrim(v_current_community_name)), '') <> lower(v_requested_community_name)
  then
    insert into onboarding.onboarding_client (
      company_id,
      company_directory_id,
      status,
      current_stage,
      display_name,
      metadata_json,
      owner_auth_user_id
    )
    values (
      v_company_id,
      v_company_directory_id,
      'draft',
      'contract_signed',
      v_requested_community_name,
      jsonb_build_object(
        'created_via', 'submit_my_intake',
        'spawned_from_onboarding_client_id', v_onboarding_client_id
      ),
      v_auth_user_id
    )
    returning id into v_onboarding_client_id;

  end if;

  insert into onboarding.portal_user_company_access (
    auth_user_id,
    company_id,
    onboarding_client_id,
    portal_role,
    is_active
  )
  values (
    v_auth_user_id,
    v_company_id,
    v_onboarding_client_id,
    'client',
    true
  )
  on conflict (auth_user_id, onboarding_client_id, portal_role)
  do update set
    company_id = excluded.company_id,
    is_active = true,
    updated_at = now();

  update onboarding.portal_user_company_access m
  set is_active = (m.onboarding_client_id = v_onboarding_client_id),
      updated_at = case
        when m.onboarding_client_id = v_onboarding_client_id then now()
        else m.updated_at
      end
  where m.auth_user_id = v_auth_user_id
    and m.portal_role = 'client';

  update onboarding.onboarding_client c
  set current_stage = case
        when c.current_stage < 'account_access'::onboarding.onboarding_stage
          then 'account_access'::onboarding.onboarding_stage
        else c.current_stage
      end,
      status = 'submitted',
      updated_by = v_auth_user_id
  where c.id = v_onboarding_client_id;

  v_submission_id := onboarding.ingest_submission(
    v_onboarding_client_id,
    v_payload,
    'authenticated_portal',
    'submitted'
  );

  return jsonb_build_object(
    'status', 'ok',
    'onboarding_client_id', v_onboarding_client_id,
    'submission_id', v_submission_id,
    'community_name', v_requested_community_name
  );
end;
$$;

create or replace function public.list_my_communities()
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_scope_company_directory_id bigint;
  v_active_onboarding_client_id bigint;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.onboarding_client_id, c.company_directory_id
  into v_active_onboarding_client_id, v_scope_company_directory_id
  from onboarding.portal_user_company_access m
  join onboarding.onboarding_client c on c.id = m.onboarding_client_id
  where m.auth_user_id = v_auth_user_id
    and m.is_active = true
  order by m.updated_at desc, m.id desc
  limit 1;

  if v_scope_company_directory_id is null then
    select p.company_directory_id
    into v_scope_company_directory_id
    from onboarding.portal_user_profile p
    where p.auth_user_id = v_auth_user_id;
  end if;

  if v_scope_company_directory_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      with scoped as (
        select
          c.id as onboarding_client_id,
          c.company_directory_id,
          d.company_name,
          c.display_name as community_name,
          c.current_stage,
          c.status,
          c.target_go_live_at,
          c.updated_at,
          (
            c.display_name = 'New Community'
            and c.current_stage = 'contract_signed'
            and c.status = 'draft'
          ) as is_nascent,
          (
            select max(s.submitted_at)
            from onboarding.onboarding_submission s
            where s.onboarding_client_id = c.id
              and s.submission_status in ('submitted', 'resubmitted')
          ) as last_submitted_at
        from onboarding.onboarding_client c
        left join onboarding.company_directory d on d.id = c.company_directory_id
        where c.company_directory_id = v_scope_company_directory_id
      ),
      filtered as (
        select s.*
        from scoped s
        where
          case
            when exists (select 1 from scoped x where x.is_nascent = false) then s.is_nascent = false
            else true
          end
      ),
      ranked as (
        select
          f.*,
          row_number() over (
            order by
              (f.onboarding_client_id = v_active_onboarding_client_id) desc,
              f.updated_at desc,
              f.onboarding_client_id desc
          ) as row_rank
        from filtered f
      ),
      final_rows as (
        select r.*
        from ranked r
        where r.is_nascent = false
           or r.row_rank = 1
      )
      select jsonb_agg(
        jsonb_build_object(
          'onboarding_client_id', f.onboarding_client_id,
          'company_directory_id', f.company_directory_id,
          'company_name', f.company_name,
          'community_name', f.community_name,
          'current_stage', f.current_stage,
          'status', f.status,
          'target_go_live_at', f.target_go_live_at,
          'last_submitted_at', f.last_submitted_at,
          'updated_at', f.updated_at,
          'is_active', (f.onboarding_client_id = v_active_onboarding_client_id)
        )
        order by f.updated_at desc, f.onboarding_client_id desc
      )
      from final_rows f
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.get_my_latest_submission_payload(
  p_onboarding_client_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_onboarding_client_id bigint := p_onboarding_client_id;
  v_payload jsonb;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_onboarding_client_id is null then
    select m.onboarding_client_id
    into v_onboarding_client_id
    from onboarding.portal_user_company_access m
    where m.auth_user_id = v_auth_user_id
      and m.is_active = true
    order by m.updated_at desc, m.id desc
    limit 1;
  end if;

  if v_onboarding_client_id is null then
    return null;
  end if;

  if not onboarding.is_internal_user() then
    if not exists (
      select 1
      from onboarding.portal_user_company_access m
      where m.auth_user_id = v_auth_user_id
        and m.onboarding_client_id = v_onboarding_client_id
    ) then
      raise exception 'You do not have access to this community' using errcode = '42501';
    end if;
  end if;

  select s.raw_payload_json
  into v_payload
  from onboarding.onboarding_submission s
  where s.onboarding_client_id = v_onboarding_client_id
    and s.submission_status in ('submitted', 'resubmitted')
  order by s.submitted_at desc nulls last, s.id desc
  limit 1;

  return v_payload;
end;
$$;

create or replace function public.set_my_active_community(p_onboarding_client_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_is_internal boolean := onboarding.is_internal_user();
  v_profile_company_directory_id bigint;
  v_target_company_directory_id bigint;
  v_target_company_id bigint;
  v_portal_role text := 'client';
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_onboarding_client_id is null then
    raise exception 'onboarding_client_id is required';
  end if;

  select c.company_directory_id, c.company_id
  into v_target_company_directory_id, v_target_company_id
  from onboarding.onboarding_client c
  where c.id = p_onboarding_client_id;

  if v_target_company_directory_id is null then
    raise exception 'Onboarding community not found';
  end if;

  if not v_is_internal then
    select p.company_directory_id
    into v_profile_company_directory_id
    from onboarding.portal_user_profile p
    where p.auth_user_id = v_auth_user_id;

    if v_profile_company_directory_id is null then
      raise exception 'No company profile found for current user';
    end if;

    if v_profile_company_directory_id <> v_target_company_directory_id then
      raise exception 'You do not have access to this community';
    end if;
    v_portal_role := 'client';
  else
    v_portal_role := 'internal';
  end if;

  insert into onboarding.portal_user_company_access (
    auth_user_id,
    company_id,
    onboarding_client_id,
    portal_role,
    is_active
  )
  values (
    v_auth_user_id,
    v_target_company_id,
    p_onboarding_client_id,
    v_portal_role,
    true
  )
  on conflict (auth_user_id, onboarding_client_id, portal_role)
  do update set
    company_id = excluded.company_id,
    is_active = true,
    updated_at = now();

  update onboarding.portal_user_company_access m
  set is_active = (m.onboarding_client_id = p_onboarding_client_id),
      updated_at = case
        when m.onboarding_client_id = p_onboarding_client_id then now()
        else m.updated_at
      end
  where m.auth_user_id = v_auth_user_id
    and m.portal_role = v_portal_role;

  return jsonb_build_object(
    'status', 'ok',
    'portal_role', v_portal_role,
    'onboarding_client_id', p_onboarding_client_id,
    'company_directory_id', v_target_company_directory_id
  );
end;
$$;

create or replace function public.get_internal_portal_context()
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_profile onboarding.portal_user_profile%rowtype;
  v_portal_role text := case when onboarding.is_admin_user() then 'admin' else 'internal' end;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not onboarding.is_internal_user() then
    raise exception 'Internal access required' using errcode = '42501';
  end if;

  select *
  into v_profile
  from onboarding.portal_user_profile p
  where p.auth_user_id = v_auth_user_id;

  return jsonb_build_object(
    'auth_user_id', v_auth_user_id,
    'email', coalesce(v_profile.email, auth.jwt() ->> 'email'),
    'full_name', coalesce(v_profile.full_name, auth.jwt() -> 'user_metadata' ->> 'full_name'),
    'portal_role', v_portal_role
  );
end;
$$;

create or replace function public.get_internal_signup_invite(
  p_invite_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_token text := trim(coalesce(p_invite_token, ''));
  v_token_hash text;
  v_invite onboarding.internal_signup_invite%rowtype;
begin
  if v_token = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select *
  into v_invite
  from onboarding.internal_signup_invite i
  where i.invite_token_hash = v_token_hash
  limit 1;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_invite.redeemed_at is not null or v_invite.expires_at <= now() then
    return jsonb_build_object('status', 'invalid');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'invite_id', v_invite.id,
    'invited_email', v_invite.invited_email,
    'invited_full_name', v_invite.invited_full_name,
    'portal_role', v_invite.portal_role,
    'expires_at', v_invite.expires_at
  );
end;
$$;

create or replace function public.create_internal_signup_invite(
  p_email text,
  p_full_name text default null,
  p_portal_role text default 'internal',
  p_expires_in_hours integer default 168,
  p_invite_base_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_full_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_portal_role text := lower(trim(coalesce(p_portal_role, 'internal')));
  v_expires_in_hours integer := greatest(1, least(coalesce(p_expires_in_hours, 168), 720));
  v_expires_at timestamptz := now() + make_interval(hours => v_expires_in_hours);
  v_token text;
  v_token_hash text;
  v_invite_id bigint;
  v_base_url text;
  v_invite_url text;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not onboarding.is_admin_user() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if v_email = '' then
    raise exception 'Invite email is required';
  end if;

  if v_portal_role not in ('internal', 'admin') then
    raise exception 'Invalid portal role';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_base_url := coalesce(
    nullif(trim(coalesce(p_invite_base_url, '')), ''),
    'https://example.com/internal-signup.html'
  );
  v_invite_url := case
    when position('?' in v_base_url) > 0 then v_base_url || '&invite=' || v_token
    else v_base_url || '?invite=' || v_token
  end;

  insert into onboarding.internal_signup_invite (
    invite_token_hash,
    invited_email,
    invited_full_name,
    portal_role,
    invited_by_auth_user_id,
    expires_at,
    metadata_json
  )
  values (
    v_token_hash,
    v_email,
    v_full_name,
    v_portal_role,
    v_auth_user_id,
    v_expires_at,
    jsonb_build_object('created_from', 'create_internal_signup_invite')
  )
  returning id into v_invite_id;

  return jsonb_build_object(
    'status', 'ok',
    'invite_id', v_invite_id,
    'invite_url', v_invite_url,
    'invited_email', v_email,
    'portal_role', v_portal_role,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.redeem_internal_signup_invite(
  p_invite_token text,
  p_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_token text := trim(coalesce(p_invite_token, ''));
  v_token_hash text;
  v_invite onboarding.internal_signup_invite%rowtype;
  v_session_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_full_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_role text;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_token = '' then
    raise exception 'Invite token is required';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select *
  into v_invite
  from onboarding.internal_signup_invite i
  where i.invite_token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'Invite is invalid';
  end if;

  if v_invite.redeemed_at is not null and v_invite.redeemed_by_auth_user_id = v_auth_user_id then
    return jsonb_build_object(
      'status', 'ok',
      'portal_role', coalesce(v_invite.portal_role, 'internal'),
      'email', coalesce(v_invite.invited_email, v_session_email)
    );
  end if;

  if v_invite.redeemed_at is not null then
    raise exception 'Invite is already used';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'Invite is expired';
  end if;

  if v_session_email = '' then
    raise exception 'Authenticated email is required';
  end if;

  if lower(trim(v_invite.invited_email)) <> v_session_email then
    raise exception 'This invite is not for the authenticated email address';
  end if;

  if v_full_name is null then
    v_full_name := nullif(trim(coalesce(v_invite.invited_full_name, '')), '');
  end if;

  if v_full_name is null then
    v_full_name := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), '');
  end if;

  if v_full_name is null then
    v_full_name := split_part(v_session_email, '@', 1);
  end if;

  insert into onboarding.portal_user_profile (
    auth_user_id,
    email,
    full_name
  )
  values (
    v_auth_user_id,
    v_session_email,
    v_full_name
  )
  on conflict (auth_user_id)
  do update set
    email = excluded.email,
    full_name = excluded.full_name,
    updated_at = now();

  select case
    when exists (
      select 1
      from onboarding.internal_user_access i
      where i.auth_user_id = v_auth_user_id
        and i.portal_role = 'admin'
    ) then 'admin'
    when v_invite.portal_role = 'admin' then 'admin'
    else 'internal'
  end
  into v_role;

  insert into onboarding.internal_user_access (
    auth_user_id,
    email,
    full_name,
    portal_role,
    invited_by_auth_user_id,
    invite_id
  )
  values (
    v_auth_user_id,
    v_session_email,
    v_full_name,
    v_role,
    v_invite.invited_by_auth_user_id,
    v_invite.id
  )
  on conflict (auth_user_id)
  do update set
    email = excluded.email,
    full_name = excluded.full_name,
    portal_role = case
      when onboarding.internal_user_access.portal_role = 'admin' then 'admin'
      else excluded.portal_role
    end,
    invite_id = excluded.invite_id,
    invited_by_auth_user_id = coalesce(
      onboarding.internal_user_access.invited_by_auth_user_id,
      excluded.invited_by_auth_user_id
    ),
    updated_at = now();

  update onboarding.internal_signup_invite i
  set redeemed_at = now(),
      redeemed_by_auth_user_id = v_auth_user_id,
      updated_at = now()
  where i.id = v_invite.id;

  return jsonb_build_object(
    'status', 'ok',
    'portal_role', v_role,
    'email', v_session_email,
    'auth_user_id', v_auth_user_id
  );
end;
$$;

create or replace function public.internal_list_onboarding_overview(
  p_search text default null,
  p_stage onboarding.onboarding_stage default null,
  p_limit integer default 400
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 400), 1000));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not onboarding.is_internal_user() then
    raise exception 'Internal access required' using errcode = '42501';
  end if;

  return coalesce(
    (
      with rows as (
        select
          c.id as onboarding_client_id,
          c.company_directory_id,
          d.company_name,
          c.display_name as community_name,
          c.current_stage,
          c.status,
          c.target_go_live_at,
          c.updated_at,
          (
            select max(s.submitted_at)
            from onboarding.onboarding_submission s
            where s.onboarding_client_id = c.id
              and s.submission_status in ('submitted', 'resubmitted')
          ) as last_submitted_at
        from onboarding.onboarding_client c
        left join onboarding.company_directory d on d.id = c.company_directory_id
        where (p_stage is null or c.current_stage = p_stage)
          and (
            v_search is null
            or coalesce(d.company_name, '') ilike '%' || v_search || '%'
            or coalesce(c.display_name, '') ilike '%' || v_search || '%'
          )
        order by c.updated_at desc, c.id desc
        limit v_limit
      )
      select jsonb_agg(
        jsonb_build_object(
          'onboarding_client_id', r.onboarding_client_id,
          'company_directory_id', r.company_directory_id,
          'company_name', r.company_name,
          'community_name', r.community_name,
          'current_stage', r.current_stage,
          'status', r.status,
          'target_go_live_at', r.target_go_live_at,
          'last_submitted_at', r.last_submitted_at,
          'updated_at', r.updated_at
        )
        order by r.updated_at desc, r.onboarding_client_id desc
      )
      from rows r
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.list_my_task_states()
returns jsonb
language sql
security definer
set search_path = public, onboarding
as $$
  with membership as (
    select m.onboarding_client_id
    from onboarding.portal_user_company_access m
    where m.auth_user_id = auth.uid()
      and m.is_active = true
    order by m.updated_at desc, m.id desc
    limit 1
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'task_key', t.task_key,
          'group_code', t.group_code,
          'task_text', t.task_text,
          'is_complete', t.is_complete,
          'updated_at', t.updated_at
        )
        order by t.group_code nulls last, t.task_key
      )
      from onboarding.onboarding_task_state t
      where t.onboarding_client_id = (select onboarding_client_id from membership)
    ),
    '[]'::jsonb
  );
$$;

create or replace function public.upsert_my_task_state(
  p_task_key text,
  p_is_complete boolean,
  p_group_code text default null,
  p_task_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, onboarding
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_onboarding_client_id bigint;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.onboarding_client_id
  into v_onboarding_client_id
  from onboarding.portal_user_company_access m
  where m.auth_user_id = v_auth_user_id
    and m.is_active = true
  order by m.updated_at desc, m.id desc
  limit 1;

  if v_onboarding_client_id is null then
    raise exception 'No onboarding membership found for current user';
  end if;

  insert into onboarding.onboarding_task_state (
    onboarding_client_id,
    task_key,
    group_code,
    task_text,
    is_complete,
    updated_by_source
  )
  values (
    v_onboarding_client_id,
    trim(p_task_key),
    p_group_code,
    p_task_text,
    coalesce(p_is_complete, false),
    'authenticated_portal'
  )
  on conflict (onboarding_client_id, task_key)
  do update set
    group_code = excluded.group_code,
    task_text = excluded.task_text,
    is_complete = excluded.is_complete,
    updated_by_source = excluded.updated_by_source,
    updated_at = now();

  return jsonb_build_object(
    'status', 'ok',
    'onboarding_client_id', v_onboarding_client_id,
    'task_key', trim(p_task_key),
    'is_complete', coalesce(p_is_complete, false)
  );
end;
$$;

alter table onboarding.portal_user_profile enable row level security;
alter table onboarding.company_directory enable row level security;

drop policy if exists portal_user_profile_self_select on onboarding.portal_user_profile;
create policy portal_user_profile_self_select
on onboarding.portal_user_profile
for select
using (auth.uid() = auth_user_id or onboarding.is_internal_user());

drop policy if exists portal_user_profile_self_modify on onboarding.portal_user_profile;
create policy portal_user_profile_self_modify
on onboarding.portal_user_profile
for all
using (auth.uid() = auth_user_id or onboarding.is_internal_user())
with check (auth.uid() = auth_user_id or onboarding.is_internal_user());

drop policy if exists company_directory_select_policy on onboarding.company_directory;
create policy company_directory_select_policy
on onboarding.company_directory
for select
using (true);

revoke execute on function onboarding.public_submit_intake(jsonb) from anon;
revoke execute on function onboarding.public_get_onboarding_snapshot(bigint, uuid) from anon;
revoke execute on function onboarding.public_upsert_task_state(bigint, uuid, text, boolean, text, text) from anon;
revoke execute on function onboarding.public_list_task_states(bigint, uuid) from anon;
revoke execute on function public.public_submit_intake(jsonb) from anon;
revoke execute on function public.public_get_onboarding_snapshot(bigint, uuid) from anon;
revoke execute on function public.public_upsert_task_state(bigint, uuid, text, boolean, text, text) from anon;
revoke execute on function public.public_list_task_states(bigint, uuid) from anon;

grant execute on function public.search_companies(text, integer) to anon, authenticated, service_role;
grant execute on function public.complete_portal_signup(text, text, bigint, text) to authenticated, service_role;
grant execute on function public.get_my_portal_context() to authenticated, service_role;
grant execute on function public.list_my_communities() to authenticated, service_role;
grant execute on function public.get_my_latest_submission_payload(bigint) to authenticated, service_role;
grant execute on function public.set_my_active_community(bigint) to authenticated, service_role;
grant execute on function public.submit_my_intake(jsonb) to authenticated, service_role;
grant execute on function public.list_my_task_states() to authenticated, service_role;
grant execute on function public.upsert_my_task_state(text, boolean, text, text) to authenticated, service_role;
grant execute on function public.get_internal_portal_context() to authenticated, service_role;
grant execute on function public.internal_list_onboarding_overview(text, onboarding.onboarding_stage, integer) to authenticated, service_role;
grant execute on function public.create_internal_signup_invite(text, text, text, integer, text) to authenticated, service_role;
grant execute on function public.get_internal_signup_invite(text) to anon, authenticated, service_role;
grant execute on function public.redeem_internal_signup_invite(text, text) to authenticated, service_role;
