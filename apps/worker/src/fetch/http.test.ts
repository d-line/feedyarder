import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchFeedDocument } from "./http.js";
import type { DueFeed } from "./types.js";

const workerConfig = {
  FETCH_TOTAL_TIMEOUT_MS: 1_000
};

describe("fetchFeedDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends HTTP Basic auth when feed credentials are configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<rss />", {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchFeedDocument(
      buildDueFeed({
        authPassword: "secret",
        authUsername: "reader"
      }),
      workerConfig
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;

    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("reader:secret", "utf8").toString("base64")}`
    );
  });

  it("omits HTTP Basic auth when feed credentials are not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<rss />", {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchFeedDocument(buildDueFeed(), workerConfig);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;

    expect(headers.authorization).toBeUndefined();
  });
});

function buildDueFeed(overrides: Partial<DueFeed> = {}): DueFeed {
  return {
    authPassword: null,
    authUsername: null,
    consecutiveErrorCount: 0,
    etag: null,
    feedUrl: "https://example.com/feed.xml",
    fetchIntervalMinutes: 60,
    id: "00000000-0000-0000-0000-000000000101",
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastModified: null,
    status: "active",
    title: "Example",
    ...overrides
  };
}
