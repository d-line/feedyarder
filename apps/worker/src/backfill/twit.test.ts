import { describe, expect, it } from "vitest";

import {
  normalizeTwitEpisodeListEntry,
  parseTwitEpisodeDetail,
  parseTwitEpisodeListPage,
  parseTwitRssOverrides,
  parseTwitShowArchiveUrl,
  resolveTwitEpisodeArchiveUrl
} from "./twit.js";

describe("parseTwitEpisodeListPage", () => {
  it("extracts episode detail URLs and archive pagination", () => {
    const page = parseTwitEpisodeListPage(
      `
      <html>
        <body>
          <div class="episode item">
            <a href="/shows/floss-weekly/episodes/761b?autostart=false" title="Hackaday is the new home">
              <img src="https://elroy.twit.tv/floss0761b_thumbnail.jpg" />
            </a>
          </div>
          <div class="episode item">
            <a href="/shows/floss-weekly/episodes/761?autostart=false" title="The Victories of Free Software">
              <img src="https://elroy.twit.tv/floss0761_thumbnail.jpg" />
            </a>
          </div>
          <div class="pagination">
            <span class="page-number">
              Page <input class="page-number-input" type="number" value="1" min="1" max="32" />
            </span>
            <a class="next" href="?page=2&amp;filter%5Bshows%5D=1639">Next</a>
          </div>
        </body>
      </html>`,
      "https://twit.tv/episodes?filter%5Bshows%5D=1639"
    );

    expect(page).toEqual(expect.objectContaining({
      episodeUrls: [
        "https://twit.tv/shows/floss-weekly/episodes/761b",
        "https://twit.tv/shows/floss-weekly/episodes/761"
      ],
      nextPageUrl: "https://twit.tv/episodes?filter%5Bshows%5D=1639&page=2",
      pageNumber: 1,
      showId: "1639",
      totalPages: 32
    }));
    expect(page.episodes[1]).toEqual(expect.objectContaining({
      dateText: null,
      episodeKey: "761",
      episodeNumber: "761",
      imageUrl: "https://elroy.twit.tv/floss0761_thumbnail.jpg",
      title: "The Victories of Free Software"
    }));
  });
});

describe("normalizeTwitEpisodeListEntry", () => {
  it("builds a fallback item from archive metadata and RSS overrides", () => {
    const item = normalizeTwitEpisodeListEntry(
      {
        dateText: "Dec 13 2023",
        episodeKey: "761",
        episodeNumber: "761",
        imageUrl: "https://elroy.twit.tv/floss0761_thumbnail.jpg",
        summaryText: "The Victories of Free Software and Open Source",
        title: "FLOSS Weekly 761: We Won!",
        url: "https://twit.tv/shows/floss-weekly/episodes/761"
      },
      "feed-id",
      new Map([
        [
          "https://twit.tv/shows/floss-weekly/episodes/761",
          {
            audioUrl: "https://cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
            guid: "https://pdst.fm/e/cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
            imageUrl: null,
            publishedAt: "2023-12-13T21:30:00.000Z",
            summaryText: null
          }
        ]
      ])
    );

    expect(item).toEqual(expect.objectContaining({
      guid: "https://pdst.fm/e/cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
      publishedAt: "2023-12-13T21:30:00.000Z",
      summaryText: "The Victories of Free Software and Open Source",
      title: "FLOSS Weekly 761: We Won!",
      url: "https://twit.tv/shows/floss-weekly/episodes/761"
    }));
    expect(item.rawExtensionData.twit).toEqual(expect.objectContaining({
      audioUrl: "https://cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
      episodeKey: "761",
      usedArchiveFallback: true,
      usedRssGuid: true
    }));
  });
});

describe("parseTwitEpisodeDetail", () => {
  it("normalizes detail pages with media, people, transcript, and RSS GUID overrides", () => {
    const overrides = new Map([
      [
        "https://twit.tv/shows/floss-weekly/episodes/761",
        {
          audioUrl: "https://cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
          guid: "https://pdst.fm/e/cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
          imageUrl: "https://elroy.twit.tv/floss0761_thumbnail.jpg",
          publishedAt: "2023-12-13T21:30:00.000Z",
          summaryText: "The final FLOSS Weekly at TWiT."
        }
      ]
    ]);
    const item = parseTwitEpisodeDetail(
      `
      <html>
        <head>
          <meta property="og:url" content="https://twit.tv/shows/floss-weekly/episodes/761" />
          <meta property="og:title" content="FLOSS Weekly: We Won! | TWiT.TV" />
          <meta property="og:description" content="The final FLOSS Weekly at TWiT." />
          <meta property="og:image" content="https://elroy.twit.tv/floss0761_thumbnail.jpg" />
          <script type="application/ld+json">
            {"@type":"VideoObject","uploadDate":"2023-12-13T21:30:00Z","duration":"PT01H16M30S"}
          </script>
        </head>
        <body>
          <audio><source src="https://cdn.twit.tv/audio/floss/floss0761/floss0761.mp3" type="audio/mpeg"></audio>
          <video><source src="https://cdn.twit.tv/video/floss/floss0761/floss0761_h264m_1920x1080.mp4" type="video/mp4"></video>
          <nav class="breadcrumbs"><a href="/shows/floss-weekly">FLOSS Weekly</a></nav>
          <p class="air-date">Dec 13th 2023</p>
          <h1 class="title">FLOSS Weekly 761</h1>
          <h2 class="subtitle">We Won!</h2>
          <div class="hosts">Hosted by <a href="/people/doc-searls">Doc Searls</a>, <a href="/people/dan-lynch">Dan Lynch</a></div>
          <div class="guests">Guests: <a href="/people/leo-laporte">Leo Laporte</a></div>
          <a href="/posts/transcripts/floss-weekly-761-transcript">FLOSS Weekly 761 Transcript</a>
        </body>
      </html>`,
      "https://twit.tv/shows/floss-weekly/episodes/761",
      "feed-id",
      overrides
    );

    expect(item).toEqual(
      expect.objectContaining({
        author: "Doc Searls, Dan Lynch",
        guid: "https://pdst.fm/e/cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
        publishedAt: "2023-12-13T21:30:00.000Z",
        summaryText: "The final FLOSS Weekly at TWiT.",
        title: "FLOSS Weekly 761: We Won!",
        url: "https://twit.tv/shows/floss-weekly/episodes/761"
      })
    );
    expect(item?.rawExtensionData.twit).toEqual(
      expect.objectContaining({
        audioUrl: "https://cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
        duration: "PT01H16M30S",
        episodeKey: "761",
        episodeNumber: "761",
        guests: ["Leo Laporte"],
        hosts: ["Doc Searls", "Dan Lynch"],
        imageUrl: "https://elroy.twit.tv/floss0761_thumbnail.jpg",
        transcriptUrl: "https://twit.tv/posts/transcripts/floss-weekly-761-transcript",
        usedRssGuid: true,
        videoUrl: "https://cdn.twit.tv/video/floss/floss0761/floss0761_h264m_1920x1080.mp4"
      })
    );
  });
});

describe("parseTwitRssOverrides", () => {
  it("indexes RSS GUIDs by canonical episode URL", () => {
    const overrides = parseTwitRssOverrides(
      `<?xml version="1.0" encoding="utf-8" ?>
      <rss version="2.0">
        <channel>
          <title>FLOSS Weekly (Audio)</title>
          <link>https://twit.tv/shows/floss-weekly</link>
          <item>
            <title>FLOSS Weekly 761: We Won!</title>
            <pubDate>Wed, 13 Dec 2023 13:30:00 PST</pubDate>
            <link>https://twit.tv/shows/floss-weekly/episodes/761</link>
            <guid isPermaLink="false">https://pdst.fm/e/cdn.twit.tv/audio/floss/floss0761/floss0761.mp3</guid>
          </item>
        </channel>
      </rss>`,
      "feed-id"
    );

    expect(overrides.get("https://twit.tv/shows/floss-weekly/episodes/761")).toEqual({
      audioUrl: null,
      guid: "https://pdst.fm/e/cdn.twit.tv/audio/floss/floss0761/floss0761.mp3",
      imageUrl: null,
      publishedAt: "2023-12-13T21:30:00.000Z",
      summaryText: null
    });
  });
});

describe("Twit URL helpers", () => {
  it("resolves archive URLs and extracts archive links from show pages", () => {
    expect(resolveTwitEpisodeArchiveUrl("https://twit.tv/episodes?filter[shows]=1639").toString()).toBe(
      "https://twit.tv/episodes?filter%5Bshows%5D=1639"
    );
    expect(
      parseTwitShowArchiveUrl(
        `<a href="/episodes?filter[shows]=1639" class="cta">All FLOSS Weekly Episodes</a>`,
        "https://twit.tv/shows/floss-weekly"
      )
    ).toBe("https://twit.tv/episodes?filter%5Bshows%5D=1639");
  });
});
