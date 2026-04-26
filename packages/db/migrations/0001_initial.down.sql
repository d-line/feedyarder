drop index if exists items_search_document_idx;
drop index if exists items_published_id_idx;
drop index if exists items_starred_published_idx;
drop index if exists items_unread_published_idx;
drop index if exists items_feed_published_idx;
drop index if exists feeds_folder_id_idx;
drop index if exists feeds_next_fetch_at_idx;

drop table if exists notification_batches;
drop table if exists fetch_events;
drop table if exists items;
drop table if exists feeds;
drop table if exists folders;
drop table if exists sessions;
drop table if exists users;
