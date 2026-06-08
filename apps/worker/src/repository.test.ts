import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { getFolderBackfillTarget } from "./repository.js";

describe("getFolderBackfillTarget", () => {
  it("resolves a folder by id or exact title and returns all assigned feeds", async () => {
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
            site_url: "https://www.youtube.com/channel/one",
            title: "One"
          },
          {
            feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=two",
            id: "feed-two",
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
          siteUrl: "https://www.youtube.com/channel/one",
          title: "One"
        },
        {
          feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=two",
          id: "feed-two",
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
