-- SPDX-License-Identifier: AGPL-3.0-only
-- Cumulus DB hosted PostgreSQL data schema contract.
-- This schema stores runtime workspace state for the Postgres engine.

create schema if not exists cumulus_data;

create table if not exists cumulus_data.schema_migrations (
  version        text primary key,
  applied_at     timestamptz not null default now()
);

create table if not exists cumulus_data.manifests (
  db_id          text primary key,
  manifest_json  jsonb not null,
  created_at     timestamptz not null,
  updated_at     timestamptz not null
);

create table if not exists cumulus_data.tokens (
  db_id           text not null references cumulus_data.manifests(db_id) on delete cascade,
  token_id        text not null,
  token_public_id text,
  secret_mac      text,
  token_json      jsonb not null,
  created_at      timestamptz not null,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  primary key (db_id, token_id),
  unique (token_public_id)
);

create table if not exists cumulus_data.records (
  db_id        text not null references cumulus_data.manifests(db_id) on delete cascade,
  record_id    text not null,
  record_type  text not null,
  record_key   text,
  record_json  jsonb not null,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  primary key (db_id, record_id)
);

create table if not exists cumulus_data.wal_entries (
  id            bigserial primary key,
  db_id         text not null references cumulus_data.manifests(db_id) on delete cascade,
  operation     text not null check (operation in ('record_upsert','record_delete','compact')),
  record_id     text,
  entry_json    jsonb not null,
  created_at    timestamptz not null
);

create table if not exists cumulus_data.audit_logs (
  id          bigserial primary key,
  db_id       text not null references cumulus_data.manifests(db_id) on delete cascade,
  event_json  jsonb not null,
  created_at  timestamptz not null
);

create table if not exists cumulus_data.system_state (
  db_id       text primary key references cumulus_data.manifests(db_id) on delete cascade,
  state_json  jsonb not null,
  updated_at  timestamptz not null
);

create table if not exists cumulus_data.snapshots (
  db_id           text not null references cumulus_data.manifests(db_id) on delete cascade,
  snapshot_id     text not null,
  snapshot_kind   text not null,
  snapshot_json   jsonb not null,
  ciphertext      text,
  metadata_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null,
  primary key (db_id, snapshot_id)
);

create index if not exists manifests_updated_idx on cumulus_data.manifests (updated_at desc);
create index if not exists tokens_db_created_idx on cumulus_data.tokens (db_id, created_at desc);
create index if not exists records_db_updated_idx on cumulus_data.records (db_id, updated_at desc);
create index if not exists records_db_type_key_idx on cumulus_data.records (db_id, record_type, record_key);
create index if not exists wal_entries_db_id_idx on cumulus_data.wal_entries (db_id, id);
create index if not exists audit_logs_db_created_idx on cumulus_data.audit_logs (db_id, created_at desc, id desc);
create index if not exists snapshots_db_created_idx on cumulus_data.snapshots (db_id, created_at desc);
