create index if not exists feeds_title_search_document_idx on feeds using gin (
  to_tsvector('simple', coalesce(title, ''))
);
