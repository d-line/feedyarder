import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  getFeedBackfillTarget,
  getFolderBackfillTarget,
  recordFeedBackfillComplete
} from "./repository.js";

describe("getFeedBackfillTarget", () => {
  it("returns a feed backfill target with the completion marker", async () => {
    const lastBackfilledAt = new Date("2026-06-26T12:00:00.000Z");
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          feed_url: "https://example.com/feed.xml",
          id: "feed-id",
          last_backfilled_at: lastBackfilledAt,
          site_url: "https://example.com",
          title: "Example Feed"
        }
      ]
    });
    const pool = { query } as unknown as Pool;

    await expect(getFeedBackfillTarget(pool, "feed-id")).resolves.toEqual({
      feedUrl: "https://example.com/feed.xml",
      id: "feed-id",
      lastBackfilledAt,
      siteUrl: "https://example.com",
      title: "Example Feed"
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("last_backfilled_at"), [
      "feed-id"
    ]);
  });
});

describe("getFolderBackfillTarget", () => {
  it("resolves a folder by id or exact title and returns all assigned feeds", async () => {
    const lastBackfilledAt = new Date("2026-06-26T12:00:00.000Z");
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: "folder-id", title: "youtube" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=one",
            id: "feed-one",
            last_backfilled_at: lastBackfilledAt,
            site_url: "https://www.youtube.com/channel/one",
            title: "One"
          },
          {
            feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=two",
            id: "feed-two",
            last_backfilled_at: null,
            site_url: null,
            title: null
          }
        ]
      });
    const pool = { query } as unknown as Pool;

    await expect(getFolderBackfillTarget(pool, "youtube")).resolves.toEqual({
      feeds: [
        {
          feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=one",
          id: "feed-one",
          lastBackfilledAt,
          siteUrl: "https://www.youtube.com/channel/one",
          title: "One"
        },
        {
          feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=two",
          id: "feed-two",
          lastBackfilledAt: null,
          siteUrl: null,
          title: null
        }
      ],
      id: "folder-id",
      title: "youtube"
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("where folder_id = $1"),
      ["folder-id"]
    );
  });

  it("returns null when the folder does not exist", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Pool;

    await expect(getFolderBackfillTarget(pool, "missing")).resolves.toBeNull();
  });

  it("rejects ambiguous exact folder titles", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: "folder-one", title: "youtube" },
          { id: "folder-two", title: "youtube" }
        ]
      })
    } as unknown as Pool;

    await expect(getFolderBackfillTarget(pool, "youtube")).rejects.toThrow(
      'Folder title "youtube" is ambiguous'
    );
  });
});

describe("recordFeedBackfillComplete", () => {
  it("marks a feed as backfilled", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "feed-id" }]
    });
    const pool = { query } as unknown as Pool;

    await recordFeedBackfillComplete(pool, "feed-id");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("last_backfilled_at = now()"), [
      "feed-id"
    ]);
  });

  it("rejects when the feed disappears before marking completion", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] })
    } as unknown as Pool;

    await expect(recordFeedBackfillComplete(pool, "missing")).rejects.toThrow(
      "Backfill target feed missing was not found"
    );
  });
});
