import { describe, expect, it } from "vitest";

import { parseFeedDocument } from "../fetch/normalize.js";
import {
  buildSubstackArchiveApiUrl,
  normalizeSubstackPost,
  parseSubstackArchivePage,
  resolveSubstackRootUrl
} from "./substack.js";

describe("parseSubstackArchivePage", () => {
  it("parses offset pagination and builds the next archive API URL", () => {
    const result = parseSubstackArchivePage(
      JSON.stringify([
        {
          id: 196934399,
          slug: "video-unsafe-live-with-buck-sexton"
        },
        {
          id: 196476950,
          slug: "unsafe-live-5-stories-with-ann-coulter"
        }
      ]),
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=0&limit=2"
    );

    expect(result).toEqual({
      nextPageUrl:
        "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=2&limit=2",
      offset: 0,
      pageNumber: 1,
      posts: [
        {
          id: 196934399,
          slug: "video-unsafe-live-with-buck-sexton"
        },
        {
          id: 196476950,
          slug: "unsafe-live-5-stories-with-ann-coulter"
        }
      ]
    });
  });

  it("continues when Substack returns a partial non-empty page", () => {
    const result = parseSubstackArchivePage(
      JSON.stringify([
        {
          id: 196934399,
          slug: "video-unsafe-live-with-buck-sexton"
        }
      ]),
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=20&limit=50"
    );

    expect(result.nextPageUrl).toBe(
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=21&limit=50"
    );
  });

  it("stops when a page returns no rows", () => {
    const result = parseSubstackArchivePage(
      JSON.stringify([]),
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=10000&limit=50"
    );

    expect(result.nextPageUrl).toBeNull();
  });
});

describe("normalizeSubstackPost", () => {
  it("normalizes Substack post detail rows", () => {
    const item = normalizeSubstackPost(
      {
        audience: "everyone",
        body_html: "<p>Full post body.</p>",
        canonical_url: "https://anncoulter.substack.com/p/psst-we-only-believe-rape-hoaxes",
        cover_image: "https://substack-post-media.s3.amazonaws.com/public/images/example.png",
        description: "He might have won without the cannons.",
        id: 196698038,
        podcast_duration: 123,
        podcast_url: "https://api.substack.com/api/v1/audio/upload/example/src",
        post_date: "2026-05-06T20:20:10.819Z",
        publishedBylines: [
          {
            name: "Ann Coulter"
          }
        ],
        reactions: {
          "❤": 10
        },
        restacks: 2,
        slug: "psst-we-only-believe-rape-hoaxes",
        title: "PSST: WE ONLY BELIEVE RAPE HOAXES AGAINST MEN",
        type: "newsletter",
        videoUpload: {
          duration: 456,
          id: "video-upload-id"
        }
      },
      "feed-id",
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=0&limit=50",
      true
    );

    expect(item).toEqual(
      expect.objectContaining({
        author: "Ann Coulter",
        contentHtml: "<p>Full post body.</p>",
        guid: "https://anncoulter.substack.com/p/psst-we-only-believe-rape-hoaxes",
        publishedAt: "2026-05-06T20:20:10.819Z",
        rawExtensionData: {
          substack: {
            audience: "everyone",
            backfilledFrom:
              "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=0&limit=50",
            detailFetched: true,
            media: {
              coverImage: "https://substack-post-media.s3.amazonaws.com/public/images/example.png",
              podcastDuration: 123,
              podcastUrl: "https://api.substack.com/api/v1/audio/upload/example/src",
              videoDuration: 456,
              videoUploadId: "video-upload-id"
            },
            postId: "196698038",
            reactions: {
              "❤": 10
            },
            restacks: 2,
            slug: "psst-we-only-believe-rape-hoaxes",
            type: "newsletter"
          }
        },
        summaryText: "He might have won without the cannons.",
        title: "PSST: WE ONLY BELIEVE RAPE HOAXES AGAINST MEN",
        url: "https://anncoulter.substack.com/p/psst-we-only-believe-rape-hoaxes"
      })
    );
  });

  it("matches normal RSS dedupe keys", () => {
    const backfilled = normalizeSubstackPost(
      {
        canonical_url: "https://anncoulter.substack.com/p/video-unsafe-live-with-buck-sexton",
        id: 196934399,
        post_date: "2026-05-08T20:41:42.057Z",
        slug: "video-unsafe-live-with-buck-sexton",
        title: "VIDEO: UNSAFE LIVE - WITH BUCK SEXTON"
      },
      "feed-id",
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=0&limit=50",
      false
    );
    const rss = parseFeedDocument(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Unsafe</title>
          <link>https://anncoulter.substack.com</link>
          <item>
            <title>VIDEO: UNSAFE LIVE - WITH BUCK SEXTON</title>
            <link>https://anncoulter.substack.com/p/video-unsafe-live-with-buck-sexton</link>
            <guid isPermaLink="false">https://anncoulter.substack.com/p/video-unsafe-live-with-buck-sexton</guid>
            <pubDate>Fri, 08 May 2026 20:41:42 GMT</pubDate>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(backfilled?.dedupeKey).toBe(rss.items[0]?.dedupeKey);
  });
});

describe("buildSubstackArchiveApiUrl", () => {
  it("builds archive API URLs from Substack feed URLs", () => {
    expect(buildSubstackArchiveApiUrl("https://anncoulter.substack.com/feed", 50)).toBe(
      "https://anncoulter.substack.com/api/v1/archive?sort=new&search=&offset=50&limit=50"
    );
  });
});

describe("resolveSubstackRootUrl", () => {
  it("resolves Substack archive URLs to the publication root", () => {
    expect(resolveSubstackRootUrl("https://anncoulter.substack.com/archive").toString()).toBe(
      "https://anncoulter.substack.com/"
    );
  });
});
