import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ParseError } from "./fetch/errors.js";
import type { WorkerConfig } from "./config.js";

const { fetchFeedDocumentMock, parseFeedDocumentMock } = vi.hoisted(() => ({
  fetchFeedDocumentMock: vi.fn(),
  parseFeedDocumentMock: vi.fn()
}));

vi.mock("./fetch/http.js", () => ({
  fetchFeedDocument: fetchFeedDocumentMock
}));

vi.mock("./fetch/normalize.js", () => ({
  parseFeedDocument: parseFeedDocumentMock
}));

import { runWorkerCycle } from "./runner.js";

interface FeedStateRow {
  id: string;
  title: string | null;
  site_url: string | null;
  favicon_url: string | null;
  status: string;
  fetch_interval_minutes: number;
  consecutive_error_count: number;
  etag: string | null;
  last_modified: string | null;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error_category: string | null;
  last_error_message: string | null;
  last_fetched_at: Date | null;
}

interface FetchEventRow {
  feed_id: string;
  status: string;
  error_category: string | null;
  error_message: string | null;
  missing_published_at_count: number;
}

interface NotificationBatchRow {
  kind: string;
  payload: unknown;
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRootEnvPath = path.resolve(currentDirPath, "../../../.env");
const migrationsDirPath = path.resolve(currentDirPath, "../../../packages/db/migrations");

loadEnvFile({
  path: repoRootEnvPath
});

const sourceDatabaseUrl = process.env.DATABASE_URL;

if (!sourceDatabaseUrl) {
  throw new Error("DATABASE_URL is required for worker integration tests.");
}

const sourceUrl = new URL(sourceDatabaseUrl);
const sourceDbName = sourceUrl.pathname.replace("/", "");

if (!sourceDbName) {
  throw new Error("DATABASE_URL must include a database name.");
}

const testDbName = `${sourceDbName}_worker_it`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${testDbName}`;

const workerConfig: WorkerConfig = {
  DATABASE_URL: testUrl.toString(),
  FETCH_CONNECT_TIMEOUT_MS: 10_000,
  FETCH_TOTAL_TIMEOUT_MS: 60_000,
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  WORKER_BATCH_SIZE: 10,
  WORKER_CONCURRENCY: 2,
  WORKER_POLL_INTERVAL_MS: 60_000
};

let adminPool: Pool | null = null;
let testPool: Pool | null = null;

beforeAll(async () => {
  adminPool = new Pool({
    connectionString: adminUrl.toString()
  });

  await ensureDatabaseExists(adminPool, testDbName);

  testPool = new Pool({
    connectionString: workerConfig.DATABASE_URL
  });

  await applyAllUpMigrations(testPool);
});

afterAll(async () => {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }

  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
});

beforeEach(async () => {
  fetchFeedDocumentMock.mockReset();
  parseFeedDocumentMock.mockReset();

  const pool = requireTestPool();
  await pool.query(`
    truncate table
      items,
      fetch_events,
      notification_batches,
      feeds,
      folders,
      sessions,
      users
    restart identity cascade
  `);
});

describe("runWorkerCycle integration", () => {
  it("persists feed state, fetch events, items, and notification batches for a mixed cycle", async () => {
    const pool = requireTestPool();

    const successFeed = await insertFeedForTest(pool, {
      consecutiveErrorCount: 0,
      etag: "etag-old-success",
      feedUrl: "https://example.com/feed-success.xml",
      fetchIntervalMinutes: 120,
      isPaused: false,
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
      nextFetchAt: "2026-04-25T00:00:00.000Z",
      status: "active",
      title: "Success Feed"
    });

    const parseErrorFeed = await insertFeedForTest(pool, {
      consecutiveErrorCount: 2,
      etag: "etag-old-parse",
      feedUrl: "https://example.com/feed-parse.xml",
      fetchIntervalMinutes: 60,
      isPaused: false,
      lastModified: "Tue, 02 Jan 2024 00:00:00 GMT",
      nextFetchAt: "2026-04-25T00:00:00.000Z",
      status: "active",
      title: "Parse Feed"
    });

    await insertFeedForTest(pool, {
      consecutiveErrorCount: 0,
      etag: null,
      feedUrl: "https://example.com/feed-paused.xml",
      fetchIntervalMinutes: 60,
      isPaused: true,
      lastModified: null,
      nextFetchAt: "2026-04-25T00:00:00.000Z",
      status: "active",
      title: "Paused Feed"
    });

    fetchFeedDocumentMock.mockImplementation(async (feed: { id: string }) => ({
      body: `<rss>${feed.id}</rss>`,
      etag: `etag-new-${feed.id}`,
      httpStatus: 200,
      lastModified: "Wed, 03 Jan 2024 00:00:00 GMT",
      status: "success" as const
    }));

    parseFeedDocumentMock.mockImplementation((_: string, feedId: string) => {
      if (feedId === parseErrorFeed.id) {
        throw new ParseError("Malformed XML payload");
      }

      return {
        faviconUrl: "https://example.com/favicon.ico",
        items: [
          {
            author: "alice",
            contentHtml: "<p>body</p>",
            dedupeKey: "worker-item-1",
            guid: "worker-guid-1",
            publishedAt: "2026-04-25T12:00:00.000Z",
            rawExtensionData: {
              source: "test"
            },
            summaryText: "summary",
            title: "Worker Item",
            url: "https://example.com/posts/1"
          }
        ],
        missingPublishedAtCount: 1,
        siteUrl: "https://example.com",
        title: "Parsed Feed Title"
      };
    });

    await runWorkerCycle(pool, workerConfig);

    expect(fetchFeedDocumentMock).toHaveBeenCalledTimes(2);
    expect(parseFeedDocumentMock).toHaveBeenCalledTimes(2);

    const feedRows = await pool.query<FeedStateRow>(
      `
        select
          id,
          title,
          site_url,
          favicon_url,
          status,
          fetch_interval_minutes,
          consecutive_error_count,
          etag,
          last_modified,
          last_success_at,
          last_error_at,
          last_error_category,
          last_error_message,
          last_fetched_at
        from feeds
        where id = any($1::uuid[])
        order by id asc
      `,
      [[successFeed.id, parseErrorFeed.id]]
    );
    expect(feedRows.rows).toHaveLength(2);

    const successState = feedRows.rows.find((row) => row.id === successFeed.id);
    const parseState = feedRows.rows.find((row) => row.id === parseErrorFeed.id);

    expect(successState?.status).toBe("active");
    expect(successState?.fetch_interval_minutes).toBe(90);
    expect(successState?.consecutive_error_count).toBe(0);
    expect(successState?.title).toBe("Parsed Feed Title");
    expect(successState?.site_url).toBe("https://example.com");
    expect(successState?.favicon_url).toBe("https://example.com/favicon.ico");
    expect(successState?.etag).toBe(`etag-new-${successFeed.id}`);
    expect(successState?.last_modified).toBe("Wed, 03 Jan 2024 00:00:00 GMT");
    expect(successState?.last_success_at).not.toBeNull();
    expect(successState?.last_fetched_at).not.toBeNull();
    expect(successState?.last_error_category).toBeNull();
    expect(successState?.last_error_message).toBeNull();

    expect(parseState?.status).toBe("error");
    expect(parseState?.fetch_interval_minutes).toBe(150);
    expect(parseState?.consecutive_error_count).toBe(3);
    expect(parseState?.last_error_category).toBe("parse");
    expect(parseState?.last_error_message).toContain("Malformed XML payload");
    expect(parseState?.last_error_at).not.toBeNull();
    expect(parseState?.last_fetched_at).not.toBeNull();
    expect(parseState?.etag).toBe("etag-old-parse");

    const fetchEvents = await pool.query<FetchEventRow>(
      `
        select feed_id, status, error_category, error_message, missing_published_at_count
        from fetch_events
        where feed_id = any($1::uuid[])
        order by feed_id asc
      `,
      [[successFeed.id, parseErrorFeed.id]]
    );
    expect(fetchEvents.rows).toHaveLength(2);

    const successEvent = fetchEvents.rows.find((row) => row.feed_id === successFeed.id);
    const parseEvent = fetchEvents.rows.find((row) => row.feed_id === parseErrorFeed.id);

    expect(successEvent?.status).toBe("success");
    expect(successEvent?.error_category).toBeNull();
    expect(successEvent?.missing_published_at_count).toBe(1);
    expect(parseEvent?.status).toBe("error");
    expect(parseEvent?.error_category).toBe("parse");
    expect(parseEvent?.error_message).toContain("Malformed XML payload");

    const insertedItems = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from items
        where feed_id = $1
      `,
      [successFeed.id]
    );
    expect(insertedItems.rows[0]?.count).toBe("1");

    const notificationBatches = await pool.query<NotificationBatchRow>(
      `
        select kind, payload
        from notification_batches
        order by sent_at desc
        limit 1
      `
    );
    expect(notificationBatches.rows).toHaveLength(1);
    expect(notificationBatches.rows[0]?.kind).toBe("fetch_cycle");

    const payload = notificationBatches.rows[0]?.payload;
    expect(Array.isArray(payload)).toBe(true);
    const payloadItems = payload as Array<{
      feedId: string;
      status: string;
      errorCategory?: string;
      missingPublishedAtCount?: number;
    }>;
    expect(payloadItems).toHaveLength(2);
    expect(payloadItems.some((item) => item.feedId === successFeed.id && item.status === "success")).toBe(true);
    expect(
      payloadItems.some(
        (item) =>
          item.feedId === parseErrorFeed.id &&
          item.status === "error" &&
          item.errorCategory === "parse"
      )
    ).toBe(true);
  });

  it("handles not-modified outcomes without parsing or item inserts", async () => {
    const pool = requireTestPool();

    const notModifiedFeed = await insertFeedForTest(pool, {
      consecutiveErrorCount: 4,
      etag: "etag-old-not-modified",
      feedUrl: "https://example.com/feed-304.xml",
      fetchIntervalMinutes: 60,
      isPaused: false,
      lastModified: "Thu, 04 Jan 2024 00:00:00 GMT",
      nextFetchAt: "2026-04-25T00:00:00.000Z",
      status: "active",
      title: "Existing Feed Title"
    });

    await pool.query(
      `
        update feeds
        set
          site_url = $2,
          favicon_url = $3,
          last_error_category = $4,
          last_error_message = $5
        where id = $1
      `,
      [
        notModifiedFeed.id,
        "https://example.com/existing-site",
        "https://example.com/existing-favicon.ico",
        "network",
        "old network error"
      ]
    );

    fetchFeedDocumentMock.mockResolvedValue({
      body: null,
      etag: "etag-new-not-modified",
      httpStatus: 304,
      lastModified: "Fri, 05 Jan 2024 00:00:00 GMT",
      status: "not_modified" as const
    });

    parseFeedDocumentMock.mockImplementation(() => {
      throw new Error("parseFeedDocument should not be called for not_modified outcomes");
    });

    await runWorkerCycle(pool, workerConfig);

    expect(fetchFeedDocumentMock).toHaveBeenCalledTimes(1);
    expect(parseFeedDocumentMock).not.toHaveBeenCalled();

    const feedRows = await pool.query<FeedStateRow>(
      `
        select
          id,
          title,
          site_url,
          favicon_url,
          status,
          fetch_interval_minutes,
          consecutive_error_count,
          etag,
          last_modified,
          last_success_at,
          last_error_at,
          last_error_category,
          last_error_message,
          last_fetched_at
        from feeds
        where id = $1
      `,
      [notModifiedFeed.id]
    );
    expect(feedRows.rows).toHaveLength(1);
    const state = feedRows.rows[0];

    expect(state?.status).toBe("active");
    expect(state?.fetch_interval_minutes).toBe(90);
    expect(state?.consecutive_error_count).toBe(0);
    expect(state?.etag).toBe("etag-new-not-modified");
    expect(state?.last_modified).toBe("Fri, 05 Jan 2024 00:00:00 GMT");
    expect(state?.title).toBe("Existing Feed Title");
    expect(state?.site_url).toBe("https://example.com/existing-site");
    expect(state?.favicon_url).toBe("https://example.com/existing-favicon.ico");
    expect(state?.last_success_at).not.toBeNull();
    expect(state?.last_fetched_at).not.toBeNull();
    expect(state?.last_error_category).toBeNull();
    expect(state?.last_error_message).toBeNull();

    const eventRows = await pool.query<FetchEventRow>(
      `
        select feed_id, status, error_category, error_message, missing_published_at_count
        from fetch_events
        where feed_id = $1
      `,
      [notModifiedFeed.id]
    );
    expect(eventRows.rows).toHaveLength(1);
    expect(eventRows.rows[0]?.status).toBe("not_modified");
    expect(eventRows.rows[0]?.error_category).toBeNull();
    expect(eventRows.rows[0]?.missing_published_at_count).toBe(0);

    const itemCount = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from items
        where feed_id = $1
      `,
      [notModifiedFeed.id]
    );
    expect(itemCount.rows[0]?.count).toBe("0");

    const notificationBatches = await pool.query<NotificationBatchRow>(
      `
        select kind, payload
        from notification_batches
        order by sent_at desc
        limit 1
      `
    );
    expect(notificationBatches.rows).toHaveLength(1);
    expect(notificationBatches.rows[0]?.kind).toBe("fetch_cycle");

    const payload = notificationBatches.rows[0]?.payload as Array<{
      feedId: string;
      status: string;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.feedId).toBe(notModifiedFeed.id);
    expect(payload[0]?.status).toBe("not_modified");
  });

  it("records network errors with backoff and preserves existing metadata", async () => {
    const pool = requireTestPool();

    const networkErrorFeed = await insertFeedForTest(pool, {
      consecutiveErrorCount: 3,
      etag: "etag-old-network",
      feedUrl: "https://example.com/feed-network.xml",
      fetchIntervalMinutes: 80,
      isPaused: false,
      lastModified: "Sat, 06 Jan 2024 00:00:00 GMT",
      nextFetchAt: "2026-04-25T00:00:00.000Z",
      status: "active",
      title: "Network Feed Title"
    });

    await pool.query(
      `
        update feeds
        set
          site_url = $2,
          favicon_url = $3
        where id = $1
      `,
      [
        networkErrorFeed.id,
        "https://example.com/network-site",
        "https://example.com/network-favicon.ico"
      ]
    );

    fetchFeedDocumentMock.mockRejectedValue(new TypeError("Network unreachable"));
    parseFeedDocumentMock.mockImplementation(() => {
      throw new Error("parseFeedDocument should not be called when fetch fails");
    });

    await runWorkerCycle(pool, workerConfig);

    expect(fetchFeedDocumentMock).toHaveBeenCalledTimes(1);
    expect(parseFeedDocumentMock).not.toHaveBeenCalled();

    const feedRows = await pool.query<FeedStateRow>(
      `
        select
          id,
          title,
          site_url,
          favicon_url,
          status,
          fetch_interval_minutes,
          consecutive_error_count,
          etag,
          last_modified,
          last_success_at,
          last_error_at,
          last_error_category,
          last_error_message,
          last_fetched_at
        from feeds
        where id = $1
      `,
      [networkErrorFeed.id]
    );
    expect(feedRows.rows).toHaveLength(1);
    const state = feedRows.rows[0];

    expect(state?.status).toBe("error");
    expect(state?.fetch_interval_minutes).toBe(200);
    expect(state?.consecutive_error_count).toBe(4);
    expect(state?.etag).toBe("etag-old-network");
    expect(state?.last_modified).toBe("Sat, 06 Jan 2024 00:00:00 GMT");
    expect(state?.title).toBe("Network Feed Title");
    expect(state?.site_url).toBe("https://example.com/network-site");
    expect(state?.favicon_url).toBe("https://example.com/network-favicon.ico");
    expect(state?.last_error_category).toBe("network");
    expect(state?.last_error_message).toContain("Network unreachable");
    expect(state?.last_error_at).not.toBeNull();
    expect(state?.last_fetched_at).not.toBeNull();

    const eventRows = await pool.query<FetchEventRow>(
      `
        select feed_id, status, error_category, error_message, missing_published_at_count
        from fetch_events
        where feed_id = $1
      `,
      [networkErrorFeed.id]
    );
    expect(eventRows.rows).toHaveLength(1);
    expect(eventRows.rows[0]?.status).toBe("error");
    expect(eventRows.rows[0]?.error_category).toBe("network");
    expect(eventRows.rows[0]?.error_message).toContain("Network unreachable");
    expect(eventRows.rows[0]?.missing_published_at_count).toBe(0);

    const itemCount = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from items
        where feed_id = $1
      `,
      [networkErrorFeed.id]
    );
    expect(itemCount.rows[0]?.count).toBe("0");

    const notificationBatches = await pool.query<NotificationBatchRow>(
      `
        select kind, payload
        from notification_batches
        order by sent_at desc
        limit 1
      `
    );
    expect(notificationBatches.rows).toHaveLength(1);
    expect(notificationBatches.rows[0]?.kind).toBe("fetch_cycle");

    const payload = notificationBatches.rows[0]?.payload as Array<{
      feedId: string;
      status: string;
      errorCategory?: string;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.feedId).toBe(networkErrorFeed.id);
    expect(payload[0]?.status).toBe("error");
    expect(payload[0]?.errorCategory).toBe("network");
  });
});

async function ensureDatabaseExists(adminPool: Pool, databaseName: string): Promise<void> {
  const existsResult = await adminPool.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from pg_database
        where datname = $1
      ) as exists
    `,
    [databaseName]
  );

  if (existsResult.rows[0]?.exists) {
    return;
  }

  await adminPool.query(`create database ${quoteIdentifier(databaseName)}`);
}

async function applyAllUpMigrations(pool: Pool): Promise<void> {
  const migrationFileNames = await readdir(migrationsDirPath);
  const upMigrationFiles = migrationFileNames
    .filter((fileName) => fileName.endsWith(".up.sql"))
    .sort();

  for (const fileName of upMigrationFiles) {
    const filePath = path.resolve(migrationsDirPath, fileName);
    const sql = await readFile(filePath, "utf8");
    await pool.query(sql);
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function requireTestPool(): Pool {
  if (!testPool) {
    throw new Error("Test database pool is not initialized.");
  }

  return testPool;
}

async function insertFeedForTest(
  pool: Pool,
  input: {
    title: string;
    feedUrl: string;
    status: string;
    isPaused: boolean;
    fetchIntervalMinutes: number;
    consecutiveErrorCount: number;
    etag: string | null;
    lastModified: string | null;
    nextFetchAt: string;
  }
): Promise<{ id: string; feedUrl: string }> {
  const result = await pool.query<{ id: string; feed_url: string }>(
    `
      insert into feeds (
        title,
        feed_url,
        status,
        is_paused,
        fetch_interval_minutes,
        consecutive_error_count,
        etag,
        last_modified,
        next_fetch_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
      returning id, feed_url
    `,
    [
      input.title,
      input.feedUrl,
      input.status,
      input.isPaused,
      input.fetchIntervalMinutes,
      input.consecutiveErrorCount,
      input.etag,
      input.lastModified,
      input.nextFetchAt
    ]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Feed insert failed for worker integration test.");
  }

  return {
    id: row.id,
    feedUrl: row.feed_url
  };
}
