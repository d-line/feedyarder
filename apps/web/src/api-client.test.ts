import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  createFolder,
  exportOpml,
  fetchCurrentUser,
  getApiErrorMessage,
  listFolders,
  listItems
} from "./api-client.js";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

describe("api-client", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds list-items query params and uses cookie credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        items: [],
        nextCursor: null
      })
    );

    await listItems({
      cursor: "cursor-1",
      feedId: "feed-1",
      folderId: "folder-1",
      limit: 20,
      q: "search term",
      read: false,
      starred: true
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [urlArg, initArg] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(urlArg));

    expect(url.origin).toBe("http://localhost:3001");
    expect(url.pathname).toBe("/items");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("cursor")).toBe("cursor-1");
    expect(url.searchParams.get("feedId")).toBe("feed-1");
    expect(url.searchParams.get("folderId")).toBe("folder-1");
    expect(url.searchParams.get("q")).toBe("search term");
    expect(url.searchParams.get("read")).toBe("false");
    expect(url.searchParams.get("starred")).toBe("true");
    expect(initArg?.credentials).toBe("include");
  });

  it("sends json body and content type for mutating requests", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        createdAt: "2026-04-25T00:00:00.000Z",
        id: "ce04f2f4-2fb2-4f77-a86e-b0d220980a3a",
        position: 1,
        title: "Folder A"
      })
    );

    await createFolder({
      position: 1,
      title: "Folder A"
    });

    const [, initArg] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(initArg?.headers);

    expect(initArg?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(initArg?.body).toBe(JSON.stringify({ position: 1, title: "Folder A" }));
  });

  it("returns null for not-authenticated current-user response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        error: {
          code: "not_authenticated",
          message: "Authentication required"
        }
      })
    );

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("rethrows non-auth current-user errors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        error: {
          code: "internal_error",
          message: "boom"
        }
      })
    );

    await expect(fetchCurrentUser()).rejects.toMatchObject({
      error: {
        code: "internal_error",
        message: "boom"
      }
    });
  });

  it("validates successful payloads against schemas", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, [
        {
          id: "not-a-uuid",
          title: "Folder A"
        }
      ])
    );

    await expect(listFolders()).rejects.toMatchObject({
      name: "ZodError"
    });
  });

  it("exports opml as raw text", async () => {
    fetchMock.mockResolvedValue(new Response("<opml></opml>", { status: 200 }));

    await expect(exportOpml()).resolves.toBe("<opml></opml>");
  });

  it("maps api error object messages", () => {
    expect(
      getApiErrorMessage({
        error: {
          code: "x",
          message: "bad request"
        }
      })
    ).toBe("bad request");
    expect(getApiErrorMessage(new Error("network down"))).toBe("network down");
    expect(getApiErrorMessage("something")).toBe("Unexpected error.");
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}
