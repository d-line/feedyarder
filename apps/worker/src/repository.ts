import type { Pool } from "pg";

import type { DueFeed, FetchCycleSummaryItem, FetchOutcome } from "./fetch/types.js";

interface DueFeedRow {
  id: string;
  feed_url: string;
  title: string | null;
  fetch_interval_minutes: number;
  consecutive_error_count: number;
  etag: string | null;
  last_modified: string | null;
}

export async function listDueFeeds(pool: Pool, limit: number): Promise<DueFeed[]> {
  const result = await pool.query<DueFeedRow>(
    `
      select
        id,
        feed_url,
        title,
        fetch_interval_minutes,
        consecutive_error_count,
        etag,
        last_modified
      from feeds
      where is_paused = false
        and coalesce(next_fetch_at, now()) <= now()
      order by coalesce(next_fetch_at, now()) asc, id asc
      limit $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    feedUrl: row.feed_url,
    title: row.title,
    fetchIntervalMinutes: row.fetch_interval_minutes,
    consecutiveErrorCount: row.consecutive_error_count,
    etag: row.etag,
    lastModified: row.last_modified
  }));
}

export async function recordFetchOutcome(
  pool: Pool,
  feed: DueFeed,
  outcome: FetchOutcome
): Promise<void> {
  await pool.query(
    `
      update feeds
      set
        fetch_interval_minutes = $2,
        next_fetch_at = now() + make_interval(mins => $2),
        last_fetched_at = now(),
        last_success_at = case when $3 <> 'error' then now() else last_success_at end,
        last_error_at = case when $3 = 'error' then now() else last_error_at end,
        last_error_category = case when $3 = 'error' then $4 else null end,
        last_error_message = case when $3 = 'error' then $5 else null end,
        consecutive_error_count = case
          when $3 = 'error' then consecutive_error_count + 1
          else 0
        end,
        updated_at = now()
      where id = $1
    `,
    [
      feed.id,
      outcome.nextFetchIntervalMinutes,
      outcome.status,
      outcome.errorCategory ?? null,
      outcome.errorMessage ?? null
    ]
  );

  await pool.query(
    `
      insert into fetch_events (
        feed_id,
        status,
        error_category,
        error_message,
        missing_published_at_count
      )
      values ($1, $2, $3, $4, $5)
    `,
    [
      feed.id,
      outcome.status,
      outcome.errorCategory ?? null,
      outcome.errorMessage ?? null,
      outcome.missingPublishedAtCount
    ]
  );
}

export async function recordNotificationBatch(
  pool: Pool,
  kind: string,
  payload: FetchCycleSummaryItem[]
): Promise<void> {
  await pool.query(
    `
      insert into notification_batches (kind, payload)
      values ($1, $2::jsonb)
    `,
    [kind, JSON.stringify(payload)]
  );
}
