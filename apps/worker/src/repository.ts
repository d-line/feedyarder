import type { Pool } from "pg";

import type {
  DueFeed,
  FetchCycleSummaryItem,
  FetchOutcome,
  NormalizedItem
} from "./fetch/types.js";

interface DueFeedRow {
  id: string;
  feed_url: string;
  title: string | null;
  fetch_interval_minutes: number;
  consecutive_error_count: number;
  etag: string | null;
  last_modified: string | null;
}

export interface FeedBackfillTarget {
  id: string;
  feedUrl: string;
  siteUrl: string | null;
  title: string | null;
}

export interface FolderBackfillTarget {
  feeds: FeedBackfillTarget[];
  id: string;
  title: string;
}

interface FeedBackfillTargetRow {
  id: string;
  feed_url: string;
  site_url: string | null;
  title: string | null;
}

interface FolderBackfillTargetRow {
  id: string;
  title: string;
}

export interface InsertItemResult {
  inserted: boolean;
  item: NormalizedItem;
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

export async function getFeedBackfillTarget(
  pool: Pool,
  feedId: string
): Promise<FeedBackfillTarget | null> {
  const result = await pool.query<FeedBackfillTargetRow>(
    `
      select id, feed_url, site_url, title
      from feeds
      where id = $1
    `,
    [feedId]
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    feedUrl: row.feed_url,
    id: row.id,
    siteUrl: row.site_url,
    title: row.title
  };
}

export async function getFolderBackfillTarget(
  pool: Pool,
  folderReference: string
): Promise<FolderBackfillTarget | null> {
  const folderResult = await pool.query<FolderBackfillTargetRow>(
    `
      select id, title
      from folders
      where id::text = $1 or title = $1
      order by id
    `,
    [folderReference]
  );

  if (folderResult.rows.length === 0) {
    return null;
  }

  if (folderResult.rows.length > 1) {
    throw new Error(
      `Folder title "${folderReference}" is ambiguous. Use a folder id instead.`
    );
  }

  const folder = folderResult.rows[0];

  if (!folder) {
    return null;
  }

  const feedResult = await pool.query<FeedBackfillTargetRow>(
    `
      select id, feed_url, site_url, title
      from feeds
      where folder_id = $1
      order by created_at asc, id asc
    `,
    [folder.id]
  );

  return {
    feeds: feedResult.rows.map(mapFeedBackfillTarget),
    id: folder.id,
    title: folder.title
  };
}

function mapFeedBackfillTarget(row: FeedBackfillTargetRow): FeedBackfillTarget {
  return {
    feedUrl: row.feed_url,
    id: row.id,
    siteUrl: row.site_url,
    title: row.title
  };
}

export async function recordFetchOutcome(
  pool: Pool,
  feed: DueFeed,
  outcome: FetchOutcome
): Promise<void> {
  await pool.query("begin");

  try {
    const insertedItemCount =
      outcome.status === "success"
        ? await insertItems(pool, feed.id, outcome.items)
        : 0;

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
        etag = coalesce($6, etag),
        last_modified = coalesce($7, last_modified),
        title = coalesce($8, title),
        site_url = coalesce($9, site_url),
        favicon_url = coalesce($10, favicon_url),
        status = case
          when $3 = 'error' then 'error'
          when $3 = 'not_modified' then status
          else 'active'
        end,
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
      outcome.errorMessage ?? null,
      outcome.etag,
      outcome.lastModified,
      outcome.feedTitle,
      outcome.siteUrl,
      outcome.faviconUrl
    ]
  );

    await pool.query(
    `
      insert into fetch_events (
        feed_id,
        status,
        error_category,
        error_message,
        http_status,
        missing_published_at_count,
        duration_ms
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      feed.id,
      outcome.status,
      outcome.errorCategory ?? null,
      outcome.errorMessage ?? null,
      outcome.httpStatus,
      outcome.missingPublishedAtCount,
      outcome.durationMs
    ]
  );

    await pool.query("commit");

    console.log(
      `Recorded fetch outcome for ${feed.feedUrl}: status=${outcome.status} inserted=${insertedItemCount}`
    );
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
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

export async function insertItems(
  pool: Pool,
  feedId: string,
  items: NormalizedItem[]
): Promise<number> {
  const results = await insertItemsWithResults(pool, feedId, items);
  return results.filter((result) => result.inserted).length;
}

export async function insertItemsWithResults(
  pool: Pool,
  feedId: string,
  items: NormalizedItem[]
): Promise<InsertItemResult[]> {
  const results: InsertItemResult[] = [];

  for (const item of items) {
    const result = await pool.query(
      `
        insert into items (
          feed_id,
          guid,
          dedupe_key,
          title,
          url,
          author,
          summary_text,
          content_html,
          published_at,
          raw_extension_data
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        on conflict (feed_id, dedupe_key) do nothing
      `,
      [
        feedId,
        item.guid,
        item.dedupeKey,
        item.title,
        item.url,
        item.author,
        item.summaryText,
        item.contentHtml,
        item.publishedAt,
        JSON.stringify(item.rawExtensionData)
      ]
    );

    results.push({
      inserted: (result.rowCount ?? 0) > 0,
      item
    });
  }

  return results;
}
