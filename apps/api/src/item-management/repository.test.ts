import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listItems, updateItemState } from "./repository.js";

describe("item-management repository", () => {
  it("builds filter/search query and returns mapped items with next cursor", async () => {
    const rowOne = buildItemRow({
      id: "00000000-0000-0000-0000-000000000111",
      publishedAt: "2026-04-25T10:00:00.000Z",
      title: "New deploy notes"
    });
    const rowTwo = buildItemRow({
      id: "00000000-0000-0000-0000-000000000110",
      publishedAt: "2026-04-24T10:00:00.000Z",
      title: "Incident report"
    });
    const rowThree = buildItemRow({
      id: "00000000-0000-0000-0000-000000000109",
      publishedAt: null,
      title: "No date"
    });

    const queryMock = vi.fn().mockResolvedValue({
      rows: [rowOne, rowTwo, rowThree]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const result = await listItems(pool, {
      cursor: null,
      feedId: "00000000-0000-0000-0000-000000000001",
      folderId: "00000000-0000-0000-0000-000000000002",
      limit: 2,
      query: "deploy",
      read: false,
      starred: true
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain("items.feed_id = $1");
    expect(sql).toContain("feeds.folder_id = $2");
    expect(sql).toContain("items.is_read = $3");
    expect(sql).toContain("items.is_starred = $4");
    expect(sql).toContain("plainto_tsquery('simple', $5)");
    expect(sql).toContain("limit $6");
    expect(values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      false,
      true,
      "deploy",
      3
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.id).toBe(rowOne.id);
    expect(result.items[1]?.id).toBe(rowTwo.id);
    expect(result.nextCursor).not.toBeNull();

    const decodedCursor = JSON.parse(
      Buffer.from(result.nextCursor ?? "", "base64url").toString("utf8")
    ) as { id: string; publishedAt: string | null };
    expect(decodedCursor.id).toBe(rowTwo.id);
    expect(decodedCursor.publishedAt).toBe("2026-04-24T10:00:00.000Z");
  });

  it("applies cursor condition when cursor has publishedAt", async () => {
    const cursorPayload = {
      id: "00000000-0000-0000-0000-000000000010",
      publishedAt: "2026-04-22T09:00:00.000Z"
    };
    const cursor = Buffer.from(JSON.stringify(cursorPayload), "utf8").toString(
      "base64url"
    );
    const queryMock = vi.fn().mockResolvedValue({
      rows: [buildItemRow({ id: "00000000-0000-0000-0000-000000000009" })]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    await listItems(pool, {
      cursor,
      feedId: null,
      folderId: null,
      limit: 1,
      query: null,
      read: null,
      starred: null
    });

    const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("items.published_at < $1::timestamptz");
    expect(sql).toContain("items.id < $2");
    expect(sql).toContain("limit $3");
    expect(values).toEqual([cursorPayload.publishedAt, cursorPayload.id, 2]);
  });

  it("ignores malformed cursor input and still returns data", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [buildItemRow({ id: "00000000-0000-0000-0000-000000000019" })]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const result = await listItems(pool, {
      cursor: "not-valid-base64url",
      feedId: null,
      folderId: null,
      limit: 1,
      query: null,
      read: null,
      starred: null
    });

    const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("items.published_at <");
    expect(values).toEqual([2]);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("updates item state and maps row response", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        buildItemRow({
          id: "00000000-0000-0000-0000-000000000201",
          isRead: true,
          isStarred: false
        })
      ]
    });
    const pool = {
      query: queryMock
    } as unknown as Pool;

    const updated = await updateItemState(pool, "00000000-0000-0000-0000-000000000201", {
      isRead: true,
      isStarred: null
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(values).toEqual([
      "00000000-0000-0000-0000-000000000201",
      true,
      null
    ]);

    expect(updated).not.toBeNull();
    expect(updated?.id).toBe("00000000-0000-0000-0000-000000000201");
    expect(updated?.isRead).toBe(true);
    expect(updated?.isStarred).toBe(false);
  });

  it("returns null when update target item does not exist", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Pool;

    await expect(
      updateItemState(pool, "00000000-0000-0000-0000-000000000999", {
        isRead: null,
        isStarred: true
      })
    ).resolves.toBeNull();
  });
});

function buildItemRow(input?: {
  id?: string;
  isRead?: boolean;
  isStarred?: boolean;
  publishedAt?: string | null;
  title?: string | null;
}): {
  id: string;
  feed_id: string;
  feed_title: string | null;
  title: string | null;
  url: string | null;
  author: string | null;
  summary_text: string | null;
  content_html: string | null;
  published_at: Date | null;
  is_read: boolean;
  is_starred: boolean;
  created_at: Date;
} {
  const publishedAtInput =
    input && "publishedAt" in input ? input.publishedAt : "2026-04-25T00:00:00.000Z";

  return {
    author: "alice",
    content_html: "<p>body</p>",
    created_at: new Date("2026-04-25T12:00:00.000Z"),
    feed_id: "00000000-0000-0000-0000-000000000001",
    feed_title: "Feed title",
    id: input?.id ?? "00000000-0000-0000-0000-000000000001",
    is_read: input?.isRead ?? false,
    is_starred: input?.isStarred ?? true,
    published_at: publishedAtInput ? new Date(publishedAtInput) : null,
    summary_text: "summary",
    title: input?.title ?? "Title",
    url: "https://example.com/post"
  };
}
