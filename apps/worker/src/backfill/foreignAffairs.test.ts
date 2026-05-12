import { describe, expect, it } from "vitest";

import { parseFeedDocument } from "../fetch/normalize.js";
import {
  parseForeignAffairsArticle,
  parseForeignAffairsTaxonomies,
  parseForeignAffairsTaxonomyPage,
  resolveForeignAffairsRootUrl
} from "./foreignAffairs.js";

const sourceTaxonomy = {
  slug: "geopolitics",
  title: "Geopolitics",
  type: "topic" as const,
  url: "https://www.foreignaffairs.com/topics/geopolitics"
};

describe("parseForeignAffairsTaxonomies", () => {
  it("discovers topic and tag links from the topics index", () => {
    const result = parseForeignAffairsTaxonomies(
      `
      <html>
        <body>
          <a href="/topics/geopolitics">Geopolitics</a>
          <a href="/topics/us-foreign-policy">U.S. Foreign Policy</a>
          <a href="/tags/artificial-intelligence">Artificial Intelligence</a>
          <a href="/authors/example">Example Author</a>
        </body>
      </html>`,
      "https://www.foreignaffairs.com/topics-tags"
    );

    expect(result).toEqual([
      {
        slug: "artificial-intelligence",
        title: "Artificial Intelligence",
        type: "tag",
        url: "https://www.foreignaffairs.com/tags/artificial-intelligence"
      },
      {
        slug: "geopolitics",
        title: "Geopolitics",
        type: "topic",
        url: "https://www.foreignaffairs.com/topics/geopolitics"
      },
      {
        slug: "us-foreign-policy",
        title: "U.S. Foreign Policy",
        type: "topic",
        url: "https://www.foreignaffairs.com/topics/us-foreign-policy"
      }
    ]);
  });
});

describe("parseForeignAffairsTaxonomyPage", () => {
  it("extracts article URLs and follows query pagination", () => {
    const result = parseForeignAffairsTaxonomyPage(
      `
      <html>
        <head><title>Geopolitics | Foreign Affairs</title></head>
        <body>
          <a href="/united-states/china-squandering-golden-opportunity-david-shambaugh">Article</a>
          <a href="/authors/david-shambaugh">Author</a>
          <a href="/browse/essay">Essay</a>
          <a href="/reviews/are-america-and-china-condemned-repeat-history-samet">Review</a>
          <nav>
            <a href="?page=0">1</a>
            <a href="?page=1">2</a>
            <a href="?page=28">Last</a>
          </nav>
        </body>
      </html>`,
      "https://www.foreignaffairs.com/topics/geopolitics"
    );

    expect(result).toEqual({
      articleUrls: [
        "https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh",
        "https://www.foreignaffairs.com/reviews/are-america-and-china-condemned-repeat-history-samet"
      ],
      nextPageUrl: "https://www.foreignaffairs.com/topics/geopolitics?page=1",
      pageNumber: 0,
      taxonomyTitle: "Geopolitics"
    });
  });

  it("stops when the next page link is missing", () => {
    const result = parseForeignAffairsTaxonomyPage(
      `
      <html>
        <body>
          <a href="/united-states/china-squandering-golden-opportunity-david-shambaugh">Article</a>
          <a href="?page=27">Previous</a>
          <a href="?page=28">Current</a>
        </body>
      </html>`,
      "https://www.foreignaffairs.com/topics/geopolitics?page=28"
    );

    expect(result.nextPageUrl).toBeNull();
  });
});

describe("parseForeignAffairsArticle", () => {
  it("normalizes article metadata with RSS-compatible Drupal node IDs", () => {
    const item = parseForeignAffairsArticle(
      `
      <html>
        <head>
          <script>
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push({"nodedatalayer":"1134942","content_type_dl":"Article","authorsdl":"David Shambaugh and Steven F. Jackson","articletypedl":"essay","regiontagdl":["United States","China"],"topictagdl":["Diplomacy","Geopolitics"],"customtagdl":["U.S.-Chinese Relations","Xi Jinping"],"postdate_dl":"2026-05-12","paywallstdl":"Paywall Free"});
          </script>
          <meta name="description" content="Why Beijing has failed to exploit Trump’s missteps," />
          <link rel="shortlink" href="https://www.foreignaffairs.com/node/1134942" />
          <link rel="canonical" href="https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh" />
          <meta property="og:title" content="China Is Squandering a Golden Opportunity" />
          <meta property="og:image" content="https://cdn-live.foreignaffairs.com/image.jpg" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="article:author" content="David Shambaugh" />
          <meta property="article:author" content="Steven F. Jackson" />
          <meta property="article:published_time" content="2026-05-12T00:00:00-04:00" />
          <meta property="article:modified_time" content="2026-05-12T00:36:14-04:00" />
        </head>
      </html>`,
      "https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh",
      "feed-id",
      {
        sourcePageUrl: "https://www.foreignaffairs.com/topics/geopolitics",
        taxonomy: sourceTaxonomy
      }
    );

    expect(item).toEqual(
      expect.objectContaining({
        author: "David Shambaugh, Steven F. Jackson",
        guid: "1134942",
        publishedAt: "2026-05-12T04:00:00.000Z",
        rawExtensionData: {
          foreignAffairs: {
            articleType: "essay",
            backfilledFrom: "https://www.foreignaffairs.com/topics/geopolitics",
            image: {
              height: 630,
              url: "https://cdn-live.foreignaffairs.com/image.jpg",
              width: 1200
            },
            modifiedAt: "2026-05-12T04:36:14.000Z",
            nodeId: "1134942",
            paywallStatus: "Paywall Free",
            regions: ["United States", "China"],
            sourceTaxonomy,
            tags: ["U.S.-Chinese Relations", "Xi Jinping"],
            topics: ["Diplomacy", "Geopolitics"]
          }
        },
        summaryText: "Why Beijing has failed to exploit Trump’s missteps,",
        title: "China Is Squandering a Golden Opportunity",
        url: "https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh"
      })
    );
  });

  it("matches normal RSS dedupe keys", () => {
    const backfilled = parseForeignAffairsArticle(
      `
      <html>
        <head>
          <link rel="shortlink" href="https://www.foreignaffairs.com/node/1134942" />
          <link rel="canonical" href="https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh" />
          <meta property="og:title" content="China Is Squandering a Golden Opportunity" />
          <meta property="article:published_time" content="2026-05-12T00:00:00-04:00" />
        </head>
      </html>`,
      "https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh",
      "feed-id",
      {
        sourcePageUrl: "https://www.foreignaffairs.com/topics/geopolitics",
        taxonomy: sourceTaxonomy
      }
    );
    const rss = parseFeedDocument(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>FA RSS</title>
          <link>https://www.foreignaffairs.com/</link>
          <item>
            <title>China Is Squandering a Golden Opportunity</title>
            <link>https://www.foreignaffairs.com/united-states/china-squandering-golden-opportunity-david-shambaugh</link>
            <description>Why Beijing has failed to exploit Trump’s missteps,</description>
            <pubDate>Tue, 12 May 2026 00:00:00 -0400</pubDate>
            <guid isPermaLink="false">1134942</guid>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(backfilled?.dedupeKey).toBe(rss.items[0]?.dedupeKey);
  });
});

describe("resolveForeignAffairsRootUrl", () => {
  it("resolves feed URLs to the site root", () => {
    expect(resolveForeignAffairsRootUrl("https://www.foreignaffairs.com/rss.xml").toString()).toBe(
      "https://www.foreignaffairs.com/"
    );
  });
});
