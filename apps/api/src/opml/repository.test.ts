import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { importFeedsFromOpml, listFeedsForOpmlExport } from "./repository.js";

describe("opml repository", () => {
  it("imports feeds transactionally, caches folders, and counts created/skipped rows", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // begin
      .mockResolvedValueOnce({ rows: [] }) // folder lookup
      .mockResolvedValueOnce({ rows: [{ id: "folder-1" }] }) // folder insert
      .mockResolvedValueOnce({ rowCount: 1 }) // feed insert created
      .mockResolvedValueOnce({ rowCount: 0 }) // feed insert skipped
      .mockResolvedValueOnce({ rowCount: 1 }) // ungrouped feed created
      .mockResolvedValueOnce({}); // commit
    const releaseMock = vi.fn();
    const client = {
      query: queryMock,
      release: releaseMock
    } as unknown as PoolClient;
    const connectMock = vi.fn().mockResolvedValue(client);
    const pool = {
      connect: connectMock
    } as unknown as Pool;

    const result = await importFeedsFromOpml(pool, [
      {
        feedUrl: "https://example.com/one.xml",
        folderTitle: "Tech",
        siteUrl: "https://example.com/one",
        title: "One"
      },
      {
        feedUrl: "https://example.com/one.xml",
        folderTitle: "Tech",
        siteUrl: "https://example.com/one-dup",
        title: "One Dup"
      },
      {
        feedUrl: "https://example.com/two.xml",
        folderTitle: null,
        siteUrl: null,
        title: "Two"
      }
    ]);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      createdFeedCount: 2,
      createdFolderCount: 1,
      skippedFeedCount: 1
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);

    const sqlCalls = queryMock.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.filter((sql) => sql.includes("where title = $1")).length).toBe(1);
    expect(sqlCalls.filter((sql) => sql.includes("insert into folders")).length).toBe(1);
    expect(sqlCalls.filter((sql) => sql.includes("insert into feeds")).length).toBe(3);
    expect(sqlCalls.at(-1)).toBe("commit");
  });

  it("rolls back and releases client when import fails", async () => {
    const importError = new Error("insert failed");
    const queryMock = vi.fn(async (sql: string) => {
      if (sql === "begin") {
        return {};
      }

      if (sql.includes("insert into feeds")) {
        throw importError;
      }

      if (sql === "rollback") {
        return {};
      }

      return {};
    });
    const releaseMock = vi.fn();
    const client = {
      query: queryMock,
      release: releaseMock
    } as unknown as PoolClient;
    const pool = {
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool;

    await expect(
      importFeedsFromOpml(pool, [
        {
          feedUrl: "https://example.com/fail.xml",
          folderTitle: null,
          siteUrl: null,
          title: "Fail"
        }
      ])
    ).rejects.toThrow("insert failed");

    const sqlCalls = queryMock.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls).toContain("begin");
    expect(sqlCalls).toContain("rollback");
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("lists exportable feeds and maps db rows", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          feed_url: "https://example.com/a.xml",
          folder_title: "News",
          id: "00000000-0000-0000-0000-000000000111",
          is_paused: false,
          site_url: "https://example.com/a",
          title: "Feed A"
        },
        {
          feed_url: "https://example.com/b.xml",
          folder_title: null,
          id: "00000000-0000-0000-0000-000000000112",
          is_paused: true,
          site_url: null,
          title: null
        }
      ]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const feeds = await listFeedsForOpmlExport(pool);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("order by folders.position asc nulls first");
    expect(feeds).toEqual([
      {
        feedUrl: "https://example.com/a.xml",
        folderTitle: "News",
        isPaused: false,
        siteUrl: "https://example.com/a",
        title: "Feed A"
      },
      {
        feedUrl: "https://example.com/b.xml",
        folderTitle: null,
        isPaused: true,
        siteUrl: null,
        title: null
      }
    ]);
  });
});
