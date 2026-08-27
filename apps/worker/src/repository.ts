import type { Pool } from "pg";

import type { DueFeed, FetchOutcome, NormalizedItem } from "./fetch/types.js";

interface DueFeedRow {
  id: string;
  feed_url: string;
  title: string | null;
  status: string;
  fetch_interval_minutes: number;
  consecutive_error_count: number;
  last_error_category: string | null;
  last_error_message: string | null;
  etag: string | null;
  last_modified: string | null;
  auth_username: string | null;
  auth_password: string | null;
}

export interface TelegramDailyDigest {
  activeFeedCount: number;
  checkedFeedCount: number;
  currentlyFailingFeedCount: number;
  currentlyFailingNetworkCount: number;
  currentlyFailingParseCount: number;
  errorEventCount: number;
  fetchEventCount: number;
  longestFailingFeeds: TelegramDigestFeedSummary[];
  missingPublishedAtCount: number;
  newlyFailingFeeds: TelegramDigestFeedSummary[];
  pausedFeedCount: number;
  recoveredFeedCount: number;
  recoveredFeeds: TelegramDigestRecoveredFeed[];
  since: Date;
  topErrorMessages: TelegramDigestErrorSummary[];
  totalFeedCount: number;
}

export interface TelegramDigestErrorSummary {
  count: number;
  errorCategory: string | null;
  errorMessage: string | null;
}

export interface TelegramDigestFeedSummary {
  consecutiveErrorCount: number;
  errorCategory: string | null;
  errorMessage: string | null;
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
}

export interface TelegramDigestRecoveredFeed {
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  lastSuccessAt: Date | null;
}

export async function listDueFeeds(pool: Pool, limit: number): Promise<DueFeed[]> {
  const result = await pool.query<DueFeedRow>(
    `
      select
        id,
        feed_url,
        title,
        status,
        fetch_interval_minutes,
        consecutive_error_count,
        last_error_category,
        last_error_message,
        etag,
        last_modified,
        auth_username,
        auth_password
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
    status: row.status,
    fetchIntervalMinutes: row.fetch_interval_minutes,
    consecutiveErrorCount: row.consecutive_error_count,
    lastErrorCategory:
      row.last_error_category === "network" || row.last_error_category === "parse"
        ? row.last_error_category
        : null,
    lastErrorMessage: row.last_error_message,
    etag: row.etag,
    lastModified: row.last_modified,
    authUsername: row.auth_username,
    authPassword: row.auth_password
  }));
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
          title = coalesce(title, $8),
          site_url = coalesce($9, site_url),
          favicon_url = coalesce($10, favicon_url),
          status = case
            when $3 = 'error' then 'error'
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
  payload: unknown
): Promise<void> {
  await pool.query(
    `
      insert into notification_batches (kind, payload)
      values ($1, $2::jsonb)
    `,
    [kind, JSON.stringify(payload)]
  );
}

export async function readLastNotificationBatchSentAt(
  pool: Pool,
  kind: string
): Promise<Date | null> {
  const result = await pool.query<{ sent_at: Date }>(
    `
      select sent_at
      from notification_batches
      where kind = $1
      order by sent_at desc
      limit 1
    `,
    [kind]
  );

  return result.rows[0]?.sent_at ?? null;
}

export async function readTelegramDailyDigest(
  pool: Pool,
  since: Date
): Promise<TelegramDailyDigest> {
  const [
    feedCountsResult,
    eventCountsResult,
    topErrorMessagesResult,
    longestFailingFeedsResult,
    newlyFailingFeedsResult,
    recoveredFeedsResult
  ] = await Promise.all([
    pool.query<{
      active_feed_count: number;
      currently_failing_feed_count: number;
      currently_failing_network_count: number;
      currently_failing_parse_count: number;
      paused_feed_count: number;
      total_feed_count: number;
    }>(
      `
        select
          count(*)::integer as total_feed_count,
          count(*) filter (where is_paused = false)::integer as active_feed_count,
          count(*) filter (where is_paused = true)::integer as paused_feed_count,
          count(*) filter (where status = 'error')::integer as currently_failing_feed_count,
          count(*) filter (
            where status = 'error' and last_error_category = 'network'
          )::integer as currently_failing_network_count,
          count(*) filter (
            where status = 'error' and last_error_category = 'parse'
          )::integer as currently_failing_parse_count
        from feeds
      `
    ),
    pool.query<{
      checked_feed_count: number;
      error_event_count: number;
      fetch_event_count: number;
      missing_published_at_count: number;
    }>(
      `
        select
          count(*)::integer as fetch_event_count,
          count(distinct feed_id)::integer as checked_feed_count,
          count(*) filter (where status = 'error')::integer as error_event_count,
          coalesce(sum(missing_published_at_count), 0)::integer as missing_published_at_count
        from fetch_events
        where fetched_at >= $1
      `,
      [since]
    ),
    pool.query<{
      count: number;
      error_category: string | null;
      error_message: string | null;
    }>(
      `
        select
          error_category,
          nullif(error_message, '') as error_message,
          count(*)::integer as count
        from fetch_events
        where fetched_at >= $1
          and status = 'error'
        group by error_category, nullif(error_message, '')
        order by count(*) desc, error_category asc nulls last, error_message asc nulls last
        limit 5
      `,
      [since]
    ),
    pool.query<TelegramDigestFeedRow>(
      `
        select
          id as feed_id,
          title as feed_title,
          feed_url,
          last_error_category as error_category,
          last_error_message as error_message,
          consecutive_error_count,
          last_error_at,
          last_success_at
        from feeds
        where status = 'error'
        order by consecutive_error_count desc, last_error_at asc nulls last, id asc
        limit 10
      `
    ),
    pool.query<TelegramDigestFeedRow>(
      `
        select
          id as feed_id,
          title as feed_title,
          feed_url,
          last_error_category as error_category,
          last_error_message as error_message,
          consecutive_error_count,
          last_error_at,
          last_success_at
        from feeds
        where status = 'error'
          and last_error_at >= $1
          and consecutive_error_count <= 3
        order by last_error_at desc nulls last, id asc
        limit 10
      `,
      [since]
    ),
    pool.query<{
      feed_id: string;
      feed_title: string | null;
      feed_url: string;
      last_success_at: Date | null;
    }>(
      `
        select
          id as feed_id,
          title as feed_title,
          feed_url,
          last_success_at
        from feeds
        where status <> 'error'
          and last_success_at >= $1
          and last_error_at is not null
          and last_success_at > last_error_at
        order by last_success_at desc nulls last, id asc
        limit 10
      `,
      [since]
    )
  ]);

  const feedCounts = feedCountsResult.rows[0];
  const eventCounts = eventCountsResult.rows[0];

  return {
    activeFeedCount: feedCounts?.active_feed_count ?? 0,
    checkedFeedCount: eventCounts?.checked_feed_count ?? 0,
    currentlyFailingFeedCount: feedCounts?.currently_failing_feed_count ?? 0,
    currentlyFailingNetworkCount: feedCounts?.currently_failing_network_count ?? 0,
    currentlyFailingParseCount: feedCounts?.currently_failing_parse_count ?? 0,
    errorEventCount: eventCounts?.error_event_count ?? 0,
    fetchEventCount: eventCounts?.fetch_event_count ?? 0,
    longestFailingFeeds: longestFailingFeedsResult.rows.map(mapTelegramDigestFeed),
    missingPublishedAtCount: eventCounts?.missing_published_at_count ?? 0,
    newlyFailingFeeds: newlyFailingFeedsResult.rows.map(mapTelegramDigestFeed),
    pausedFeedCount: feedCounts?.paused_feed_count ?? 0,
    recoveredFeedCount: recoveredFeedsResult.rowCount ?? 0,
    recoveredFeeds: recoveredFeedsResult.rows.map((row) => ({
      feedId: row.feed_id,
      feedTitle: row.feed_title,
      feedUrl: row.feed_url,
      lastSuccessAt: row.last_success_at
    })),
    since,
    topErrorMessages: topErrorMessagesResult.rows.map((row) => ({
      count: row.count,
      errorCategory: row.error_category,
      errorMessage: row.error_message
    })),
    totalFeedCount: feedCounts?.total_feed_count ?? 0
  };
}

interface TelegramDigestFeedRow {
  consecutive_error_count: number;
  error_category: string | null;
  error_message: string | null;
  feed_id: string;
  feed_title: string | null;
  feed_url: string;
  last_error_at: Date | null;
  last_success_at: Date | null;
}

function mapTelegramDigestFeed(row: TelegramDigestFeedRow): TelegramDigestFeedSummary {
  return {
    consecutiveErrorCount: row.consecutive_error_count,
    errorCategory: row.error_category,
    errorMessage: row.error_message,
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    feedUrl: row.feed_url,
    lastErrorAt: row.last_error_at,
    lastSuccessAt: row.last_success_at
  };
}

async function insertItems(
  pool: Pool,
  feedId: string,
  items: NormalizedItem[]
): Promise<number> {
  let insertedCount = 0;

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

    insertedCount += result.rowCount ?? 0;
  }

  return insertedCount;
}
