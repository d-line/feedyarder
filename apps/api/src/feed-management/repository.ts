import type { Pool } from "pg";

export interface FolderRecord {
  id: string;
  title: string;
  position: number;
  created_at: Date;
}

export interface FolderResponse {
  id: string;
  title: string;
  position: number;
  createdAt: string;
}

export interface FeedRecord {
  id: string;
  folder_id: string | null;
  title: string | null;
  site_url: string | null;
  feed_url: string;
  favicon_url: string | null;
  status: string;
  is_paused: boolean;
  fetch_interval_minutes: number;
  consecutive_error_count: number;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error_category: string | null;
  last_error_message: string | null;
  created_at: Date;
}

export interface FeedResponse {
  id: string;
  folderId: string | null;
  title: string | null;
  siteUrl: string | null;
  feedUrl: string;
  faviconUrl: string | null;
  status: string;
  isPaused: boolean;
  fetchIntervalMinutes: number;
  consecutiveErrorCount: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCategory: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

export interface FetchEventRecord {
  id: string;
  feed_id: string;
  feed_title: string | null;
  feed_url: string;
  status: string;
  error_category: string | null;
  error_message: string | null;
  http_status: number | null;
  missing_published_at_count: number;
  fetched_at: Date;
  duration_ms: number | null;
}

export interface FetchEventResponse {
  id: string;
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  status: string;
  errorCategory: string | null;
  errorMessage: string | null;
  httpStatus: number | null;
  missingPublishedAtCount: number;
  fetchedAt: string;
  durationMs: number | null;
}

function mapFolder(row: FolderRecord): FolderResponse {
  return {
    createdAt: row.created_at.toISOString(),
    id: row.id,
    position: row.position,
    title: row.title
  };
}

function mapFeed(row: FeedRecord): FeedResponse {
  return {
    consecutiveErrorCount: row.consecutive_error_count,
    createdAt: row.created_at.toISOString(),
    faviconUrl: row.favicon_url,
    feedUrl: row.feed_url,
    fetchIntervalMinutes: row.fetch_interval_minutes,
    folderId: row.folder_id,
    id: row.id,
    isPaused: row.is_paused,
    lastErrorAt: row.last_error_at?.toISOString() ?? null,
    lastErrorCategory: row.last_error_category,
    lastErrorMessage: row.last_error_message,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    siteUrl: row.site_url,
    status: row.status,
    title: row.title
  };
}

function mapFetchEvent(row: FetchEventRecord): FetchEventResponse {
  return {
    durationMs: row.duration_ms,
    errorCategory: row.error_category,
    errorMessage: row.error_message,
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    feedUrl: row.feed_url,
    fetchedAt: row.fetched_at.toISOString(),
    httpStatus: row.http_status,
    id: row.id,
    missingPublishedAtCount: row.missing_published_at_count,
    status: row.status
  };
}

export async function listFolders(pool: Pool): Promise<FolderResponse[]> {
  const result = await pool.query<FolderRecord>(
    `
      select id, title, position, created_at
      from folders
      order by position asc, created_at asc
    `
  );

  return result.rows.map(mapFolder);
}

export async function createFolder(
  pool: Pool,
  input: { position: number; title: string }
): Promise<FolderResponse> {
  const result = await pool.query<FolderRecord>(
    `
      insert into folders (title, position)
      values ($1, $2)
      returning id, title, position, created_at
    `,
    [input.title, input.position]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Folder creation returned no row");
  }

  return mapFolder(row);
}

export async function listFeeds(pool: Pool): Promise<FeedResponse[]> {
  const result = await pool.query<FeedRecord>(
    `
      select
        id,
        folder_id,
        title,
        site_url,
        feed_url,
        favicon_url,
        status,
        is_paused,
        fetch_interval_minutes,
        consecutive_error_count,
        last_success_at,
        last_error_at,
        last_error_category,
        last_error_message,
        created_at
      from feeds
      order by created_at asc, id asc
    `
  );

  return result.rows.map(mapFeed);
}

export async function createFeed(
  pool: Pool,
  input: {
    feedUrl: string;
    folderId: string | null;
    siteUrl: string | null;
    title: string | null;
  }
): Promise<FeedResponse> {
  const result = await pool.query<FeedRecord>(
    `
      insert into feeds (
        folder_id,
        title,
        site_url,
        feed_url,
        next_fetch_at
      )
      values ($1, $2, $3, $4, now())
      returning
        id,
        folder_id,
        title,
        site_url,
        feed_url,
        favicon_url,
        status,
        is_paused,
        fetch_interval_minutes,
        consecutive_error_count,
        last_success_at,
        last_error_at,
        last_error_category,
        last_error_message,
        created_at
    `,
    [input.folderId, input.title, input.siteUrl, input.feedUrl]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Feed creation returned no row");
  }

  return mapFeed(row);
}

export async function updateFeed(
  pool: Pool,
  feedId: string,
  input: {
    feedUrl?: string;
    folderId?: string | null;
    isPaused?: boolean;
    siteUrl?: string | null;
    title?: string | null;
  }
): Promise<FeedResponse | null> {
  const result = await pool.query<FeedRecord>(
    `
      update feeds
      set
        folder_id = case when $2 then $3 else folder_id end,
        title = case when $4 then $5 else title end,
        site_url = case when $6 then $7 else site_url end,
        feed_url = case when $8 then $9 else feed_url end,
        is_paused = case when $10 then $11 else is_paused end,
        updated_at = now()
      where id = $1
      returning
        id,
        folder_id,
        title,
        site_url,
        feed_url,
        favicon_url,
        status,
        is_paused,
        fetch_interval_minutes,
        consecutive_error_count,
        last_success_at,
        last_error_at,
        last_error_category,
        last_error_message,
        created_at
    `,
    [
      feedId,
      input.folderId !== undefined,
      input.folderId ?? null,
      input.title !== undefined,
      input.title ?? null,
      input.siteUrl !== undefined,
      input.siteUrl ?? null,
      input.feedUrl !== undefined,
      input.feedUrl ?? null,
      input.isPaused !== undefined,
      input.isPaused ?? null
    ]
  );

  const row = result.rows[0];
  return row ? mapFeed(row) : null;
}

export async function deleteFeed(pool: Pool, feedId: string): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    `
      delete from feeds
      where id = $1
      returning id
    `,
    [feedId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function retryFeedNow(pool: Pool, feedId: string): Promise<FeedResponse | null> {
  const result = await pool.query<FeedRecord>(
    `
      update feeds
      set
        is_paused = false,
        next_fetch_at = now(),
        updated_at = now()
      where id = $1
      returning
        id,
        folder_id,
        title,
        site_url,
        feed_url,
        favicon_url,
        status,
        is_paused,
        fetch_interval_minutes,
        consecutive_error_count,
        last_success_at,
        last_error_at,
        last_error_category,
        last_error_message,
        created_at
    `,
    [feedId]
  );

  const row = result.rows[0];
  return row ? mapFeed(row) : null;
}

export async function listFetchEvents(
  pool: Pool,
  input: { feedId: string | null; limit: number }
): Promise<FetchEventResponse[]> {
  const values: Array<number | string> = [];
  const whereParts: string[] = [];

  if (input.feedId) {
    values.push(input.feedId);
    whereParts.push(`fetch_events.feed_id = $${values.length}`);
  }

  values.push(input.limit);
  const limitIndex = values.length;
  const whereClause = whereParts.length > 0 ? `where ${whereParts.join(" and ")}` : "";

  const result = await pool.query<FetchEventRecord>(
    `
      select
        fetch_events.id,
        fetch_events.feed_id,
        feeds.title as feed_title,
        feeds.feed_url,
        fetch_events.status,
        fetch_events.error_category,
        fetch_events.error_message,
        fetch_events.http_status,
        fetch_events.missing_published_at_count,
        fetch_events.fetched_at,
        fetch_events.duration_ms
      from fetch_events
      join feeds on feeds.id = fetch_events.feed_id
      ${whereClause}
      order by fetch_events.fetched_at desc, fetch_events.id desc
      limit $${limitIndex}
    `,
    values
  );

  return result.rows.map(mapFetchEvent);
}
