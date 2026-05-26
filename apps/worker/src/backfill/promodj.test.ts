import { describe, expect, it } from "vitest";

import {
  isPromodjMaveBackfillFeed,
  parsePromodjGroupPage,
  parsePromodjItemPage,
  parsePromodjMusicSections
} from "./promodj.js";

describe("PromoDJ backfill parser", () => {
  it("discovers music group sections", () => {
    const sections = parsePromodjMusicSections(
      `
        <h2><a class="files_group_title" href="https://promodj.com/chillrussia/groups/586778/NOVOE">НОВОЕ</a></h2>
        <h2><a class="files_group_title" href="/chillrussia/groups/627178/DEEP">DEEP</a></h2>
        <h2><a class="files_group_title" href="/chillrussia/radioshows">radioshow</a></h2>
      `,
      "https://promodj.com/chillrussia/music"
    );

    expect(sections).toEqual([
      {
        title: "НОВОЕ",
        url: "https://promodj.com/chillrussia/groups/586778/NOVOE"
      },
      {
        title: "DEEP",
        url: "https://promodj.com/chillrussia/groups/627178/DEEP"
      }
    ]);
  });

  it("reads only primary group items before pagination", () => {
    const page = parsePromodjGroupPage(
      `
        <div class="track2 player_standard">
          <div class="title">
            <a amba="file:7898841" href="/chillrussia/radioshows/7898841/Nastoyaschee_Rasslablenie_CHILL_555">Настоящее Расслабление. CHILL #555</a>
          </div>
        </div>
        <a href="/source/7898841/file.mp3">320</a>
        <nav><div class="Navigator"><a href="?page=2" id="next_page">next</a></div></nav>
        <div class="player_mini_title">
          <a amba="file:111" href="https://promodj.com/other/tracks/111/Other">Unrelated recommendation</a>
        </div>
      `,
      "https://promodj.com/chillrussia/groups/586778/NOVOE"
    );

    expect(page.items).toEqual([
      {
        id: "7898841",
        title: "Настоящее Расслабление. CHILL #555",
        url: "https://promodj.com/chillrussia/radioshows/7898841/Nastoyaschee_Rasslablenie_CHILL_555"
      }
    ]);
    expect(page.nextPageUrl).toBe("https://promodj.com/chillrussia/groups/586778/NOVOE?page=2");
  });

  it("normalizes item detail pages into feed items", () => {
    const parsed = parsePromodjItemPage(
      `
        <meta property="og:title" content="Настоящее Расслабление. CHILL #555" />
        <meta property="og:description" content="Иногда кажется, что мир потерял устойчивость." />
        <meta property="og:image" content="https://cdn.promodj.com/image.jpg" />
        <meta property="og:url" content="https://promodj.com/chillrussia/radioshows/7898841/Nastoyaschee_Rasslablenie_CHILL_555" />
        <meta property="og:video:duration" content="3666" />
        <meta name="twitter:player:stream" content="https://promodj.com/prelisten/7898841/file.mp3" />
        <a id="download_flasher" href="https://promodj.com/download/7898841/file.mp3"></a>
        <b>Styles:</b> <span class="styles"><a>Ambient</a>, <a>Chillout</a></span><br />
        <b>Duration:</b> 61:06<br />
        <b>Publication:</b> 24 April 2026 21:28<br />
        <h5>More</h5>
        <div class="dj_universal perfect">Описание<br><a href="https://example.com">link</a></div>
      `,
      "feed-1",
      {
        id: "7898841",
        title: "fallback",
        url: "https://promodj.com/fallback"
      }
    );

    expect(parsed.item.guid).toBe("promodj:file:7898841");
    expect(parsed.item.title).toBe("Настоящее Расслабление. CHILL #555");
    expect(parsed.item.summaryText).toBe("Иногда кажется, что мир потерял устойчивость.");
    expect(parsed.item.publishedAt).toBe("2026-04-24T21:28:00.000Z");
    expect(parsed.item.contentHtml).toContain("Описание<br>");
    expect(parsed.item.rawExtensionData.enclosure).toEqual({
      "@_length": null,
      "@_type": "audio/mpeg",
      "@_url": "https://promodj.com/prelisten/7898841/file.mp3"
    });
    expect(parsed.item.rawExtensionData["itunes:duration"]).toBe("3666");
    expect(parsed.item.rawExtensionData["itunes:image"]).toEqual({
      "@_href": "https://cdn.promodj.com/image.jpg"
    });
    expect(parsed.source.styles).toEqual(["Ambient", "Chillout"]);
  });

  it("matches only the one-time Mave target feed", () => {
    expect(isPromodjMaveBackfillFeed("https://cloud.mave.digital/33812")).toBe(true);
    expect(isPromodjMaveBackfillFeed("https://cloud.mave.digital/other")).toBe(false);
  });
});
