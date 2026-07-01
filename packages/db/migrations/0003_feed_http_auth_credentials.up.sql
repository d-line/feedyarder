alter table feeds
  add column if not exists auth_username text,
  add column if not exists auth_password text;
