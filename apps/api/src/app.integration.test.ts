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

    const unreadAfterUpdate = await request<{ items: Array<{ id: string }> }>(
      "/items?read=false&limit=20"
    );
    expect(unreadAfterUpdate.data.items.some((item) => item.id === itemId)).toBe(false);
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
