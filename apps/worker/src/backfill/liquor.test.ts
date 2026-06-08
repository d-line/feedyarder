import { afterEach, describe, expect, it, vi } from "vitest";

import { parseFeedDocument } from "../fetch/normalize.js";
import {
  buildLiquorRequestHeaders,
  fetchLiquorSitemap,
  isPotentialLiquorArticleUrl,
  parseLiquorArticle,
  parseLiquorSitemap,
  parseLiquorTaxonomyPage,
  resolveLiquorRootUrl
} from "./liquor.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Liquor.com request configuration", () => {
  it("accepts a raw cf_clearance value", () => {
    expect(
      buildLiquorRequestHeaders({
        LIQUOR_BACKFILL_COOKIE: "clearance-value",
        LIQUOR_BACKFILL_USER_AGENT: "Matching Browser UA"
      })
    ).toEqual(
      expect.objectContaining({
        cookie: "cf_clearance=clearance-value",
        "user-agent": "Matching Browser UA"
      })
    );
  });

  it("preserves a complete browser Cookie header", () => {
    expect(
      buildLiquorRequestHeaders({
        LIQUOR_BACKFILL_COOKIE:
          "cf_clearance=clearance-value; __cf_bm=browser-session"
      }).cookie
    ).toBe("cf_clearance=clearance-value; __cf_bm=browser-session");
  });

  it("identifies Unicode copied into the cookie value", () => {
    expect(() =>
      buildLiquorRequestHeaders({
        LIQUOR_BACKFILL_COOKIE: `cf_clearance=value${String.fromCodePoint(10003)}`
      })
    ).toThrow(
      'LIQUOR_BACKFILL_COOKIE contains non-header character "✓" (U+2713)'
    );
  });

  it("identifies Unicode copied into the user agent", () => {
    expect(() =>
      buildLiquorRequestHeaders({
        LIQUOR_BACKFILL_USER_AGENT: `Browser ${String.fromCodePoint(10003)}`
      })
    ).toThrow(
      'LIQUOR_BACKFILL_USER_AGENT contains non-header character "✓" (U+2713)'
    );
  });

  it("sends the configured cookie and user agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `<?xml version="1.0"?>
        <urlset>
          <url><loc>https://www.liquor.com/example-1234</loc></url>
        </urlset>`,
        {
          headers: { "content-type": "application/xml" },
          status: 200
        }
      )
    );
    const previousCookie = process.env.LIQUOR_BACKFILL_COOKIE;
    const previousUserAgent = process.env.LIQUOR_BACKFILL_USER_AGENT;

    process.env.LIQUOR_BACKFILL_COOKIE =
      "cf_clearance=clearance-value; __cf_bm=browser-session";
    process.env.LIQUOR_BACKFILL_USER_AGENT = "Matching Browser UA";
    vi.stubGlobal("fetch", fetchMock);

    try {
      await fetchLiquorSitemap("https://www.liquor.com/sitemap_1.xml", 1_000);
    } finally {
      process.env.LIQUOR_BACKFILL_COOKIE = previousCookie;
      process.env.LIQUOR_BACKFILL_USER_AGENT = previousUserAgent;
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.liquor.com/sitemap_1.xml",
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: "cf_clearance=clearance-value; __cf_bm=browser-session",
          "user-agent": "Matching Browser UA"
        })
      })
    );
  });
});

describe("parseLiquorSitemap", () => {
  it("parses sitemap indexes", () => {
    expect(
      parseLiquorSitemap(
        `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap>
            <loc>https://www.liquor.com/sitemap_1.xml</loc>
            <lastmod>2026-06-08</lastmod>
          </sitemap>
        </sitemapindex>`,
        "https://www.liquor.com/sitemap.xml"
      )
    ).toEqual({
      sitemapUrls: ["https://www.liquor.com/sitemap_1.xml"],
      urlEntries: []
    });
  });

  it("parses canonical Liquor.com URL entries", () => {
    expect(
      parseLiquorSitemap(
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>https://liquor.com/example-1234/</loc>
            <lastmod>2024-02-17T06:30:00-05:00</lastmod>
          </url>
          <url>
            <loc>https://example.com/not-liquor</loc>
          </url>
        </urlset>`,
        "https://www.liquor.com/sitemap_1.xml"
      )
    ).toEqual({
      sitemapUrls: [],
      urlEntries: [
        {
          lastModified: "2024-02-17T11:30:00.000Z",
          url: "https://www.liquor.com/example-1234"
        }
      ]
    });
  });
});

describe("parseLiquorTaxonomyPage", () => {
  it("discovers child taxonomies and fixed article cards without pagination", () => {
    const result = parseLiquorTaxonomyPage(
      `
      <html>
        <body>
          <main>
            <h1>Cocktail &amp; Other Recipes</h1>
            <a class="mntl-taxonomy-nodes__link" href="/cocktail-type-4779426">
              Recipes by Type
            </a>
            <a
              class="mntl-card-list-items"
              data-doc-id="8584488"
              href="/jerk-spiced-bloody-mary-recipe-8584488"
            >
              <span class="card__title-text">Jerk-Spiced Bloody Mary</span>
            </a>
          </main>
        </body>
      </html>`,
      "https://www.liquor.com/cocktail-and-other-recipes-4779343"
    );

    expect(result).toEqual({
      articles: [
        {
          documentId: "8584488",
          title: "Jerk-Spiced Bloody Mary",
          url: "https://www.liquor.com/jerk-spiced-bloody-mary-recipe-8584488"
        }
      ],
      childTaxonomies: [
        {
          title: "Recipes by Type",
          url: "https://www.liquor.com/cocktail-type-4779426"
        }
      ],
      title: "Cocktail & Other Recipes",
      url: "https://www.liquor.com/cocktail-and-other-recipes-4779343"
    });
  });
});

describe("parseLiquorArticle", () => {
  it("normalizes Liquor.com JSON-LD and taxonomy metadata", () => {
    const item = parseLiquorArticle(
      `
      <html>
        <head>
          <link rel="canonical" href="https://www.liquor.com/jerk-spiced-bloody-mary-recipe-8584488" />
          <script type="application/ld+json">
            [{
              "@context": "http://schema.org",
              "@type": ["Recipe", "NewsArticle"],
              "headline": "Jerk-Spiced Bloody Mary",
              "datePublished": "2024-02-17T06:30:00-05:00",
              "dateModified": "2024-02-18T06:30:00-05:00",
              "author": [{"@type": "Person", "name": "Toni Tipton-Martin"}],
              "description": "A sweet-hot rum Bloody Mary.",
              "image": {
                "@type": "ImageObject",
                "url": "https://www.liquor.com/image.jpg",
                "height": 1500,
                "width": 1500
              },
              "recipeCategory": "Cocktail",
              "recipeCuisine": ["Caribbean"],
              "keywords": "bloody mary, rum"
            }]
          </script>
        </head>
        <body>
          <article data-doc-id="8584488">
            <h1>Jerk-Spiced Bloody Mary</h1>
          </article>
        </body>
      </html>`,
      "https://www.liquor.com/jerk-spiced-bloody-mary-recipe-8584488",
      "feed-id",
      {
        sitemapLastModified: "2024-02-18T11:30:00.000Z",
        sitemapUrl: "https://www.liquor.com/sitemap_1.xml",
        taxonomyPaths: [["Cocktail & Other Recipes", "Recipes by Type"]]
      }
    );

    expect(item).toEqual(
      expect.objectContaining({
        author: "Toni Tipton-Martin",
        guid: "8584488",
        publishedAt: "2024-02-17T11:30:00.000Z",
        summaryText: "A sweet-hot rum Bloody Mary.",
        title: "Jerk-Spiced Bloody Mary",
        url: "https://www.liquor.com/jerk-spiced-bloody-mary-recipe-8584488"
      })
    );
    expect(item?.rawExtensionData).toEqual({
      liquor: expect.objectContaining({
        categories: ["Cocktail", "Caribbean"],
        documentId: "8584488",
        keywords: ["bloody mary", "rum"],
        modifiedAt: "2024-02-18T11:30:00.000Z",
        taxonomyPaths: [["Cocktail & Other Recipes", "Recipes by Type"]],
        types: ["Recipe", "NewsArticle"]
      })
    });
  });

  it("uses Liquor.com document IDs for RSS-compatible dedupe", () => {
    const backfilled = parseLiquorArticle(
      `
      <html>
        <head>
          <link rel="canonical" href="https://www.liquor.com/example-8584488" />
          <script type="application/ld+json">
            {
              "@type": "NewsArticle",
              "headline": "Example",
              "datePublished": "2024-02-17T11:30:00.000Z"
            }
          </script>
        </head>
      </html>`,
      "https://www.liquor.com/example-8584488",
      "feed-id",
      {
        sitemapLastModified: null,
        sitemapUrl: "https://www.liquor.com/sitemap_1.xml",
        taxonomyPaths: []
      }
    );
    const rss = parseFeedDocument(
      `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Liquor.com</title>
          <link>https://www.liquor.com</link>
          <item>
            <guid>8584488</guid>
            <title>Example</title>
            <link>https://www.liquor.com/example-8584488</link>
            <pubDate>Sat, 17 Feb 2024 11:30:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(backfilled?.dedupeKey).toBe(rss.items[0]?.dedupeKey);
  });
});

describe("Liquor.com URL helpers", () => {
  it("resolves site URLs to the canonical root", () => {
    expect(resolveLiquorRootUrl("https://liquor.com/example").toString()).toBe(
      "https://www.liquor.com/"
    );
  });

  it("excludes known taxonomy URLs from sitemap article candidates", () => {
    const taxonomies = new Set([
      "https://www.liquor.com/cocktail-type-4779426"
    ]);

    expect(
      isPotentialLiquorArticleUrl(
        "https://www.liquor.com/cocktail-type-4779426",
        taxonomies
      )
    ).toBe(false);
    expect(
      isPotentialLiquorArticleUrl(
        "https://www.liquor.com/jerk-spiced-bloody-mary-recipe-8584488",
        taxonomies
      )
    ).toBe(true);
  });
});
