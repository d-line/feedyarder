import { describe, expect, it } from "vitest";

import {
  parseNprFreshAirArchivePage,
  resolveNprFreshAirArchiveUrl,
  sameNprArchiveMonth
} from "./npr.js";

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
