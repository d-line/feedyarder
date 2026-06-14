import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listFeeds, listFetchEvents, retryFeedNow, updateFeed } from "./repository.js";

describe("feed-management repository", () => {
  it("lists feeds with item and read counts", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          consecutive_error_count: 0,
          created_at: new Date("2026-04-25T00:00:00.000Z"),
          favicon_url: null,
          feed_url: "https://example.com/feed.xml",
          fetch_interval_minutes: 60,
          folder_id: null,
          id: "00000000-0000-0000-0000-000000000100",
          is_paused: false,
          item_count: 8,
          last_error_at: null,
          last_error_category: null,
          last_error_message: null,
          last_success_at: null,
          read_item_count: 6,
          site_url: null,
          status: "active",
          title: "Example"
        }
      ]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const feeds = await listFeeds(pool, { includeStatistics: true });
    const [sql] = queryMock.mock.calls[0] as [string];

    expect(sql).toContain("count(*)::integer as item_count");
    expect(sql).toContain("count(*) filter (where is_read)::integer as read_item_count");
    expect(feeds[0]).toMatchObject({
      itemCount: 8,
      readItemCount: 6
    });
  });

  it("lists feeds without the item aggregation by default for callers that do not need it", async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    await listFeeds(pool, { includeStatistics: false });

    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).not.toContain("from items");
    expect(sql).not.toContain("item_count");
  });

  it("lists fetch events with feed filter and maps response fields", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          duration_ms: 900,
          error_category: "network",
          error_message: "timeout",
          feed_id: "00000000-0000-0000-0000-000000000101",
          feed_title: "Tech Feed",
          feed_url: "https://example.com/tech.xml",
          fetched_at: new Date("2026-04-25T01:00:00.000Z"),
          http_status: null,
          id: "00000000-0000-0000-0000-000000000201",
          missing_published_at_count: 2,
          status: "error"
        }
      ]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const events = await listFetchEvents(pool, {
      feedId: "00000000-0000-0000-0000-000000000101",
      limit: 20
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("where fetch_events.feed_id = $1");
    expect(sql).toContain("limit $2");
    expect(values).toEqual(["00000000-0000-0000-0000-000000000101", 20]);

    expect(events).toEqual([
      {
        durationMs: 900,
        errorCategory: "network",
        errorMessage: "timeout",
        feedId: "00000000-0000-0000-0000-000000000101",
        feedTitle: "Tech Feed",
        feedUrl: "https://example.com/tech.xml",
        fetchedAt: "2026-04-25T01:00:00.000Z",
        httpStatus: null,
        id: "00000000-0000-0000-0000-000000000201",
        missingPublishedAtCount: 2,
        status: "error"
      }
    ]);
  });

  it("lists fetch events without feed filter", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: []
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    await listFetchEvents(pool, {
      feedId: null,
      limit: 5
    });

    const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("where fetch_events.feed_id");
    expect(sql).toContain("limit $1");
    expect(values).toEqual([5]);
  });

  it("updates feed with explicit field presence flags", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          consecutive_error_count: 0,
          created_at: new Date("2026-04-25T00:00:00.000Z"),
          favicon_url: "https://example.com/favicon.ico",
          feed_url: "https://example.com/updated.xml",
          fetch_interval_minutes: 60,
          folder_id: null,
          id: "00000000-0000-0000-0000-000000000301",
          is_paused: true,
          last_error_at: null,
          last_error_category: null,
          last_error_message: null,
          last_success_at: null,
          site_url: null,
          status: "active",
          title: null
        }
      ]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const result = await updateFeed(pool, "00000000-0000-0000-0000-000000000301", {
      feedUrl: "https://example.com/updated.xml",
      folderId: null,
      isPaused: true,
      siteUrl: null,
      title: null
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(values).toEqual([
      "00000000-0000-0000-0000-000000000301",
      true,
      null,
      true,
      null,
      true,
      null,
      true,
      "https://example.com/updated.xml",
      true,
      true
    ]);
    expect(result).not.toBeNull();
    expect(result?.isPaused).toBe(true);
    expect(result?.folderId).toBeNull();
    expect(result?.siteUrl).toBeNull();
    expect(result?.title).toBeNull();
  });

  it("returns null when retry target feed does not exist", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Pool;

    await expect(
      retryFeedNow(pool, "00000000-0000-0000-0000-000000000999")
    ).resolves.toBeNull();
  });
});
