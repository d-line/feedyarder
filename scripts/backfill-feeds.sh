#!/usr/bin/env bash
set -uo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKFILL_FEEDS_SQL="${BACKFILL_FEEDS_SQL:-"
select id
from feeds
where is_paused = false
  and (
    feed_url ilike '%youtube.com/%'
    or site_url ilike '%youtube.com/%'
    or feed_url ilike '%youtu.be/%'
    or site_url ilike '%youtu.be/%'
    or feed_url ilike '%rutracker.org/%'
    or site_url ilike '%rutracker.org/%'
    or feed_url ilike '%blog.adafruit.com/%'
    or site_url ilike '%blog.adafruit.com/%'
    or feed_url ilike '%learn.adafruit.com/%'
    or site_url ilike '%learn.adafruit.com/%'
    or feed_url ilike '%dou.ua/%'
    or site_url ilike '%dou.ua/%'
  )
order by created_at asc, id asc
"}"

failures=0
processed=0
ids_file="$(mktemp)"

cleanup() {
  rm -f "$ids_file"
}
trap cleanup EXIT

if ! psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -o "$ids_file" -c "$BACKFILL_FEEDS_SQL"; then
  echo "Failed to query feed ids." >&2
  exit 1
fi

while IFS= read -r feed_id; do
  if [[ -z "$feed_id" ]]; then
    continue
  fi

  processed=$((processed + 1))
  echo "Backfill feed ${processed}: ${feed_id}"

  if npm run backfill -- "$feed_id"; then
    echo "Backfill feed ${feed_id}: ok"
  else
    failures=$((failures + 1))
    echo "Backfill feed ${feed_id}: failed" >&2
  fi
done < "$ids_file"

if [[ "$failures" -gt 0 ]]; then
  echo "Backfill finished with ${failures} failed feed(s)." >&2
  exit 1
fi

echo "Backfill finished."
