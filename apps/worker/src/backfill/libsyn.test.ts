import { describe, expect, it } from "vitest";

import {
  isFlossWeeklyLibsynUrl,
  parseLibsynArchivePage,
  parseLibsynRssOverrides,
  resolveFlossWeeklyLibsynArchiveUrl,
  resolveFlossWeeklyLibsynFeedUrl
} from "./libsyn.js";

describe("parseLibsynArchivePage", () => {
  it("normalizes PAGE_DATA items and follows simple archive pagination", () => {
    const overrides = new Map([
      [
        "41680145",
        {
          guid: "25d9013a-f251-4016-85ed-33d83b15af0a",
          publishedAt: "2026-06-17T18:26:00.000Z"
        }
      ]
    ]);
    const page = parseLibsynArchivePage(
      `
      <html>
        <head>
          <script>
            window.PAGE_DATA = {
              "show":{"show_id":499093,"title":"FLOSS Weekly","author":"Hackaday"},
              "destination_id":4272478,
              "items":[{
                "item_id":41680145,
                "premium_state":"free",
                "item_slug":"episode-871-rust-wont-save-you",
                "item_title":"Episode 871 - Rust Won't Save You",
                "release_date":"Jun 17, 2026",
                "item_body_clean":"This week Jonathan chats with Florian Gilcher.",
                "item_body":"<p>This week Jonathan chats with Florian Gilcher.</p>",
                "full_item_url":"https:\\/\\/flossweekly.libsyn.com\\/episode-871-rust-wont-save-you",
                "image_url":"https:\\/\\/assets.libsyn.com\\/secure\\/item\\/41680145",
                "primary_content":{
                  "file_class":"audio",
                  "content_type":"Standard",
                  "url_secure":"https:\\/\\/traffic.libsyn.com\\/secure\\/FLOSS-871.mp3?dest-id=4272478",
                  "content_title":null
                }
              }]
            };
          </script>
        </head>
      </html>`,
      "https://flossweekly.libsyn.com/",
      "feed-id",
      overrides
    );

    expect(page.pageNumber).toBe(1);
    expect(page.nextPageUrl).toBe("https://flossweekly.libsyn.com/page/2");
    expect(page.showId).toBe("499093");
    expect(page.title).toBe("FLOSS Weekly");
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        author: "Hackaday",
        guid: "25d9013a-f251-4016-85ed-33d83b15af0a",
        publishedAt: "2026-06-17T18:26:00.000Z",
        title: "Episode 871 - Rust Won't Save You",
        url: "https://flossweekly.libsyn.com/episode-871-rust-wont-save-you"
      })
    );
    expect(page.items[0]?.rawExtensionData.libsyn).toEqual(
      expect.objectContaining({
        destinationId: "4272478",
        itemId: "41680145",
        showId: "499093",
        slug: "episode-871-rust-wont-save-you",
        usedRssGuid: true
      })
    );
  });

  it("stops when a Libsyn archive page has no items", () => {
    const page = parseLibsynArchivePage(
      `
      <html>
        <head>
          <script>
            window.PAGE_DATA = {"show":{"show_id":499093,"title":"FLOSS Weekly"}};
          </script>
        </head>
      </html>`,
      "https://flossweekly.libsyn.com/page/999",
      "feed-id"
    );

    expect(page).toEqual({
      items: [],
      nextPageUrl: null,
      pageNumber: 999,
      showId: "499093",
      title: "FLOSS Weekly"
    });
  });

  it("uses Libsyn item IDs and date-only publication timestamps when RSS has no matching item", () => {
    const page = parseLibsynArchivePage(
      `
      <html>
        <head>
          <script>
            window.PAGE_DATA = {"show":{"show_id":499093,"title":"FLOSS Weekly"},"items":[{
              "item_id":39911285,
              "item_title":"Episode 862 - Have Your CAKE and Eat It Too",
              "release_date":"Jan 28, 2026",
              "full_item_url":"https:\\/\\/flossweekly.libsyn.com\\/episode-862-have-your-cake-and-eat-it-too"
            }]};
          </script>
        </head>
      </html>`,
      "https://flossweekly.libsyn.com/page/2",
      "feed-id"
    );

    expect(page.items[0]).toEqual(
      expect.objectContaining({
        guid: "libsyn:item:39911285",
        publishedAt: "2026-01-28T00:00:00.000Z"
      })
    );
  });
});

describe("parseLibsynRssOverrides", () => {
  it("indexes current RSS audio GUIDs by Libsyn item id", () => {
    const overrides = parseLibsynRssOverrides(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:libsyn="https://rss.libsyn.com/ns.xml">
        <channel>
          <title>FLOSS Weekly</title>
          <item>
            <title>Episode 871 transcript</title>
            <pubDate>Wed, 17 Jun 2026 18:26:00 +0000</pubDate>
            <guid isPermaLink="false">transcript-guid</guid>
            <link>https://b27a1a7a-dbb9-4922-ac3e-601e2d6ca1e1.libsyn.com/episode-871-transcript</link>
            <libsyn:item-id>41680145</libsyn:item-id>
          </item>
          <item>
            <title>Episode 871 transcript</title>
            <pubDate>Wed, 17 Jun 2026 18:26:00 +0000</pubDate>
            <guid isPermaLink="false">25d9013a-f251-4016-85ed-33d83b15af0a</guid>
            <link>https://b27a1a7a-dbb9-4922-ac3e-601e2d6ca1e1.libsyn.com/episode-871-transcript</link>
            <enclosure url="https://traffic.libsyn.com/FLOSS-871.mp3" length="123" type="audio/mpeg" />
            <libsyn:item-id>41680145</libsyn:item-id>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(overrides.get("41680145")).toEqual({
      guid: "25d9013a-f251-4016-85ed-33d83b15af0a",
      publishedAt: "2026-06-17T18:26:00.000Z"
    });
  });
});

describe("FLOSS Weekly Libsyn URL helpers", () => {
  it("recognizes archive and feed URLs", () => {
    expect(resolveFlossWeeklyLibsynArchiveUrl("https://flossweekly.libsyn.com/page/2").toString()).toBe(
      "https://flossweekly.libsyn.com/"
    );
    expect(resolveFlossWeeklyLibsynArchiveUrl("http://feeds.libsyn.com/499093/rss").toString()).toBe(
      "https://flossweekly.libsyn.com/"
    );
    expect(resolveFlossWeeklyLibsynFeedUrl("https://flossweekly.libsyn.com").toString()).toBe(
      "https://feeds.libsyn.com/499093/rss"
    );
    expect(isFlossWeeklyLibsynUrl("https://example.com/rss")).toBe(false);
  });
});
