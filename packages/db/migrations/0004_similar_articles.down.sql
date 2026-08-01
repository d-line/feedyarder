drop trigger if exists items_enqueue_similarity_job on items;
drop function if exists enqueue_item_similarity_job();

drop table if exists item_similarity_jobs;
drop table if exists item_similarity_features;

drop extension if exists vector;
