import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNprFreshAirArchivePage,
  parseNprFreshAirArchivePage,
  resolveNprFreshAirArchiveUrl,
  sameNprArchiveMonth
} from "./npr.js";

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
