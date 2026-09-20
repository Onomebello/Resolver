create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  github_user_id bigint unique not null,
  github_login text not null,
  created_at timestamptz not null default now()
);

create table if not exists anthropic_keys (
  user_id uuid primary key references users(id) on delete cascade,
  encrypted_key bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  updated_at timestamptz not null default now()
);

create table if not exists installations (
  id bigint primary key,
  user_id uuid not null references users(id) on delete cascade,
  account_login text not null,
  created_at timestamptz not null default now()
);

create index if not exists installations_user_id_idx on installations(user_id);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  installation_id bigint not null references installations(id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  issue_number int not null,
  status text not null default 'queued',
  pr_url text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint runs_status_check check (status in ('queued', 'running', 'succeeded', 'failed'))
);

create index if not exists runs_installation_id_idx on runs(installation_id);
