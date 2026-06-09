import { describe, expect, it, vi } from "vitest";

import { discoverFeeds, FeedDiscoveryError } from "./discovery.js";

describe("feed discovery", () => {
  it("discovers, resolves, and deduplicates advertised feed links", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      responseWithUrl(
        `
          <!doctype html>
          <html>
            <head>
              <base href="/content/">
              <link rel="alternate" type="application/rss+xml" title="Main RSS" href="../feed.xml">
              <link rel="ALTERNATE stylesheet" type="application/atom+xml; charset=utf-8" href="atom.xml">
              <link rel="alternate" type="application/rss+xml" href="../feed.xml">
              <link rel="alternate" type="text/html" href="/archive">
              <link rel="alternate" type="application/rss+xml" href="mailto:feeds@example.com">
            </head>
          </html>
        `,
        "https://example.com/articles/index.html"
      )
    );

    await expect(discoverFeeds("https://example.com/start", fetchMock)).resolves.toEqual({
      feeds: [
        {
          feedUrl: "https://example.com/feed.xml",
          title: "Main RSS",
          type: "application/rss+xml"
        },
        {
          feedUrl: "https://example.com/content/atom.xml",
          title: null,
          type: "application/atom+xml"
        }
      ],
      siteUrl: "https://example.com/articles/index.html"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://example.com/start"),
      expect.objectContaining({
        redirect: "follow"
      })
    );
  });

  it("returns an empty result when the page advertises no feeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseWithUrl("<html><head></head></html>", "https://example.com/"));

    await expect(discoverFeeds("https://example.com", fetchMock)).resolves.toEqual({
      feeds: [],
      siteUrl: "https://example.com/"
    });
  });

  it("rejects non-http URLs before fetching", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(discoverFeeds("file:///tmp/page.html", fetchMock)).rejects.toMatchObject({
      code: "unsupported_discovery_url",
      status: 400
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps remote HTTP failures to a discovery error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(discoverFeeds("https://example.com", fetchMock)).rejects.toEqual(
      new FeedDiscoveryError(
        502,
        "feed_discovery_http_error",
        "The webpage returned HTTP 404."
      )
    );
  });

  it("maps response stream failures to a discovery fetch error", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection closed"));
      }
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));

    await expect(discoverFeeds("https://example.com", fetchMock)).rejects.toMatchObject({
      code: "feed_discovery_fetch_failed",
      status: 502
    });
  });

  it("rejects documents larger than the discovery limit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        headers: {
          "content-length": String(2 * 1024 * 1024 + 1)
        }
      })
    );

    await expect(discoverFeeds("https://example.com", fetchMock)).rejects.toMatchObject({
      code: "feed_discovery_page_too_large",
      status: 422
    });
  });
});

function responseWithUrl(body: string, url: string): Response {
  const response = new Response(body, {
    headers: {
      "content-type": "text/html"
    }
  });

  Object.defineProperty(response, "url", {
    value: url
  });

  return response;
}
