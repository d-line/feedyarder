import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNprFreshAirArchivePage,
  parseNprFreshAirArchivePage,
  resolveNprFreshAirArchiveUrl,
  sameNprArchiveMonth
} from "./npr.js";
import {
  buildNprIndicatorPartialUrl,
  mergeNprIndicatorRssItems,
  parseNprIndicatorArchivePage,
  resolveNprIndicatorPodcastUrl
} from "./nprIndicator.js";
import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseNprFreshAirArchivePage", () => {
  it("normalizes Fresh Air archive shows with segment metadata and month pagination", () => {
    const result = parseNprFreshAirArchivePage(
      `<html><body>
        <div id="episode-list">
          <article class="program-show has-segments" data-episode-id="g-s1-103338" data-episode-date="2025-12-31">
            <h2 class="program-show__title">
              <a href="https://www.npr.org/programs/fresh-air/g-s1-103338/fresh-air-for-dec-31-2025-richard-kind?showDate=2025-12-31">
                Fresh Air for Dec. 31, 2025: Richard Kind
              </a>
            </h2>
            <div class="program-show__full-audio">
              <b data-play-all='{"type":"episode","full":[],"segments":["nx-s1-5651983:nx-s1-9591116"],"audioData":[{"uid":"nx-s1-5651983:nx-s1-9591116","available":true,"duration":2159,"title":"FA: Richard Kind","audioUrl":"https://ondemand.npr.org/audio.mp3","storyUrl":"https://www.npr.org/2025/12/31/nx-s1-5651983/richard-kind-plays-to-the-largest-audience-of-his-life-in-everybodys-live","slug":"Television","program":"Fresh Air"}]}'></b>
            </div>
          </article>
        </div>
        <a href="/programs/fresh-air/archive?date=12-31-2025">December 2025</a>
        <a href="/programs/fresh-air/archive?date=11-30-2025">November 2025</a>
        <a rel="nofollow" href="/programs/fresh-air/archive?date=2025-12-26&amp;eid=g-s1-103333">More from Fresh Air</a>
      </body></html>`,
      "https://www.npr.org/programs/fresh-air/archive?date=12-31-2025",
      "feed-id"
    );

    expect(result.monthUrls).toEqual([
      "https://www.npr.org/programs/fresh-air/archive?date=12-31-2025",
      "https://www.npr.org/programs/fresh-air/archive?date=11-30-2025"
    ]);
    expect(result.nextPageUrl).toBe(
      "https://www.npr.org/programs/fresh-air/archive?date=2025-12-26&eid=g-s1-103333"
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        author: "NPR",
        guid: "g-s1-103338",
        publishedAt: "2025-12-31T00:00:00.000Z",
        rawExtensionData: {
          nprFreshAir: {
            backfilledFrom: "https://www.npr.org/programs/fresh-air/archive?date=12-31-2025",
            episodeDate: "2025-12-31",
            episodeId: "g-s1-103338",
            segments: [
              {
                audioUrl: "https://ondemand.npr.org/audio.mp3",
                durationSeconds: 2159,
                slug: "Television",
                storyId: "nx-s1-5651983",
                title: "FA: Richard Kind",
                uid: "nx-s1-5651983:nx-s1-9591116",
                url: "https://www.npr.org/2025/12/31/nx-s1-5651983/richard-kind-plays-to-the-largest-audience-of-his-life-in-everybodys-live"
              }
            ]
          }
        },
        summaryText: "FA: Richard Kind",
        title: "Fresh Air for Dec. 31, 2025: Richard Kind",
        url: "https://www.npr.org/programs/fresh-air/g-s1-103338/fresh-air-for-dec-31-2025-richard-kind?showDate=2025-12-31"
      })
    ]);
  });

  it("stops archive pagination when the next link crosses month boundaries", () => {
    const result = parseNprFreshAirArchivePage(
      `<html><body>
        <a rel="nofollow" href="/programs/fresh-air/archive?date=2025-11-29&amp;eid=g-s1-1">More from Fresh Air</a>
      </body></html>`,
      "https://www.npr.org/programs/fresh-air/archive?date=12-31-2025",
      "feed-id"
    );

    expect(result.nextPageUrl).toBeNull();
  });
});

describe("resolveNprFreshAirArchiveUrl", () => {
  it("maps the Fresh Air podcast feed to the archive root", () => {
    expect(resolveNprFreshAirArchiveUrl("https://feeds.npr.org/381444908/podcast.xml").toString()).toBe(
      "https://www.npr.org/programs/fresh-air/archive"
    );
  });

  it("maps Fresh Air podcast pages to the archive root", () => {
    expect(resolveNprFreshAirArchiveUrl("https://www.npr.org/podcasts/381444908/fresh-air").toString()).toBe(
      "https://www.npr.org/programs/fresh-air/archive"
    );
  });
});

describe("sameNprArchiveMonth", () => {
  it("compares both archive date formats by month", () => {
    expect(
      sameNprArchiveMonth(
        "https://www.npr.org/programs/fresh-air/archive?date=12-31-2025",
        "https://www.npr.org/programs/fresh-air/archive?date=2025-12-26&eid=g-s1-103333"
      )
    ).toBe(true);
    expect(
      sameNprArchiveMonth(
        "https://www.npr.org/programs/fresh-air/archive?date=12-31-2025",
        "https://www.npr.org/programs/fresh-air/archive?date=2025-11-29&eid=g-s1-1"
      )
    ).toBe(false);
  });
});

describe("NPR Indicator archive", () => {
  it("maps the feed and podcast page to the canonical podcast URL", () => {
    expect(
      resolveNprIndicatorPodcastUrl(
        "https://feeds.npr.org/510325/podcast.xml"
      ).toString()
    ).toBe(
      "https://www.npr.org/podcasts/510325/the-indicator-from-planet-money"
    );
    expect(
      resolveNprIndicatorPodcastUrl(
        "https://www.npr.org/podcasts/510325/the-indicator-from-planet-money"
      ).toString()
    ).toBe(
      "https://www.npr.org/podcasts/510325/the-indicator-from-planet-money"
    );
  });

  it("normalizes podcast partial episodes with audio and archive metadata", () => {
    const pageUrl = buildNprIndicatorPartialUrl(1);
    const result = parseNprIndicatorArchivePage(
      buildIndicatorEpisodeHtml({
        description: "A concise explanation of a large economic idea.",
        episodeDate: "2026-05-27",
        storyId: "nx-s1-5835727",
        title: "What the movies teach us about recessions",
        url: "https://www.npr.org/2026/05/27/nx-s1-5835727/example"
      }),
      pageUrl,
      "feed-id"
    );

    expect(result).toMatchObject({
      episodeCount: 1,
      nextPageUrl: null
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        author: "NPR",
        guid: "nx-s1-5835727",
        publishedAt: "2026-05-27T00:00:00.000Z",
        rawExtensionData: expect.objectContaining({
          enclosure: {
            "@_type": "audio/mpeg",
            "@_url": "https://audio.example/episode.mp3"
          },
          "itunes:duration": "541",
          "media:thumbnail": {
            "@_url": "https://media.example/episode.jpg"
          },
          nprIndicator: expect.objectContaining({
            audioUid: "nx-s1-5835727:nx-s1-mx-5835727-1",
            backfilledFrom: pageUrl,
            durationSeconds: 541,
            storyId: "nx-s1-5835727",
            transcriptUrl: "https://www.npr.org/transcripts/nx-s1-5835727"
          })
        }),
        summaryText: "A concise explanation of a large economic idea.",
        title: "What the movies teach us about recessions",
        url: "https://www.npr.org/2026/05/27/nx-s1-5835727/example"
      })
    ]);
  });

  it("advances partial pagination by 24 items", () => {
    const html = Array.from({ length: 24 }, (_, index) =>
      buildIndicatorEpisodeHtml({
        description: `Description ${index}`,
        episodeDate: "2026-05-27",
        storyId: `nx-s1-${index}`,
        title: `Episode ${index}`,
        url: `https://www.npr.org/2026/05/27/nx-s1-${index}/episode-${index}`
      })
    ).join("");
    const result = parseNprIndicatorArchivePage(
      html,
      buildNprIndicatorPartialUrl(25),
      "feed-id"
    );

    expect(result.episodeCount).toBe(24);
    expect(result.items).toHaveLength(24);
    expect(result.nextPageUrl).toBe(buildNprIndicatorPartialUrl(49));
  });

  it("uses an overlapping final page to respect NPR's 2,000-result cap", () => {
    const html = Array.from({ length: 24 }, (_, index) =>
      buildIndicatorEpisodeHtml({
        description: `Description ${index}`,
        episodeDate: "2018-07-10",
        storyId: `story-${index}`,
        title: `Episode ${index}`,
        url: `https://www.npr.org/2018/07/10/story-${index}/episode-${index}`
      })
    ).join("");

    expect(
      parseNprIndicatorArchivePage(
        html,
        buildNprIndicatorPartialUrl(1969),
        "feed-id"
      ).nextPageUrl
    ).toBe(buildNprIndicatorPartialUrl(1977));
    expect(
      parseNprIndicatorArchivePage(
        html,
        buildNprIndicatorPartialUrl(1977),
        "feed-id"
      ).nextPageUrl
    ).toBeNull();
  });

  it("keeps RSS GUIDs and metadata for archive items with matching URLs", () => {
    const archiveItem = buildNormalizedItem({
      guid: "nx-s1-5835727",
      rawExtensionData: {
        nprIndicator: {
          storyId: "nx-s1-5835727"
        }
      },
      url: "https://www.npr.org/2026/05/27/nx-s1-5835727/example"
    });
    const rssItem = buildNormalizedItem({
      guid: "rss-guid",
      rawExtensionData: {
        enclosure: {
          "@_url": "https://audio.example/rss.mp3"
        }
      },
      url: archiveItem.url
    });

    expect(mergeNprIndicatorRssItems([archiveItem], [rssItem])).toEqual([
      {
        ...rssItem,
        rawExtensionData: {
          ...rssItem.rawExtensionData,
          nprIndicator: {
            storyId: "nx-s1-5835727"
          }
        }
      }
    ]);
  });
});

describe("fetchNprFreshAirArchivePage", () => {
  it("logs request stages and response details", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><body></body></html>", {
        headers: {
          "content-length": "26",
          "content-type": "text/html"
        },
        status: 200
      })
    );
    vi.stubGlobal(
      "fetch",
      fetchMock
    );

    await expect(
      fetchNprFreshAirArchivePage(
        "https://www.npr.org/programs/fresh-air/archive",
        "feed-id",
        60_000
      )
    ).resolves.toMatchObject({ items: [] });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("NPR Fresh Air request started:")
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("NPR Fresh Air response headers received:")
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("NPR Fresh Air response body downloaded:")
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("NPR Fresh Air response parsed:")
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.npr.org/programs/fresh-air/archive",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: expect.stringContaining("text/html"),
          "accept-language": "en-US,en;q=0.9",
          "user-agent": expect.stringContaining("Mozilla/5.0")
        })
      })
    );
  });

  it("adds URL, timeout, stage, and error type to request failures", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new DOMException("The operation was aborted due to timeout", "TimeoutError")
      )
    );

    await expect(
      fetchNprFreshAirArchivePage(
        "https://www.npr.org/programs/fresh-air/archive",
        "feed-id",
        60_000
      )
    ).rejects.toThrow(
      "stage=waiting_for_response_headers url=https://www.npr.org/programs/fresh-air/archive timeoutMs=60000"
    );
  });

  it("identifies timeouts while downloading the response body", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = new Response("", { status: 200 });
    vi.spyOn(response, "text").mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError")
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      fetchNprFreshAirArchivePage(
        "https://www.npr.org/programs/fresh-air/archive",
        "feed-id",
        60_000
      )
    ).rejects.toThrow("stage=downloading_response_body");
  });
});

function buildIndicatorEpisodeHtml(input: {
  description: string;
  episodeDate: string;
  storyId: string;
  title: string;
  url: string;
}): string {
  return `
    <article
      class="item podcast-episode"
      data-podcast-episode-raw-type="FULL"
      data-podcast-episode-derived-plus-type="PLUS_UNSPONSORED_AVAILABLE"
      data-podcast-channel-parent-id="510325"
      data-linked-story-id="${input.storyId}"
      data-primary-audio-id="${input.storyId}:audio"
    >
      <div class="item-image">
        <img
          src="https://media.example/episode-small.jpg"
          data-original="https://media.example/episode.jpg"
        />
      </div>
      <div class="item-info">
        <h3 class="episode-date">
          <time datetime="${input.episodeDate}">${input.episodeDate}</time>
        </h3>
        <h2 class="title"><a href="${input.url}">${input.title}</a></h2>
        <p class="teaser">
          <time datetime="${input.episodeDate}">${input.episodeDate} • </time>
          ${input.description}
        </p>
        <div
          class="audio-module-controls-wrap"
          data-audio='{"uid":"${input.storyId}:nx-s1-mx-5835727-1","duration":541,"title":"${input.title}","audioUrl":"https://audio.example/episode.mp3","storyUrl":"${input.url}","program":"The Indicator from Planet Money"}'
        ></div>
        <a
          class="audio-tool audio-tool-transcript"
          href="https://www.npr.org/transcripts/${input.storyId}"
        >Transcript</a>
      </div>
    </article>
  `;
}

function buildNormalizedItem(input: {
  guid: string;
  rawExtensionData: Record<string, unknown>;
  url: string | null;
}): NormalizedItem {
  const title = "Example";
  const publishedAt = "2026-05-27T00:00:00.000Z";

  return {
    author: "NPR",
    contentHtml: "<p>Example</p>",
    dedupeKey: buildDedupeKey("feed-id", input.guid, input.url, title, publishedAt),
    guid: input.guid,
    publishedAt,
    rawExtensionData: input.rawExtensionData,
    summaryText: "Example",
    title,
    url: input.url
  };
}
