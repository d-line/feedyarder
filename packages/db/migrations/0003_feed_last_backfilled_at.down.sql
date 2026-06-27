alter table feeds
  drop column if exists last_backfilled_at;
