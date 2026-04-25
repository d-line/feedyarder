create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  session_token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table folders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table feeds (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references folders (id) on delete set null,
  title text,
  site_url text,
  feed_url text not null unique,
  favicon_url text,
  status text not null default 'active',
  is_paused boolean not null default false,
  etag text,
  last_modified text,
  fetch_interval_minutes integer not null default 60,
  next_fetch_at timestamptz,
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_category text,
  last_error_message text,
  consecutive_error_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references feeds (id) on delete cascade,
  guid text,
  dedupe_key text not null,
  title text,
  url text,
  author text,
  summary_text text,
  content_html text,
  published_at timestamptz,
  raw_extension_data jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  is_starred boolean not null default false,
  starred_at timestamptz,
  created_at timestamptz not null default now(),
  unique (feed_id, dedupe_key)
);

create table fetch_events (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references feeds (id) on delete cascade,
  status text not null,
  error_category text,
  error_message text,
  http_status integer,
  missing_published_at_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  duration_ms integer
);

create table notification_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  sent_at timestamptz not null default now()
);

create index feeds_next_fetch_at_idx on feeds (next_fetch_at) where is_paused = false;
create index feeds_folder_id_idx on feeds (folder_id);
create index items_feed_published_idx on items (feed_id, published_at desc, id desc);
create index items_unread_published_idx on items (is_read, published_at desc, id desc);
create index items_starred_published_idx on items (is_starred, published_at desc, id desc);
create index items_published_id_idx on items (published_at desc, id desc);
create index items_search_document_idx on items using gin (
  to_tsvector(
    'simple',
    coalesce(title, '') || ' ' ||
    coalesce(summary_text, '') || ' ' ||
    coalesce(content_html, '') || ' ' ||
    coalesce(author, '')
  )
);
