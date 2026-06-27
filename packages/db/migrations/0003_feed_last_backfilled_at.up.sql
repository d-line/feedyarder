alter table feeds
  add column if not exists last_backfilled_at timestamptz;
