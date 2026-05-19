-- SPDX-License-Identifier: AGPL-3.0-only
-- Cumulus DB hosted PostgreSQL system schema contract.
-- This is the hosted control-plane reliability target. The local JSONL engine
-- remains the reference engine for development and deterministic tests.

create schema if not exists cumulus_system;
create extension if not exists citext;

create table if not exists cumulus_system.orgs (
  id                uuid primary key,
  slug              text not null unique,
  name              text not null,
  status            text not null check (status in ('active','suspended','pending_claim')),
  created_at        timestamptz not null default now(),
  created_by_type   text not null check (created_by_type in ('human','agent','system')),
  created_by_id     uuid,
  claimed_at        timestamptz,
  metadata_json     jsonb not null default '{}'::jsonb
);

create table if not exists cumulus_system.identities (
  id                uuid primary key,
  email             citext unique,
  email_verified_at timestamptz,
  status            text not null check (status in ('active','disabled','pending')),
  created_at        timestamptz not null default now()
);

create table if not exists cumulus_system.human_accounts (
  id                uuid primary key,
  identity_id       uuid not null references cumulus_system.identities(id),
  display_name      text,
  passkey_required  boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists cumulus_system.agent_accounts (
  id                uuid primary key,
  org_id            uuid not null references cumulus_system.orgs(id),
  display_name      text not null,
  status            text not null check (status in ('active','disabled','pending_claim')),
  bootstrap_mode    text not null check (bootstrap_mode in ('local_secret')),
  public_key_jwk    jsonb,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz
);

create table if not exists cumulus_system.org_memberships (
  id                uuid primary key,
  org_id            uuid not null references cumulus_system.orgs(id),
  principal_type    text not null check (principal_type in ('human','agent','app','system')),
  principal_id      uuid not null,
  role              text not null,
  grants_json       jsonb not null default '[]'::jsonb,
  status            text not null check (status in ('active','invited','disabled')),
  created_at        timestamptz not null default now(),
  unique (org_id, principal_type, principal_id)
);

create table if not exists cumulus_system.tokens (
  id                uuid primary key,
  org_id            uuid not null references cumulus_system.orgs(id),
  principal_type    text not null check (principal_type in ('human','agent','app','system')),
  principal_id      uuid,
  token_kind        text not null check (token_kind in ('data','admin','agent','pat','session','approval','exchange')),
  token_public_id   text not null unique,
  secret_mac        bytea not null,
  scopes_json       jsonb not null default '[]'::jsonb,
  status            text not null check (status in ('active','revoked','expired')),
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  rotated_from_id   uuid references cumulus_system.tokens(id)
);

create table if not exists cumulus_system.audit_logs (
  id                uuid primary key,
  org_id            uuid references cumulus_system.orgs(id),
  actor_type        text not null,
  actor_id          uuid,
  action            text not null,
  target_type       text not null,
  target_id         text,
  request_id        text not null,
  ip_hash           bytea,
  user_agent_hash   bytea,
  metadata_json     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create table if not exists cumulus_system.schema_versions (
  id                   uuid primary key,
  org_id               uuid not null references cumulus_system.orgs(id),
  app_id               uuid,
  desired_hash         text not null,
  last_applied_hash    text,
  live_hash            text,
  canonical_json       jsonb not null,
  plan_json            jsonb,
  risk_level           text not null check (risk_level in ('none','low','medium','high','destructive')),
  apply_status         text not null check (apply_status in ('planned','applied','failed','reverted')),
  created_at           timestamptz not null default now(),
  applied_at           timestamptz
);

create table if not exists cumulus_system.snapshots (
  id                   uuid primary key,
  org_id               uuid not null references cumulus_system.orgs(id),
  app_id               uuid,
  snapshot_kind        text not null check (snapshot_kind in ('pre_apply','scheduled','manual','revert_point')),
  storage_uri          text not null,
  wrapped_dek          bytea,
  ciphertext_sha256    text not null,
  metadata_aad_json    jsonb not null,
  created_at           timestamptz not null default now(),
  created_by_type      text not null,
  created_by_id        uuid
);

create table if not exists cumulus_system.approvals (
  id                   uuid primary key,
  org_id               uuid not null references cumulus_system.orgs(id),
  plan_id              uuid,
  plan_hash            text not null,
  scope                text not null,
  token_mac            bytea not null,
  status               text not null check (status in ('active','used','expired','revoked')),
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  used_at              timestamptz,
  actor_type           text not null,
  actor_id             uuid
);

create table if not exists cumulus_system.revert_runs (
  id                   uuid primary key,
  org_id               uuid not null references cumulus_system.orgs(id),
  target_version_id    uuid,
  target_snapshot_id   uuid,
  status               text not null check (status in ('planned','applied','failed')),
  metadata_json        jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  applied_at           timestamptz
);

create index if not exists audit_logs_org_created_idx on cumulus_system.audit_logs (org_id, created_at desc);
create index if not exists schema_versions_org_created_idx on cumulus_system.schema_versions (org_id, created_at desc);
create index if not exists snapshots_org_created_idx on cumulus_system.snapshots (org_id, created_at desc);
create index if not exists approvals_org_status_idx on cumulus_system.approvals (org_id, status, expires_at);
