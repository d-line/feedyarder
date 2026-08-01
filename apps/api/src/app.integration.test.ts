import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";

interface HttpResult<T> {
  data: T;
  response: Response;
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
  throw new Error("DATABASE_URL is required for API integration tests.");
}

const sourceUrl = new URL(sourceDatabaseUrl);
const sourceDbName = sourceUrl.pathname.replace("/", "");

if (!sourceDbName) {
  throw new Error("DATABASE_URL must include a database name.");
}

const testDbName = `${sourceDbName}_api_it`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${testDbName}`;

const testConfig: AppConfig = {
  API_HOST: "127.0.0.1",
  API_PORT: 0,
  DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
  SESSION_COOKIE_NAME: "feedyarder_session",
  SESSION_COOKIE_SECURE: false,
  SESSION_MAX_AGE_DAYS: 30,
  SIMILARITY_ENABLED: true,
  WEB_ORIGIN: "http://localhost:3000"
};

let adminPool: Pool | null = null;
let testPool: Pool | null = null;
let baseUrl = "";
let sessionCookie = "";
let closeServer: (() => Promise<void>) | null = null;

beforeAll(async () => {
  adminPool = new Pool({
    connectionString: adminUrl.toString()
  });

  await ensureDatabaseExists(adminPool, testDbName);

  testPool = new Pool({
    connectionString: testConfig.DATABASE_URL
  });

  await applyAllUpMigrations(testPool);

  const app = createApp(testConfig);
  const server = app.listen(0, "127.0.0.1");

  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to bind API integration test server.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };
});

afterAll(async () => {
  if (closeServer) {
    await closeServer();
  }

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
  const pool = requireTestPool();
  sessionCookie = "";

  await pool.query(`
    truncate table
      sessions,
      items,
      fetch_events,
      notification_batches,
      feeds,
      folders,
      users
    restart identity cascade
  `);
});

describe("API integration", () => {
  it("runs setup and authenticates protected endpoints", async () => {
    const setupStatusBefore = await request<{ setupCompleted: boolean }>("/setup/status");
    expect(setupStatusBefore.data.setupCompleted).toBe(false);

    const setupResult = await request<{ id: string; username: string }>(
      "/setup",
      {
        body: JSON.stringify({
          password: "supersecret123",
          username: "operator"
        }),
        method: "POST"
      }
    );

    expect(setupResult.response.status).toBe(201);
    expect(setupResult.data.username).toBe("operator");
    expect(sessionCookie).toContain("feedyarder_session=");

    const me = await request<{ id: string; username: string }>("/me");
    expect(me.response.status).toBe(200);
    expect(me.data.username).toBe("operator");

    const feedList = await request<unknown[]>("/feeds");
    expect(feedList.response.status).toBe(200);

    const unauthenticated = await request<{ error: { code: string } }>("/feeds", {
      includeCookie: false
    });
    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.data.error.code).toBe("not_authenticated");
  });

  it("supports folder/feed/item flows including item state updates", async () => {
    await setupAndLogin();
    const pool = requireTestPool();

    const folder = await request<{ id: string; title: string; position: number }>(
      "/folders",
      {
        body: JSON.stringify({
          position: 0,
          title: "news"
        }),
        method: "POST"
      }
    );
    expect(folder.response.status).toBe(201);

    const feed = await request<{ id: string; folderId: string | null; feedUrl: string }>(
      "/feeds",
      {
        body: JSON.stringify({
          feedUrl: "https://example.com/feed.xml",
          folderId: folder.data.id
        }),
        method: "POST"
      }
    );
    expect(feed.response.status).toBe(201);
    expect(feed.data.folderId).toBe(folder.data.id);

    const insertedItem = await pool.query<{ id: string }>(
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
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb
        )
        returning id
      `,
      [
        feed.data.id,
        "guid-1",
        "dedupe-1",
        "Item 1",
        "https://example.com/posts/1",
        "author",
        "summary",
        "<p>body</p>",
        "2026-04-25T00:00:00.000Z",
        JSON.stringify({})
      ]
    );
    const itemId = insertedItem.rows[0]?.id;

    if (!itemId) {
      throw new Error("Failed to insert integration test item.");
    }

    const unreadItems = await request<{ items: Array<{ id: string; isRead: boolean }> }>(
      "/items?read=false&limit=20"
    );
    expect(unreadItems.response.status).toBe(200);
    expect(unreadItems.data.items.some((item) => item.id === itemId)).toBe(true);

    const updatedItem = await request<{ id: string; isRead: boolean; isStarred: boolean }>(
      `/items/${itemId}/state`,
      {
        body: JSON.stringify({
          isRead: true,
          isStarred: true
        }),
        method: "PATCH"
      }
    );
    expect(updatedItem.response.status).toBe(200);
    expect(updatedItem.data.isRead).toBe(true);
    expect(updatedItem.data.isStarred).toBe(true);

    const feedsWithStatistics = await request<
      Array<{ id: string; itemCount: number; readItemCount: number }>
    >("/feeds?includeStatistics=true");
    const feedWithStatistics = feedsWithStatistics.data.find(
      (entry) => entry.id === feed.data.id
    );
    expect(feedWithStatistics).toMatchObject({
      itemCount: 1,
      readItemCount: 1
    });

    const unreadAfterUpdate = await request<{ items: Array<{ id: string }> }>(
      "/items?read=false&limit=20"
    );
    expect(unreadAfterUpdate.data.items.some((item) => item.id === itemId)).toBe(false);
  });

  it("stores and clears feed HTTP Basic auth without returning secrets", async () => {
    await setupAndLogin();
    const pool = requireTestPool();

    const created = await request<{
      authPassword?: string;
      hasAuth: boolean;
      id: string;
    }>("/feeds", {
      body: JSON.stringify({
        authPassword: "secret-one",
        authUsername: "reader-one",
        feedUrl: "https://example.com/private.xml"
      }),
      method: "POST"
    });

    expect(created.response.status).toBe(201);
    expect(created.data.hasAuth).toBe(true);
    expect(created.data.authPassword).toBeUndefined();

    const createdCredentials = await pool.query<{
      auth_password: string | null;
      auth_username: string | null;
    }>(
      `
        select auth_username, auth_password
        from feeds
        where id = $1
      `,
      [created.data.id]
    );
    expect(createdCredentials.rows[0]).toEqual({
      auth_password: "secret-one",
      auth_username: "reader-one"
    });

    const updated = await request<{ hasAuth: boolean }>(`/feeds/${created.data.id}`, {
      body: JSON.stringify({
        authPassword: "secret-two",
        authUsername: "reader-two"
      }),
      method: "PATCH"
    });
    expect(updated.response.status).toBe(200);
    expect(updated.data.hasAuth).toBe(true);

    const cleared = await request<{ hasAuth: boolean }>(`/feeds/${created.data.id}`, {
      body: JSON.stringify({
        clearAuth: true
      }),
      method: "PATCH"
    });
    expect(cleared.response.status).toBe(200);
    expect(cleared.data.hasAuth).toBe(false);

    const clearedCredentials = await pool.query<{
      auth_password: string | null;
      auth_username: string | null;
    }>(
      `
        select auth_username, auth_password
        from feeds
        where id = $1
      `,
      [created.data.id]
    );
    expect(clearedCredentials.rows[0]).toEqual({
      auth_password: null,
      auth_username: null
    });
  });

  it("logs out current session and keeps logout idempotent", async () => {
    await setupAndLogin();

    const meBeforeLogout = await request<{ id: string; username: string }>("/me");
    expect(meBeforeLogout.response.status).toBe(200);
    expect(meBeforeLogout.data.username).toBe("operator");

    const logoutFirst = await request<undefined>("/session", {
      method: "DELETE"
    });
    expect(logoutFirst.response.status).toBe(204);

    const meAfterLogout = await request<{ error: { code: string; message: string } }>("/me");
    expect(meAfterLogout.response.status).toBe(401);
    expect(meAfterLogout.data.error.code).toBe("not_authenticated");

    const protectedAfterLogout = await request<{ error: { code: string; message: string } }>(
      "/feeds"
    );
    expect(protectedAfterLogout.response.status).toBe(401);
    expect(protectedAfterLogout.data.error.code).toBe("not_authenticated");

    const logoutSecond = await request<undefined>("/session", {
      method: "DELETE"
    });
    expect(logoutSecond.response.status).toBe(204);

    const protectedAfterSecondLogout = await request<{ error: { code: string; message: string } }>(
      "/folders"
    );
    expect(protectedAfterSecondLogout.response.status).toBe(401);
    expect(protectedAfterSecondLogout.data.error.code).toBe("not_authenticated");
  });

  it("rejects expired sessions and clears auth cookie", async () => {
    await setupAndLogin();
    const pool = requireTestPool();
    const token = readSessionTokenFromCookie();

    await pool.query(
      `
        update sessions
        set expires_at = now() - interval '1 minute'
        where session_token = $1
      `,
      [token]
    );

    const expiredMe = await request<{ error: { code: string; message: string } }>("/me");
    expect(expiredMe.response.status).toBe(401);
    expect(expiredMe.data.error.code).toBe("not_authenticated");
    expect(expiredMe.response.headers.get("set-cookie")).toContain("Max-Age=0");

    const protectedAfterExpiry = await request<{ error: { code: string; message: string } }>(
      "/feeds"
    );
    expect(protectedAfterExpiry.response.status).toBe(401);
    expect(protectedAfterExpiry.data.error.code).toBe("not_authenticated");
  });

  it("imports and exports OPML with duplicate skipping", async () => {
    await setupAndLogin();

    const opmlDocument = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline text="Forum">
      <outline text="Feed One" title="Feed One" type="rss" xmlUrl="https://example.com/forum.xml" htmlUrl="https://example.com/forum" />
    </outline>
  </body>
</opml>`;

    const opmlImport = await request<{
      createdFeedCount: number;
      createdFolderCount: number;
      skippedFeedCount: number;
    }>("/opml/import", {
      body: JSON.stringify({
        opml: opmlDocument
      }),
      method: "POST"
    });

    expect(opmlImport.response.status).toBe(201);
    expect(opmlImport.data.createdFolderCount).toBe(1);
    expect(opmlImport.data.createdFeedCount).toBe(1);
    expect(opmlImport.data.skippedFeedCount).toBe(0);

    const duplicateImport = await request<{
      createdFeedCount: number;
      createdFolderCount: number;
      skippedFeedCount: number;
    }>("/opml/import", {
      body: JSON.stringify({
        opml: opmlDocument
      }),
      method: "POST"
    });
    expect(duplicateImport.response.status).toBe(201);
    expect(duplicateImport.data.createdFolderCount).toBe(0);
    expect(duplicateImport.data.createdFeedCount).toBe(0);
    expect(duplicateImport.data.skippedFeedCount).toBe(1);

    const exported = await requestRaw("/opml/export");
    expect(exported.response.status).toBe(200);
    expect(exported.text).toContain("https://example.com/forum.xml");
    expect(exported.text).toContain("Forum");
  });

  it("lists fetch events with ordering, limit, and feed filter", async () => {
    await setupAndLogin();
    const pool = requireTestPool();

    const feedOne = await createFeedForTest({
      feedUrl: "https://example.com/feed-one.xml",
      title: "Feed One"
    });
    const feedTwo = await createFeedForTest({
      feedUrl: "https://example.com/feed-two.xml",
      title: "Feed Two"
    });

    await insertFetchEvent(pool, {
      durationMs: 310,
      errorCategory: null,
      errorMessage: null,
      feedId: feedOne.id,
      fetchedAt: "2026-04-25T00:00:00.000Z",
      httpStatus: 304,
      missingPublishedAtCount: 0,
      status: "not_modified"
    });
    await insertFetchEvent(pool, {
      durationMs: 1400,
      errorCategory: "parse",
      errorMessage: "Invalid XML document",
      feedId: feedTwo.id,
      fetchedAt: "2026-04-25T01:00:00.000Z",
      httpStatus: null,
      missingPublishedAtCount: 1,
      status: "error"
    });
    await insertFetchEvent(pool, {
      durationMs: 900,
      errorCategory: "network",
      errorMessage: "connect ECONNRESET",
      feedId: feedOne.id,
      fetchedAt: "2026-04-25T02:00:00.000Z",
      httpStatus: null,
      missingPublishedAtCount: 2,
      status: "error"
    });

    const latestTwo = await request<Array<{ feedId: string; fetchedAt: string; status: string }>>(
      "/fetch-events?limit=2"
    );
    expect(latestTwo.response.status).toBe(200);
    expect(latestTwo.data).toHaveLength(2);
    expect(latestTwo.data[0]?.feedId).toBe(feedOne.id);
    expect(latestTwo.data[0]?.status).toBe("error");
    expect(latestTwo.data[1]?.feedId).toBe(feedTwo.id);
    expect(latestTwo.data[1]?.status).toBe("error");
    expect(new Date(latestTwo.data[0]?.fetchedAt ?? 0).getTime()).toBeGreaterThan(
      new Date(latestTwo.data[1]?.fetchedAt ?? 0).getTime()
    );

    const onlyFeedOne = await request<
      Array<{ feedId: string; feedTitle: string | null; errorCategory: string | null; status: string }>
    >(`/fetch-events?feedId=${feedOne.id}&limit=10`);
    expect(onlyFeedOne.response.status).toBe(200);
    expect(onlyFeedOne.data).toHaveLength(2);
    expect(onlyFeedOne.data.every((event) => event.feedId === feedOne.id)).toBe(true);
    expect(onlyFeedOne.data[0]?.feedTitle).toBe("Feed One");
    expect(onlyFeedOne.data[0]?.errorCategory).toBe("network");
    expect(onlyFeedOne.data[1]?.status).toBe("not_modified");
  });

  it("supports item search and filter combinations with cursor pagination", async () => {
    await setupAndLogin();
    const pool = requireTestPool();

    const folderTech = await createFolderForTest({
      position: 0,
      title: "Tech"
    });
    const folderOps = await createFolderForTest({
      position: 1,
      title: "Ops"
    });

    const feedTech = await createFeedForTest({
      feedUrl: "https://example.com/tech.xml",
      folderId: folderTech.id,
      title: "Rust Signal"
    });
    const feedOps = await createFeedForTest({
      feedUrl: "https://example.com/ops.xml",
      folderId: folderOps.id,
      title: "Ops Wire"
    });

    await insertItem(pool, {
      author: "alice",
      contentHtml: "<p>alpha body</p>",
      dedupeKey: "tech-1",
      feedId: feedTech.id,
      guid: "tech-guid-1",
      isRead: false,
      isStarred: false,
      publishedAt: "2026-04-25T12:00:00.000Z",
      summaryText: "alpha summary",
      title: "Language update",
      url: "https://example.com/tech/1"
    });
    await insertItem(pool, {
      author: "alice",
      contentHtml: "<p>beta body</p>",
      dedupeKey: "tech-2",
      feedId: feedTech.id,
      guid: "tech-guid-2",
      isRead: true,
      isStarred: true,
      publishedAt: "2026-04-24T12:00:00.000Z",
      summaryText: "beta summary",
      title: "Compiler notes",
      url: "https://example.com/tech/2"
    });
    await insertItem(pool, {
      author: "bob",
      contentHtml: "<p>deploy checklist</p>",
      dedupeKey: "ops-1",
      feedId: feedOps.id,
      guid: "ops-guid-1",
      isRead: false,
      isStarred: true,
      publishedAt: "2026-04-23T12:00:00.000Z",
      summaryText: "deploy incident report",
      title: "Incident update",
      url: "https://example.com/ops/1"
    });
    await insertItem(pool, {
      author: "carol",
      contentHtml: "<p>no date body</p>",
      dedupeKey: "ops-2",
      feedId: feedOps.id,
      guid: "ops-guid-2",
      isRead: false,
      isStarred: false,
      publishedAt: null,
      summaryText: "misc note",
      title: "Loose note",
      url: "https://example.com/ops/2"
    });

    const byFeedTitleSearch = await request<{ items: Array<{ feedId: string }> }>(
      "/items?q=rust&limit=20"
    );
    expect(byFeedTitleSearch.response.status).toBe(200);
    expect(byFeedTitleSearch.data.items).toHaveLength(2);
    expect(byFeedTitleSearch.data.items.every((item) => item.feedId === feedTech.id)).toBe(true);

    const unreadStarredInOps = await request<{ items: Array<{ id: string; feedId: string }> }>(
      `/items?folderId=${folderOps.id}&read=false&starred=true&limit=20`
    );
    expect(unreadStarredInOps.response.status).toBe(200);
    expect(unreadStarredInOps.data.items).toHaveLength(1);
    expect(unreadStarredInOps.data.items[0]?.feedId).toBe(feedOps.id);

    const deploySearchWithFilters = await request<{ items: Array<{ title: string | null }> }>(
      "/items?q=deploy&read=false&starred=true&limit=20"
    );
    expect(deploySearchWithFilters.response.status).toBe(200);
    expect(deploySearchWithFilters.data.items).toHaveLength(1);
    expect(deploySearchWithFilters.data.items[0]?.title).toBe("Incident update");

    const firstPage = await request<{ items: Array<{ title: string | null }>; nextCursor: string | null }>(
      `/items?feedId=${feedTech.id}&limit=1`
    );
    expect(firstPage.response.status).toBe(200);
    expect(firstPage.data.items).toHaveLength(1);
    expect(firstPage.data.items[0]?.title).toBe("Language update");
    expect(firstPage.data.nextCursor).not.toBeNull();

    const secondPage = await request<{ items: Array<{ title: string | null }>; nextCursor: string | null }>(
      `/items?feedId=${feedTech.id}&limit=1&cursor=${firstPage.data.nextCursor}`
    );
    expect(secondPage.response.status).toBe(200);
    expect(secondPage.data.items).toHaveLength(1);
    expect(secondPage.data.items[0]?.title).toBe("Compiler notes");
    expect(secondPage.data.nextCursor).toBeNull();
  });

  it("rejects invalid items query parameters with validation errors", async () => {
    await setupAndLogin();

    const invalidFeedId = await request<{ error: { code: string; message: string } }>(
      "/items?feedId=not-a-uuid&limit=20"
    );
    expect(invalidFeedId.response.status).toBe(400);
    expect(invalidFeedId.data.error.code).toBe("invalid_request");

    const invalidReadValue = await request<{ error: { code: string; message: string } }>(
      "/items?read=maybe&limit=20"
    );
    expect(invalidReadValue.response.status).toBe(400);
    expect(invalidReadValue.data.error.code).toBe("invalid_request");

    const invalidLimit = await request<{ error: { code: string; message: string } }>(
      "/items?limit=101"
    );
    expect(invalidLimit.response.status).toBe(400);
    expect(invalidLimit.data.error.code).toBe("invalid_request");
  });

  it("rejects invalid fetch-events query parameters with validation errors", async () => {
    await setupAndLogin();

    const invalidFeedId = await request<{ error: { code: string; message: string } }>(
      "/fetch-events?feedId=bad-id&limit=10"
    );
    expect(invalidFeedId.response.status).toBe(400);
    expect(invalidFeedId.data.error.code).toBe("invalid_request");

    const invalidLimit = await request<{ error: { code: string; message: string } }>(
      "/fetch-events?limit=0"
    );
    expect(invalidLimit.response.status).toBe(400);
    expect(invalidLimit.data.error.code).toBe("invalid_request");
  });

  it("supports feed retry endpoint semantics and returns 404 for missing feed", async () => {
    await setupAndLogin();

    const createdFeed = await createFeedForTest({
      feedUrl: "https://example.com/retry-feed.xml",
      title: "Retry Feed"
    });

    const paused = await request<{ id: string; isPaused: boolean }>(`/feeds/${createdFeed.id}`, {
      body: JSON.stringify({
        isPaused: true
      }),
      method: "PATCH"
    });
    expect(paused.response.status).toBe(200);
    expect(paused.data.isPaused).toBe(true);

    const retried = await request<{ id: string; isPaused: boolean }>(
      `/feeds/${createdFeed.id}/retry`,
      {
        method: "POST"
      }
    );
    expect(retried.response.status).toBe(200);
    expect(retried.data.id).toBe(createdFeed.id);
    expect(retried.data.isPaused).toBe(false);

    const missingRetry = await request<{ error: { code: string; message: string } }>(
      "/feeds/00000000-0000-0000-0000-000000000999/retry",
      {
        method: "POST"
      }
    );
    expect(missingRetry.response.status).toBe(404);
    expect(missingRetry.data.error.code).toBe("feed_not_found");
  });

  it("deletes folders, unassigns their feeds, and returns 404 for missing folder", async () => {
    await setupAndLogin();

    const folder = await createFolderForTest({
      position: 0,
      title: "Delete Target Folder"
    });

    const feedInFolder = await createFeedForTest({
      feedUrl: "https://example.com/folder-target.xml",
      folderId: folder.id,
      title: "Folder Target Feed"
    });

    const deleted = await request<unknown>(`/folders/${folder.id}`, {
      method: "DELETE"
    });
    expect(deleted.response.status).toBe(204);

    const foldersAfterDelete = await request<Array<{ id: string; title: string }>>("/folders");
    expect(foldersAfterDelete.response.status).toBe(200);
    expect(foldersAfterDelete.data.some((entry) => entry.id === folder.id)).toBe(false);

    const feedsAfterDelete = await request<Array<{ id: string; folderId: string | null }>>("/feeds");
    expect(feedsAfterDelete.response.status).toBe(200);
    const updatedFeed = feedsAfterDelete.data.find((entry) => entry.id === feedInFolder.id);
    expect(updatedFeed?.folderId).toBeNull();

    const missingFolderDelete = await request<{ error: { code: string; message: string } }>(
      "/folders/00000000-0000-0000-0000-000000000777",
      {
        method: "DELETE"
      }
    );
    expect(missingFolderDelete.response.status).toBe(404);
    expect(missingFolderDelete.data.error.code).toBe("folder_not_found");
  });

  it("returns explicit errors for feed mutation conflicts, invalid payloads, and missing resources", async () => {
    await setupAndLogin();

    const folder = await createFolderForTest({
      position: 0,
      title: "Mutations Folder"
    });

    const feedOne = await createFeedForTest({
      feedUrl: "https://example.com/mutation-one.xml",
      folderId: folder.id,
      title: "Mutation One"
    });
    const feedTwo = await createFeedForTest({
      feedUrl: "https://example.com/mutation-two.xml",
      title: "Mutation Two"
    });

    const duplicateCreate = await request<{ error: { code: string; message: string } }>(
      "/feeds",
      {
        body: JSON.stringify({
          feedUrl: "https://example.com/mutation-one.xml"
        }),
        method: "POST"
      }
    );
    expect(duplicateCreate.response.status).toBe(409);
    expect(duplicateCreate.data.error.code).toBe("feed_already_exists");

    const createWithMissingFolder = await request<{ error: { code: string; message: string } }>(
      "/feeds",
      {
        body: JSON.stringify({
          feedUrl: "https://example.com/mutation-three.xml",
          folderId: "00000000-0000-0000-0000-000000000888"
        }),
        method: "POST"
      }
    );
    expect(createWithMissingFolder.response.status).toBe(400);
    expect(createWithMissingFolder.data.error.code).toBe("folder_not_found");

    const updateWithDuplicateUrl = await request<{ error: { code: string; message: string } }>(
      `/feeds/${feedTwo.id}`,
      {
        body: JSON.stringify({
          feedUrl: "https://example.com/mutation-one.xml"
        }),
        method: "PATCH"
      }
    );
    expect(updateWithDuplicateUrl.response.status).toBe(409);
    expect(updateWithDuplicateUrl.data.error.code).toBe("feed_already_exists");

    const updateWithMissingFolder = await request<{ error: { code: string; message: string } }>(
      `/feeds/${feedOne.id}`,
      {
        body: JSON.stringify({
          folderId: "00000000-0000-0000-0000-000000000887"
        }),
        method: "PATCH"
      }
    );
    expect(updateWithMissingFolder.response.status).toBe(400);
    expect(updateWithMissingFolder.data.error.code).toBe("folder_not_found");

    const missingFeedUpdate = await request<{ error: { code: string; message: string } }>(
      "/feeds/00000000-0000-0000-0000-000000000886",
      {
        body: JSON.stringify({
          title: "x"
        }),
        method: "PATCH"
      }
    );
    expect(missingFeedUpdate.response.status).toBe(404);
    expect(missingFeedUpdate.data.error.code).toBe("feed_not_found");

    const missingFolderUpdate = await request<{ error: { code: string; message: string } }>(
      "/folders/00000000-0000-0000-0000-000000000885",
      {
        body: JSON.stringify({
          title: "x"
        }),
        method: "PATCH"
      }
    );
    expect(missingFolderUpdate.response.status).toBe(404);
    expect(missingFolderUpdate.data.error.code).toBe("folder_not_found");

    const invalidFeedUpdatePayload = await request<{ error: { code: string; message: string } }>(
      `/feeds/${feedOne.id}`,
      {
        body: JSON.stringify({}),
        method: "PATCH"
      }
    );
    expect(invalidFeedUpdatePayload.response.status).toBe(400);
    expect(invalidFeedUpdatePayload.data.error.code).toBe("invalid_request");

    const invalidFeedAuthPayload = await request<{ error: { code: string; message: string } }>(
      `/feeds/${feedOne.id}`,
      {
        body: JSON.stringify({
          authUsername: "reader"
        }),
        method: "PATCH"
      }
    );
    expect(invalidFeedAuthPayload.response.status).toBe(400);
    expect(invalidFeedAuthPayload.data.error.code).toBe("invalid_request");

    const invalidFolderUpdatePayload = await request<{ error: { code: string; message: string } }>(
      `/folders/${folder.id}`,
      {
        body: JSON.stringify({}),
        method: "PATCH"
      }
    );
    expect(invalidFolderUpdatePayload.response.status).toBe(400);
    expect(invalidFolderUpdatePayload.data.error.code).toBe("invalid_request");

    const invalidFeedPath = await request<{ error: { code: string; message: string } }>(
      "/feeds/not-a-uuid",
      {
        body: JSON.stringify({
          title: "noop"
        }),
        method: "PATCH"
      }
    );
    expect(invalidFeedPath.response.status).toBe(400);
    expect(invalidFeedPath.data.error.code).toBe("invalid_request");

    const invalidFolderPath = await request<{ error: { code: string; message: string } }>(
      "/folders/not-a-uuid",
      {
        body: JSON.stringify({
          title: "noop"
        }),
        method: "PATCH"
      }
    );
    expect(invalidFolderPath.response.status).toBe(400);
    expect(invalidFolderPath.data.error.code).toBe("invalid_request");

    const invalidItemPath = await request<{ error: { code: string; message: string } }>(
      "/items/not-a-uuid/state",
      {
        body: JSON.stringify({
          isRead: true
        }),
        method: "PATCH"
      }
    );
    expect(invalidItemPath.response.status).toBe(400);
    expect(invalidItemPath.data.error.code).toBe("invalid_request");
  });

  it("returns bounded hybrid similar items and feature availability states", async () => {
    await setupAndLogin();
    const pool = requireTestPool();
    const feedOne = await createFeedForTest({
      feedUrl: "https://example.com/similar-one.xml",
      title: "Primary Feed"
    });
    const feedTwo = await createFeedForTest({
      feedUrl: "https://example.com/similar-two.xml",
      title: "Secondary Feed"
    });
    const sourceItemId = await insertItem(pool, {
      author: null,
      contentHtml: "<p>PostgreSQL vector indexes and HNSW search.</p>",
      dedupeKey: "similar-source",
      feedId: feedOne.id,
      guid: "similar-source",
      isRead: false,
      isStarred: false,
      publishedAt: "2026-07-01T00:00:00.000Z",
      summaryText: "PostgreSQL vector indexes",
      title: "PostgreSQL vector search",
      url: "https://example.com/source"
    });
    const relatedItemId = await insertItem(pool, {
      author: null,
      contentHtml: "<p>Nearest-neighbor lookup with pgvector.</p>",
      dedupeKey: "similar-related",
      feedId: feedTwo.id,
      guid: "similar-related",
      isRead: true,
      isStarred: false,
      publishedAt: "2026-07-02T00:00:00.000Z",
      summaryText: "PostgreSQL HNSW nearest-neighbor lookup",
      title: "Fast nearest-neighbor queries with pgvector",
      url: "https://example.com/related"
    });
    const pendingItemId = await insertItem(pool, {
      author: null,
      contentHtml: "<p>This item is still waiting for its embedding.</p>",
      dedupeKey: "similar-pending",
      feedId: feedTwo.id,
      guid: "similar-pending",
      isRead: false,
      isStarred: false,
      publishedAt: "2026-07-03T00:00:00.000Z",
      summaryText: "Pending similarity feature",
      title: "Pending item",
      url: "https://example.com/pending"
    });
    const sourceVector = unitVector(0);
    const relatedVector = unitVector(0, 0.05);

    await pool.query(
      `
        insert into item_similarity_features (
          item_id,
          algorithm_version,
          status,
          input_hash,
          plain_text_length,
          lexical_terms,
          search_document,
          embedding
        )
        values
          (
            $1,
            'similarity-v1',
            'ready',
            repeat('a', 64),
            100,
            array['postgresql', 'vector', 'hnsw'],
            setweight(to_tsvector('simple', 'PostgreSQL vector search'), 'A'),
            $3::halfvec
          ),
          (
            $2,
            'similarity-v1',
            'ready',
            repeat('b', 64),
            100,
            array['postgresql', 'pgvector', 'hnsw'],
            setweight(
              to_tsvector(
                'simple',
                'Fast nearest neighbor queries with PostgreSQL pgvector HNSW'
              ),
              'A'
            ),
            $4::halfvec
          )
      `,
      [sourceItemId, relatedItemId, sourceVector, relatedVector]
    );

    const similar = await request<{
      count: number;
      hasMore: boolean;
      items: Array<{ id: string; isRead: boolean }>;
      status: string;
    }>(`/items/${sourceItemId}/similar?limit=5`);

    expect(similar.response.status).toBe(200);
    expect(similar.data.status).toBe("ready");
    expect(similar.data.count).toBe(1);
    expect(similar.data.hasMore).toBe(false);
    expect(similar.data.items).toEqual([
      expect.objectContaining({
        id: relatedItemId,
        isRead: true
      })
    ]);

    const pending = await request<{ count: number; status: string }>(
      `/items/${pendingItemId}/similar`
    );
    expect(pending.response.status).toBe(200);
    expect(pending.data).toMatchObject({
      count: 0,
      status: "pending"
    });

    await pool.query(
      `
        insert into item_similarity_features (
          item_id,
          algorithm_version,
          status,
          input_hash,
          plain_text_length,
          skip_reason
        )
        values (
          $1,
          'similarity-v1',
          'skipped',
          repeat('c', 64),
          2,
          'insufficient_text'
        )
      `,
      [pendingItemId]
    );
    const unavailable = await request<{ count: number; status: string }>(
      `/items/${pendingItemId}/similar`
    );
    expect(unavailable.response.status).toBe(200);
    expect(unavailable.data).toMatchObject({
      count: 0,
      status: "unavailable"
    });

    const missing = await request<{ error: { code: string } }>(
      "/items/00000000-0000-0000-0000-000000000999/similar"
    );
    expect(missing.response.status).toBe(404);
    expect(missing.data.error.code).toBe("item_not_found");

    const invalidLimit = await request<{ error: { code: string } }>(
      `/items/${sourceItemId}/similar?limit=21`
    );
    expect(invalidLimit.response.status).toBe(400);
    expect(invalidLimit.data.error.code).toBe("invalid_request");

    const invalidItemId = await request<{ error: { code: string } }>(
      "/items/not-a-uuid/similar"
    );
    expect(invalidItemId.response.status).toBe(400);
    expect(invalidItemId.data.error.code).toBe("invalid_request");

    const unauthenticated = await request<{ error: { code: string } }>(
      `/items/${sourceItemId}/similar`,
      {
        includeCookie: false
      }
    );
    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.data.error.code).toBe("not_authenticated");
  });
});

async function setupAndLogin(): Promise<void> {
  const setupResult = await request<{ id: string; username: string }>("/setup", {
    body: JSON.stringify({
      password: "supersecret123",
      username: "operator"
    }),
    method: "POST"
  });

  if (setupResult.response.status !== 201) {
    throw new Error(`Setup failed unexpectedly: ${setupResult.response.status}`);
  }
}

async function request<T>(
  pathname: string,
  input?: {
    body?: string;
    includeCookie?: boolean;
    method?: "DELETE" | "GET" | "PATCH" | "POST";
  }
): Promise<HttpResult<T>> {
  const init: RequestInit = {
    headers: {
      ...(input?.body ? { "Content-Type": "application/json" } : {}),
      ...(input?.includeCookie === false || !sessionCookie
        ? {}
        : { Cookie: sessionCookie })
    },
    method: input?.method ?? "GET"
  };

  if (input?.body !== undefined) {
    init.body = input.body;
  }

  const response = await fetch(`${baseUrl}${pathname}`, init);

  const setCookie = response.headers.get("set-cookie");

  if (setCookie) {
    sessionCookie = setCookie.split(";")[0] ?? "";
  }

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);

  return {
    data,
    response
  };
}

async function requestRaw(pathname: string): Promise<{ response: Response; text: string }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      ...(sessionCookie ? { Cookie: sessionCookie } : {})
    },
    method: "GET"
  });
  const text = await response.text();

  return {
    response,
    text
  };
}

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

async function createFolderForTest(input: {
  position: number;
  title: string;
}): Promise<{ id: string; title: string; position: number }> {
  const response = await request<{ id: string; title: string; position: number }>("/folders", {
    body: JSON.stringify(input),
    method: "POST"
  });

  if (response.response.status !== 201) {
    throw new Error(`Folder creation failed unexpectedly: ${response.response.status}`);
  }

  return response.data;
}

async function createFeedForTest(input: {
  feedUrl: string;
  folderId?: string;
  title?: string;
}): Promise<{ id: string; folderId: string | null; feedUrl: string; title: string | null }> {
  const response = await request<{
    id: string;
    folderId: string | null;
    feedUrl: string;
    title: string | null;
  }>("/feeds", {
    body: JSON.stringify({
      feedUrl: input.feedUrl,
      folderId: input.folderId ?? null,
      title: input.title ?? null
    }),
    method: "POST"
  });

  if (response.response.status !== 201) {
    throw new Error(`Feed creation failed unexpectedly: ${response.response.status}`);
  }

  return response.data;
}

async function insertFetchEvent(
  pool: Pool,
  input: {
    feedId: string;
    status: string;
    errorCategory: string | null;
    errorMessage: string | null;
    httpStatus: number | null;
    missingPublishedAtCount: number;
    fetchedAt: string;
    durationMs: number | null;
  }
): Promise<void> {
  await pool.query(
    `
      insert into fetch_events (
        feed_id,
        status,
        error_category,
        error_message,
        http_status,
        missing_published_at_count,
        fetched_at,
        duration_ms
      )
      values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
    `,
    [
      input.feedId,
      input.status,
      input.errorCategory,
      input.errorMessage,
      input.httpStatus,
      input.missingPublishedAtCount,
      input.fetchedAt,
      input.durationMs
    ]
  );
}

async function insertItem(
  pool: Pool,
  input: {
    feedId: string;
    guid: string;
    dedupeKey: string;
    title: string | null;
    url: string | null;
    author: string | null;
    summaryText: string | null;
    contentHtml: string | null;
    publishedAt: string | null;
    isRead: boolean;
    isStarred: boolean;
  }
): Promise<string> {
  const result = await pool.query<{ id: string }>(
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
        raw_extension_data,
        is_read,
        is_starred
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::timestamptz,
        '{}'::jsonb,
        $10,
        $11
      )
      returning id
    `,
    [
      input.feedId,
      input.guid,
      input.dedupeKey,
      input.title,
      input.url,
      input.author,
      input.summaryText,
      input.contentHtml,
      input.publishedAt,
      input.isRead,
      input.isStarred
    ]
  );

  const itemId = result.rows[0]?.id;

  if (!itemId) {
    throw new Error("Failed to insert integration test item.");
  }

  return itemId;
}

function unitVector(primaryIndex: number, secondaryValue = 0): string {
  const values = Array.from({ length: 384 }, () => 0);
  values[primaryIndex] = 1;

  if (secondaryValue !== 0) {
    values[1] = secondaryValue;
  }

  return `[${values.join(",")}]`;
}

function readSessionTokenFromCookie(): string {
  const [cookiePair] = sessionCookie.split(";");
  const token = cookiePair?.split("=")[1];

  if (!token) {
    throw new Error("Expected session cookie token to be present.");
  }

  return token;
}
