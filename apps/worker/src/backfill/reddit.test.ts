import { describe, expect, it } from "vitest";

import { parseFeedDocument } from "../fetch/normalize.js";
import {
  buildRedditListingJsonUrl,
  isRedditListingUrl,
  normalizeRedditPost,
  parseRedditListingPage
} from "./reddit.js";

describe("buildRedditListingJsonUrl", () => {
  it("builds old Reddit JSON listing URLs from RSS URLs", () => {
    expect(buildRedditListingJsonUrl("https://old.reddit.com/r/ethereum/new/.rss")).toBe(
      "https://old.reddit.com/r/ethereum/new/.json?limit=100"
    );
  });

  it("adds after cursor pagination", () => {
    expect(buildRedditListingJsonUrl("https://old.reddit.com/r/ethereum/new/.rss", "t3_next")).toBe(
      "https://old.reddit.com/r/ethereum/new/.json?limit=100&after=t3_next"
    );
  });

  it("defaults subreddit feeds without a sort path to new", () => {
    expect(buildRedditListingJsonUrl("https://old.reddit.com/r/ethereum/.rss")).toBe(
      "https://old.reddit.com/r/ethereum/new/.json?limit=100"
    );
  });
});

describe("parseRedditListingPage", () => {
  it("parses posts and builds next page URLs from the after cursor", () => {
    const result = parseRedditListingPage(
      JSON.stringify({
        data: {
          after: "t3_after",
          children: [
            {
              kind: "t3",
              data: {
                author: "Syed_Abdullah_",
                created_utc: 1778427654,
                domain: "self.ethereum",
                id: "1t9abbb",
                is_self: true,
                name: "t3_1t9abbb",
                num_comments: 12,
                permalink: "/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/",
                score: 5,
                selftext: "Hello & goodbye",
                selftext_html:
                  "&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Hello &amp;amp; goodbye&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt;",
                subreddit: "ethereum",
                subreddit_name_prefixed: "r/ethereum",
                title: "Whats next after learning solidity ?",
                url: "https://old.reddit.com/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/"
              }
            }
          ]
        },
        kind: "Listing"
      }),
      "https://old.reddit.com/r/ethereum/new/.json?limit=100",
      "feed-id"
    );

    expect(result).toEqual(
      expect.objectContaining({
        after: "t3_after",
        itemCount: 1,
        nextPageUrl: "https://old.reddit.com/r/ethereum/new/.json?limit=100&after=t3_after",
        subreddit: "ethereum"
      })
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        author: "/u/Syed_Abdullah_",
        contentHtml:
          '<!-- SC_OFF --><div class="md"><p>Hello &amp; goodbye</p></div><!-- SC_ON --><p><a href="https://old.reddit.com/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/">comments</a></p>',
        guid: "t3_1t9abbb",
        publishedAt: "2026-05-10T15:40:54.000Z",
        summaryText: "Hello & goodbye",
        title: "Whats next after learning solidity ?",
        url: "https://old.reddit.com/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/"
      })
    );
    expect(result.items[0]?.rawExtensionData).toEqual({
      reddit: expect.objectContaining({
        name: "t3_1t9abbb",
        numComments: 12,
        score: 5,
        subreddit: "ethereum",
        subredditNamePrefixed: "r/ethereum"
      })
    });
  });
});

describe("normalizeRedditPost", () => {
  it("matches old Reddit RSS dedupe keys", () => {
    const backfilled = normalizeRedditPost(
      {
        author: "Syed_Abdullah_",
        created_utc: 1778427654,
        id: "1t9abbb",
        name: "t3_1t9abbb",
        permalink: "/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/",
        title: "Whats next after learning solidity ?",
        url: "https://old.reddit.com/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/"
      },
      "https://old.reddit.com/r/ethereum/new/.json?limit=100",
      "feed-id"
    );
    const rss = parseFeedDocument(
      `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>new on ethereum</title>
        <entry>
          <id>t3_1t9abbb</id>
          <title>Whats next after learning solidity ?</title>
          <link href="https://old.reddit.com/r/ethereum/comments/1t9abbb/whats_next_after_learning_solidity/" />
          <published>2026-05-10T15:40:54+00:00</published>
          <author>
            <name>/u/Syed_Abdullah_</name>
          </author>
        </entry>
      </feed>`,
      "feed-id"
    );

    expect(backfilled?.dedupeKey).toBe(rss.items[0]?.dedupeKey);
  });
});

describe("isRedditListingUrl", () => {
  it("matches old Reddit subreddit feeds", () => {
    expect(isRedditListingUrl("https://old.reddit.com/r/ethereum/new/.rss")).toBe(true);
    expect(isRedditListingUrl("https://example.com/r/ethereum/new/.rss")).toBe(false);
    expect(isRedditListingUrl("https://old.reddit.com/r/ethereum/comments/1t9abbb/post/")).toBe(false);
  });
});
