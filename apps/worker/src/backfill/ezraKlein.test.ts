import { describe, expect, it } from "vitest";

import { parseEzraKleinCollectionPage } from "./ezraKlein.js";

describe("parseEzraKleinCollectionPage", () => {
  it("extracts unique NYT collection articles as normalized items", () => {
    const html = `
      <script>
      window.__DATA__ = {
        "Article:one": {
          "__typename": "Article",
          "id": "article-id-1",
          "url": "https:\\u002F\\u002Fwww.nytimes.com\\u002F2026\\u002F06\\u002F16\\u002Fopinion\\u002Fezra-klein-podcast-example.html",
          "firstPublished": "2026-06-16T09:04:02.000Z",
          "headline": { "__typename": "CreativeWorkHeadline", "default": "Example Episode" },
          "bylines": [{ "__typename": "Byline", "renderedRepresentation": "By Ezra Klein and Rollin Hu" }],
          "summary": "A useful summary.",
          "translations": []
        },
        "Article:duplicate": {
          "__typename": "Article",
          "id": "article-id-1",
          "url": "https:\\u002F\\u002Fwww.nytimes.com\\u002F2026\\u002F06\\u002F16\\u002Fopinion\\u002Fezra-klein-podcast-example.html",
          "firstPublished": "2026-06-16T09:04:02.000Z",
          "headline": { "__typename": "CreativeWorkHeadline", "default": "Example Episode" },
          "bylines": [{ "__typename": "Byline", "renderedRepresentation": "By Ezra Klein and Rollin Hu" }],
          "summary": "A useful summary.",
          "translations": []
        },
        "LegacyCollection:one": {
          "collectionsPage": {
            "stream({\\"first\\":10})": {
              "totalCount": 441
            }
          }
        },
        "config": { "x-nyt-internal-meter-override": undefined }
      };
      </script>
    `;

    const result = parseEzraKleinCollectionPage(html, "feed-id");

    expect(result.reportedTotalCount).toBe(441);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      author: "Ezra Klein and Rollin Hu",
      contentHtml: "A useful summary.",
      guid: "https://www.nytimes.com/2026/06/16/opinion/ezra-klein-podcast-example.html",
      publishedAt: "2026-06-16T09:04:02.000Z",
      summaryText: "A useful summary.",
      title: "Example Episode",
      url: "https://www.nytimes.com/2026/06/16/opinion/ezra-klein-podcast-example.html"
    });
    expect(result.items[0]?.rawExtensionData).toEqual({
      source: "nytimes-collection",
      nytArticleId: "article-id-1"
    });
  });
});
