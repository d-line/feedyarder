import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listDueFeeds } from "./repository.js";

describe("worker repository", () => {
  it("loads feed auth credentials for due feeds", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          auth_password: "secret",
          auth_username: "reader",
          consecutive_error_count: 0,
          etag: "etag-old",
          feed_url: "https://example.com/private.xml",
          fetch_interval_minutes: 60,
          id: "00000000-0000-0000-0000-000000000101",
          last_error_category: "network",
          last_error_message: "old timeout",
          last_modified: "Mon, 01 Jan 2024 00:00:00 GMT",
          status: "error",
          title: "Private Feed"
        }
      ]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const feeds = await listDueFeeds(pool, 10);
    const [sql] = queryMock.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain("auth_username");
    expect(sql).toContain("auth_password");
    expect(sql).toContain("last_error_category");
    expect(feeds).toEqual([
      {
        authPassword: "secret",
        authUsername: "reader",
        consecutiveErrorCount: 0,
        etag: "etag-old",
        feedUrl: "https://example.com/private.xml",
        fetchIntervalMinutes: 60,
        id: "00000000-0000-0000-0000-000000000101",
        lastErrorCategory: "network",
        lastErrorMessage: "old timeout",
        lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
        status: "error",
        title: "Private Feed"
      }
    ]);
  });
});
