create extension if not exists vector;

create table if not exists item_similarity_features (
  item_id uuid primary key references items (id) on delete cascade,
  algorithm_version text not null,
  status text not null check (status in ('ready', 'skipped')),
  input_hash text not null check (length(input_hash) = 64),
  plain_text_length integer not null check (plain_text_length >= 0),
  lexical_terms text[] not null default '{}',
  search_document tsvector not null default ''::tsvector,
  embedding halfvec(384),
  skip_reason text,
  generated_at timestamptz not null default now(),
  check (
    (
      status = 'ready'
      and embedding is not null
      and skip_reason is null
    )
    or
    (
      status = 'skipped'
      and embedding is null
      and skip_reason is not null
    )
  )
);

create table if not exists item_similarity_jobs (
  item_id uuid primary key references items (id) on delete cascade,
  target_algorithm_version text not null,
  priority smallint not null default 0,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  lease_token uuid,
  last_error_category text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (lease_expires_at is null and lease_token is null)
    or
    (lease_expires_at is not null and lease_token is not null)
  )
);

alter table item_similarity_jobs
  add column if not exists priority smallint not null default 0;

create index if not exists item_similarity_features_search_idx
  on item_similarity_features using gin (search_document);

create index if not exists item_similarity_features_embedding_idx
  on item_similarity_features using hnsw (embedding halfvec_cosine_ops)
  where status = 'ready';

create index if not exists item_similarity_jobs_claim_idx
  on item_similarity_jobs (
    priority desc,
    available_at,
    created_at,
    item_id
  );

create index if not exists item_similarity_jobs_lease_idx
  on item_similarity_jobs (lease_expires_at)
  where lease_expires_at is not null;

create or replace function enqueue_item_similarity_job()
returns trigger
language plpgsql
as $$
begin
  insert into item_similarity_jobs (
    item_id,
    target_algorithm_version,
    priority
  )
  values (
    new.id,
    'similarity-v1',
    100
  )
  on conflict (item_id) do nothing;

  return new;
end;
$$;

drop trigger if exists items_enqueue_similarity_job on items;

create trigger items_enqueue_similarity_job
after insert on items
for each row
execute function enqueue_item_similarity_job();
