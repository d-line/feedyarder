import { describe, expect, it } from "vitest";

import {
  parseDouArchiveDate,
  parseDouLentaPage,
  resolveDouLentaRootUrl
} from "./dou.js";

describe("parseDouLentaPage", () => {
  it("normalizes DOU postcard rows and follows pagination", () => {
    const result = parseDouLentaPage(
      `<html><body>
        <div class="b-lenta">
          <article class="b-postcard">
            <h2 class="title">
              <a href="https://dou.ua/lenta/news/blue-bird-tech-air-defense-missiles/">
                Blue Bird Tech відкриває офіс в Україні
              </a>
            </h2>
            <a class="author" href="https://dou.ua/users/dasha-podvishenna/">Дарія Подвишенна</a>
            <time class="date">27 квітня<span class="m-hide">, 13:09</span></time>
            <p>Ізраїльська оборонна компанія Blue Bird Tech запускає R&amp;D в Україні.</p>
            <a class="topic" href="/lenta/news/">Новини</a>
            <a href="/lenta/tags/defense/">defense</a>
            <a href="/lenta/tags/ukraine/">ukraine</a>
          </article>
        </div>
        <script>
          window.nextPageUrl = "/lenta/page/3/";
        </script>
      </body></html>`,
      "https://dou.ua/lenta/page/2/",
      "feed-id",
      2026
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          author: "Дарія Подвишенна",
          guid: "https://dou.ua/lenta/news/blue-bird-tech-air-defense-missiles/",
          publishedAt: "2026-04-27T13:09:00.000Z",
          rawExtensionData: {
            dou: {
              backfilledFrom: "https://dou.ua/lenta/page/2/",
              path: "/lenta/news/blue-bird-tech-air-defense-missiles/",
              tags: ["defense", "ukraine"],
              topic: "Новини"
            }
          },
          summaryText: "Ізраїльська оборонна компанія Blue Bird Tech запускає R&D в Україні.",
          title: "Blue Bird Tech відкриває офіс в Україні",
          url: "https://dou.ua/lenta/news/blue-bird-tech-air-defense-missiles/"
        })
      ],
      nextPageUrl: "https://dou.ua/lenta/page/3/",
      pageNumber: 2
    });
  });

  it("parses older rows with explicit years", () => {
    const result = parseDouLentaPage(
      `<html><body>
        <article class="b-postcard">
          <h2 class="title"><a href="/lenta/articles/example/">Старіша стаття</a></h2>
          <time class="date">26 грудня 2025<span class="m-hide">, 10:00</span></time>
        </article>
      </body></html>`,
      "https://dou.ua/lenta/page/20/",
      "feed-id",
      2026
    );

    expect(result.items[0]?.publishedAt).toBe("2025-12-26T10:00:00.000Z");
    expect(result.items[0]?.guid).toBe("https://dou.ua/lenta/articles/example/");
  });
});

describe("parseDouArchiveDate", () => {
  it("uses the supplied current year when DOU omits a year", () => {
    expect(parseDouArchiveDate("27 квітня, 13:09", 2026)).toBe("2026-04-27T13:09:00.000Z");
  });

  it("uses the explicit year for older archive rows", () => {
    expect(parseDouArchiveDate("12 червня 2024, 13:00", 2026)).toBe("2024-06-12T13:00:00.000Z");
  });
});

describe("resolveDouLentaRootUrl", () => {
  it("resolves DOU feed URLs to the lenta root", () => {
    expect(resolveDouLentaRootUrl("https://dou.ua/feed/").toString()).toBe("https://dou.ua/lenta/");
  });

  it("preserves explicit DOU archive page starts", () => {
    expect(resolveDouLentaRootUrl("https://dou.ua/lenta/page/2/").toString()).toBe(
      "https://dou.ua/lenta/page/2/"
    );
  });
});
