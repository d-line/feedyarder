import { describe, expect, it } from "vitest";

import { parseFeedDocument } from "../fetch/normalize.js";
import {
  parseFlibustaAddedDate,
  parseFlibustaGenrePage,
  resolveFlibustaGenreUrl
} from "./flibusta.js";

describe("parseFlibustaGenrePage", () => {
  it("normalizes genre book rows and carries author/date context forward", () => {
    const result = parseFlibustaGenrePage(
      `<html><body>
        <h1 class="title">Альтернативная история</h1>
        <form action="/g/sf_history">
          <ol>
            <h4>16.05.2026</h4>
            <h5><a href="/a/93447">Андрей Николаевич Савинков</a></h5>
            1 <a href="/b/872946">Меченый. Том 8. На лезвии мира</a><br>
            2 <a href="/b/872947">Меченый. Том 9</a><br>
            <h4>15.05.2026</h4>
            <h5><a href="/a/171249">Сарбан</a></h5>
            3 <a href="/b/872821">Звук его рога</a><br>
          </ol>
        </form>
      </body></html>`,
      "https://flibusta.is/g/sf_history/",
      "feed-id"
    );

    expect(result.genreSlug).toBe("sf_history");
    expect(result.genreTitle).toBe("Альтернативная история");
    expect(result.nextPageUrl).toBeNull();
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        author: "Андрей Николаевич Савинков",
        guid: "http://flibusta.is/b/872946",
        publishedAt: "2026-05-16T00:00:00.000Z",
        rawExtensionData: {
          flibusta: {
            addedDate: "2026-05-16",
            authorUrl: "https://flibusta.is/a/93447",
            backfilledFrom: "https://flibusta.is/g/sf_history/",
            bookId: "872946",
            genreSlug: "sf_history",
            genreTitle: "Альтернативная история"
          }
        },
        title: "Меченый. Том 8. На лезвии мира - Андрей Николаевич Савинков - Альтернативная история",
        url: "http://flibusta.is/b/872946"
      })
    );
    expect(result.items[1]?.author).toBe("Андрей Николаевич Савинков");
    expect(result.items[2]?.publishedAt).toBe("2026-05-15T00:00:00.000Z");
  });

  it("uses the same dedupe key as the RSS item GUID", () => {
    const backfilled = parseFlibustaGenrePage(
      `<html><body>
        <h1 class="title">Альтернативная история</h1>
        <form action="/g/sf_history">
          <ol>
            <h4>16.05.2026</h4>
            <h5><a href="/a/93447">Андрей Николаевич Савинков</a></h5>
            1 <a href="/b/872946">Меченый. Том 8. На лезвии мира</a><br>
          </ol>
        </form>
      </body></html>`,
      "https://flibusta.is/g/sf_history/",
      "feed-id"
    );
    const rss = parseFeedDocument(
      `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0">
        <channel>
          <title>Новости Флибусты - Альтернативная история</title>
          <link>http://flibusta.is/g/sf_history</link>
          <item>
            <title>Меченый. Том 8. На лезвии мира - Андрей Николаевич Савинков - Альтернативная история</title>
            <link>http://flibusta.is/b/872946</link>
            <guid>http://flibusta.is/b/872946</guid>
            <pubDate>Sat, 16 May 2026 13:04:38 GMT</pubDate>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(backfilled.items[0]?.dedupeKey).toBe(rss.items[0]?.dedupeKey);
  });
});

describe("parseFlibustaAddedDate", () => {
  it("parses Flibusta added dates", () => {
    expect(parseFlibustaAddedDate("16.05.2026")).toBe("2026-05-16T00:00:00.000Z");
  });

  it("rejects invalid dates", () => {
    expect(parseFlibustaAddedDate("not a date")).toBeNull();
    expect(parseFlibustaAddedDate("32.13.2026")).toBeNull();
  });
});

describe("resolveFlibustaGenreUrl", () => {
  it("maps genre RSS URLs to the genre page", () => {
    expect(resolveFlibustaGenreUrl("https://flibusta.is/g/sf_history/rss").toString()).toBe(
      "https://flibusta.is/g/sf_history/"
    );
  });

  it("normalizes genre page URLs", () => {
    expect(resolveFlibustaGenreUrl("https://flibusta.is/g/det_action").toString()).toBe(
      "https://flibusta.is/g/det_action/"
    );
  });
});
