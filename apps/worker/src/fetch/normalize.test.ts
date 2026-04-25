import { describe, expect, it } from "vitest";

import { parseFeedDocument } from "./normalize.js";

describe("parseFeedDocument", () => {
  it("parses basic RSS feeds", () => {
    const result = parseFeedDocument(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Example RSS</title>
          <link>https://example.com</link>
          <item>
            <guid>item-1</guid>
            <title>Hello world</title>
            <link>https://example.com/posts/1</link>
            <pubDate>Fri, 24 Apr 2026 10:00:00 GMT</pubDate>
            <description>Summary</description>
            <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`,
      "feed-1"
    );

    expect(result.title).toBe("Example RSS");
    expect(result.siteUrl).toBe("https://example.com/");
    expect(result.faviconUrl).toBe("https://example.com/favicon.ico");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.guid).toBe("item-1");
    expect(result.items[0]?.url).toBe("https://example.com/posts/1");
    expect(result.items[0]?.publishedAt).toBe("2026-04-24T10:00:00.000Z");
    expect(result.missingPublishedAtCount).toBe(0);
  });

  it("parses basic Atom feeds", () => {
    const result = parseFeedDocument(
      `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Example Atom</title>
        <link rel="alternate" href="https://example.org/" />
        <entry>
          <id>tag:example.org,2026:1</id>
          <title>Atom entry</title>
          <link href="https://example.org/posts/1" />
          <updated>2026-04-24T10:00:00Z</updated>
          <summary>Summary</summary>
        </entry>
      </feed>`,
      "feed-2"
    );

    expect(result.title).toBe("Example Atom");
    expect(result.siteUrl).toBe("https://example.org/");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.guid).toBe("tag:example.org,2026:1");
    expect(result.items[0]?.publishedAt).toBe("2026-04-24T10:00:00.000Z");
  });

  it("counts missing published dates", () => {
    const result = parseFeedDocument(
      `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Example RSS</title>
          <link>https://example.com</link>
          <item>
            <title>No date</title>
            <link>https://example.com/posts/2</link>
          </item>
        </channel>
      </rss>`,
      "feed-3"
    );

    expect(result.items[0]?.publishedAt).toBeNull();
    expect(result.missingPublishedAtCount).toBe(1);
  });
});
