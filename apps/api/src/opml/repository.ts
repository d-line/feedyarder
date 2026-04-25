import type { Pool, PoolClient } from "pg";

interface FolderLookupRow {
  id: string;
}

interface FeedExportRow {
  id: string;
  folder_title: string | null;
  title: string | null;
  site_url: string | null;
  feed_url: string;
  is_paused: boolean;
}

export interface ImportedFeedInput {
  feedUrl: string;
  folderTitle: string | null;
  siteUrl: string | null;
  title: string | null;
}

export interface OpmlImportResult {
  createdFeedCount: number;
  createdFolderCount: number;
  skippedFeedCount: number;
}

export interface ExportableFeed {
  folderTitle: string | null;
  feedUrl: string;
  isPaused: boolean;
  siteUrl: string | null;
  title: string | null;
}

export async function importFeedsFromOpml(
  pool: Pool,
  feeds: ImportedFeedInput[]
): Promise<OpmlImportResult> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    let createdFeedCount = 0;
    let createdFolderCount = 0;
    let skippedFeedCount = 0;
    const folderCache = new Map<string, string>();

    for (const feed of feeds) {
      let folderId: string | null = null;

      if (feed.folderTitle) {
        const folderResult = await ensureFolder(client, folderCache, feed.folderTitle);
        folderId = folderResult.id;

        if (folderResult.created) {
          createdFolderCount += 1;
        }
      }

      const created = await insertFeed(client, {
        feedUrl: feed.feedUrl,
        folderId,
        siteUrl: feed.siteUrl,
        title: feed.title
      });

      if (created) {
        createdFeedCount += 1;
      } else {
        skippedFeedCount += 1;
      }
    }

    await client.query("commit");

    return {
      createdFeedCount,
      createdFolderCount,
      skippedFeedCount
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listFeedsForOpmlExport(pool: Pool): Promise<ExportableFeed[]> {
  const result = await pool.query<FeedExportRow>(
    `
      select
        feeds.id,
        folders.title as folder_title,
        feeds.title,
        feeds.site_url,
        feeds.feed_url,
        feeds.is_paused
      from feeds
      left join folders on folders.id = feeds.folder_id
      order by folders.position asc nulls first, folders.created_at asc nulls first, feeds.created_at asc, feeds.id asc
    `
  );

  return result.rows.map((row) => ({
    feedUrl: row.feed_url,
    folderTitle: row.folder_title,
    isPaused: row.is_paused,
    siteUrl: row.site_url,
    title: row.title
  }));
}

async function ensureFolder(
  client: PoolClient,
  folderCache: Map<string, string>,
  title: string
): Promise<{ created: boolean; id: string }> {
  const cached = folderCache.get(title);

  if (cached) {
    return {
      created: false,
      id: cached
    };
  }

  const existing = await client.query<FolderLookupRow>(
    `
      select id
      from folders
      where title = $1
      limit 1
    `,
    [title]
  );

  const existingId = existing.rows[0]?.id;

  if (existingId) {
    folderCache.set(title, existingId);
    return {
      created: false,
      id: existingId
    };
  }

  const inserted = await client.query<FolderLookupRow>(
    `
      insert into folders (title, position)
      values (
        $1,
        coalesce((select max(position) + 1 from folders), 0)
      )
      returning id
    `,
    [title]
  );

  const insertedId = inserted.rows[0]?.id;

  if (!insertedId) {
    throw new Error("Folder import returned no row.");
  }

  folderCache.set(title, insertedId);
  return {
    created: true,
    id: insertedId
  };
}

async function insertFeed(
  client: PoolClient,
  input: {
    feedUrl: string;
    folderId: string | null;
    siteUrl: string | null;
    title: string | null;
  }
): Promise<boolean> {
  const result = await client.query(
    `
      insert into feeds (
        folder_id,
        title,
        site_url,
        feed_url,
        next_fetch_at
      )
      values ($1, $2, $3, $4, now())
      on conflict (feed_url) do nothing
    `,
    [input.folderId, input.title, input.siteUrl, input.feedUrl]
  );

  return (result.rowCount ?? 0) > 0;
}
