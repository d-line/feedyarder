import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRutrackerForumUrl,
  fetchRutrackerBackfillPage,
  parseRutrackerForumPage
} from "./rutracker.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildRutrackerForumUrl", () => {
  it("includes an explicit pagination start offset", () => {
    expect(buildRutrackerForumUrl("1702", 150)).toBe(
      "https://rutracker.org/forum/viewforum.php?f=1702&start=150"
    );
  });

  it("omits the start parameter when no offset was requested", () => {
    expect(buildRutrackerForumUrl("1702", null)).toBe(
      "https://rutracker.org/forum/viewforum.php?f=1702"
    );
  });
});

describe("parseRutrackerForumPage", () => {
  it("extracts forum topics and pagination metadata", () => {
    const page = parseRutrackerForumPage(
      `
        <html>
          <body>
            <table>
              <tr class="hl-tr">
                <td><a class="torTopic bold tt-text" href="./viewtopic.php?t=12345">First topic</a></td>
                <td><a href="./profile.php?mode=viewprofile&amp;u=10">poster</a></td>
                <td>2024-04-13 02:08</td>
              </tr>
              <tr class="hl-tr">
                <td><a class="torTopic" href="/forum/viewtopic.php?t=67890&amp;start=20">Second topic</a></td>
                <td>no date</td>
              </tr>
            </table>
            <div class="nav">
              <a href="./viewforum.php?f=1702">1</a>
              <a href="./viewforum.php?f=1702&amp;start=50">2</a>
              <a href="./viewforum.php?f=1702&amp;start=100">3</a>
              <a href="./viewforum.php?f=1702&amp;start=22200">445</a>
              <a href="./viewforum.php?f=1702&amp;start=22250">446</a>
              <a href="./viewforum.php?f=1702&amp;start=22300">447</a>
            </div>
          </body>
        </html>
      `,
      "https://rutracker.org/forum/viewforum.php?f=1702",
      "feed-id"
    );

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      author: "poster",
      guid: "rutracker-topic:12345",
      publishedAt: "2024-04-13T02:08:00.000Z",
      title: "First topic",
      url: "https://rutracker.org/forum/viewtopic.php?t=12345"
    });
    expect(page.items[1]).toMatchObject({
      guid: "rutracker-topic:67890",
      publishedAt: null,
      title: "Second topic",
      url: "https://rutracker.org/forum/viewtopic.php?t=67890"
    });
    expect(page.pageSize).toBe(50);
    expect(page.maxStart).toBe(22300);
  });
});

describe("fetchRutrackerBackfillPage", () => {
  it("retries transient HTTP failures with exponential delays", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchRutrackerBackfillPage(
      "https://rutracker.org/forum/viewforum.php?f=1702",
      "feed-id",
      5_000
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(request).resolves.toMatchObject({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries network errors and returns the later successful response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchRutrackerBackfillPage(
      "https://rutracker.org/forum/viewforum.php?f=1702",
      "feed-id",
      5_000
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(request).resolves.toMatchObject({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient HTTP failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRutrackerBackfillPage(
        "https://rutracker.org/forum/viewforum.php?f=1702",
        "feed-id",
        5_000
      )
    ).rejects.toThrow("RuTracker backfill request failed with HTTP 404.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws after three transient failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchRutrackerBackfillPage(
      "https://rutracker.org/forum/viewforum.php?f=1702",
      "feed-id",
      5_000
    );
    const rejection = expect(request).rejects.toThrow(
      "RuTracker backfill request failed with HTTP 503."
    );

    await vi.advanceTimersByTimeAsync(3_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
