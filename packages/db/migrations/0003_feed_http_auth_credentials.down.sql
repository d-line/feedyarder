alter table feeds
  drop column if exists auth_password,
  drop column if exists auth_username;
