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
  createdAt: string;
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
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    siteUrl: row.site_url,
    status: row.status,
    title: row.title
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
