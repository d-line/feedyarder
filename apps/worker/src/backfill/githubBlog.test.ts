import { describe, expect, it } from "vitest";

import { parseFeedDocument } from "../fetch/normalize.js";
import {
  buildGitHubBlogApiPageUrl,
  parseGitHubBlogApiPage,
  resolveGitHubBlogRootUrl
} from "./githubBlog.js";

describe("parseGitHubBlogApiPage", () => {
  it("normalizes WordPress API posts with RSS-compatible GUIDs", () => {
    const result = parseGitHubBlogApiPage(
      JSON.stringify([
        {
          id: 95805,
          date_gmt: "2026-05-08T16:30:00",
          modified_gmt: "2026-05-08T15:37:08",
          link: "https://github.blog/news-insights/policy-news-and-insights/why-age-assurance-laws-matter-for-developers/",
          title: {
            rendered: "Why age assurance laws matter for developers"
          },
          yoast_head_json: {
            author: "Margaret Tucker"
          },
          excerpt: {
            rendered:
              "<p>Youth safety requirements are moving down the tech stack to operating systems and app stores&mdash;raising new questions for open source developers. </p>\n"
          },
          content: {
            rendered: "<p>Full article body.</p>"
          },
          _embedded: {
            "wp:featuredmedia": [
              {
                alt_text: "Decorative background",
                id: 93133,
                media_details: {
                  height: 1080,
                  width: 1920
                },
                source_url:
                  "https://github.blog/wp-content/uploads/2026/01/header.png"
              }
            ],
            "wp:term": [
              [
                {
                  id: 3321,
                  link: "https://github.blog/news-insights/",
                  name: "News &amp; insights",
                  slug: "news-insights",
                  taxonomy: "category"
                },
                {
                  id: 3324,
                  link: "https://github.blog/news-insights/policy-news-and-insights/",
                  name: "Policy",
                  slug: "policy-news-and-insights",
                  taxonomy: "category"
                }
              ],
              [
                {
                  id: 2141,
                  link: "https://github.blog/tag/maintainers/",
                  name: "maintainers",
                  slug: "maintainers",
                  taxonomy: "post_tag"
                }
              ],
              [
                {
                  id: 2771,
                  link: "https://github.blog/?taxonomy=author&term=cap-margarettucker",
                  name: "Margaret Tucker",
                  slug: "cap-margarettucker",
                  taxonomy: "author"
                }
              ]
            ]
          }
        }
      ]),
      "https://github.blog/wp-json/wp/v2/posts?per_page=100&page=1&_embed=wp%3Afeaturedmedia%2Cwp%3Aterm",
      "feed-id",
      41
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          author: "Margaret Tucker",
          contentHtml: "<p>Full article body.</p>",
          guid: "https://github.blog/?p=95805",
          publishedAt: "2026-05-08T16:30:00.000Z",
          rawExtensionData: {
            githubBlog: {
              backfilledFrom:
                "https://github.blog/wp-json/wp/v2/posts?per_page=100&page=1&_embed=wp%3Afeaturedmedia%2Cwp%3Aterm",
              categories: ["News & insights", "Policy"],
              modifiedAt: "2026-05-08T15:37:08.000Z",
              postId: "95805",
              tags: ["maintainers"],
              thumbnail: {
                altText: "Decorative background",
                height: 1080,
                id: "93133",
                url: "https://github.blog/wp-content/uploads/2026/01/header.png",
                width: 1920
              }
            }
          },
          summaryText:
            "Youth safety requirements are moving down the tech stack to operating systems and app stores—raising new questions for open source developers.",
          title: "Why age assurance laws matter for developers",
          url: "https://github.blog/news-insights/policy-news-and-insights/why-age-assurance-laws-matter-for-developers/"
        })
      ],
      nextPageUrl:
        "https://github.blog/wp-json/wp/v2/posts?per_page=100&page=2&_embed=wp%3Afeaturedmedia%2Cwp%3Aterm",
      pageNumber: 1,
      totalPages: 41
    });
  });

  it("matches the normal RSS dedupe key for recent GitHub Blog items", () => {
    const backfilled = parseGitHubBlogApiPage(
      JSON.stringify([
        {
          id: 95805,
          date_gmt: "2026-05-08T16:30:00",
          link: "https://github.blog/news-insights/policy-news-and-insights/why-age-assurance-laws-matter-for-developers/",
          title: {
            rendered: "Why age assurance laws matter for developers"
          }
        }
      ]),
      "https://github.blog/wp-json/wp/v2/posts?per_page=100&page=1",
      "feed-id",
      41
    );
    const rss = parseFeedDocument(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>The GitHub Blog</title>
          <link>https://github.blog/</link>
          <item>
            <title>Why age assurance laws matter for developers</title>
            <link>https://github.blog/news-insights/policy-news-and-insights/why-age-assurance-laws-matter-for-developers/</link>
            <pubDate>Fri, 08 May 2026 16:30:00 +0000</pubDate>
            <guid isPermaLink="false">https://github.blog/?p=95805</guid>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(backfilled.items[0]?.dedupeKey).toBe(rss.items[0]?.dedupeKey);
  });

  it("stops when the API page reaches the total page count", () => {
    const result = parseGitHubBlogApiPage(
      JSON.stringify([
        {
          id: 1,
          link: "https://github.blog/news-insights/the-library/the-blog-arrives/",
          title: {
            rendered: "The Blog Arrives"
          }
        }
      ]),
      "https://github.blog/wp-json/wp/v2/posts?per_page=100&page=41",
      "feed-id",
      41
    );

    expect(result.nextPageUrl).toBeNull();
  });
});

describe("buildGitHubBlogApiPageUrl", () => {
  it("builds WordPress API page URLs from GitHub Blog feed URLs", () => {
    expect(buildGitHubBlogApiPageUrl("https://github.blog/feed/", 2)).toBe(
      "https://github.blog/wp-json/wp/v2/posts?per_page=100&page=2&_embed=wp%3Afeaturedmedia%2Cwp%3Aterm"
    );
  });
});

describe("resolveGitHubBlogRootUrl", () => {
  it("resolves GitHub Blog URLs to the root", () => {
    expect(resolveGitHubBlogRootUrl("https://github.blog/latest/page/2/").toString()).toBe(
      "https://github.blog/"
    );
  });
});
