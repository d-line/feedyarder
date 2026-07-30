import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTedTalksArchiveSearchRequest,
  fetchTedTalkDetailItem,
  fetchTedTalksArchivePage,
  isTedTalksHdFeed,
  parseTedTalkDetailPage,
  parseTedTalksArchiveSearchResponse
} from "./ted.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isTedTalksHdFeed", () => {
  it("matches the legacy TED Talks HD FeedBurner URL", () => {
    expect(isTedTalksHdFeed("http://feeds.feedburner.com/TedtalksHD")).toBe(true);
    expect(isTedTalksHdFeed("https://feeds.feedburner.com/TedtalksHD")).toBe(true);
    expect(isTedTalksHdFeed("https://feeds.feedburner.com/OtherFeed")).toBe(false);
  });
});

describe("buildTedTalksArchiveSearchRequest", () => {
  it("builds the TED archive search request body", () => {
    expect(buildTedTalksArchiveSearchRequest(2)).toEqual([
      {
        indexName: "newest",
        params: {
          attributeForDistinct: "objectID",
          distinct: 1,
          facets: ["subtitle_languages", "tags"],
          highlightPostTag: "__/ais-highlight__",
          highlightPreTag: "__ais-highlight__",
          hitsPerPage: 24,
          maxValuesPerFacet: 500,
          page: 2,
          query: ""
        }
      }
    ]);
  });
});

describe("parseTedTalksArchiveSearchResponse", () => {
  it("normalizes TED archive hits as detail-fetch fallbacks", () => {
    const result = parseTedTalksArchiveSearchResponse(
      JSON.stringify({
        results: [
          {
            hits: [
              {
                _index: "newest",
                duration: "817.25",
                objectID: "647897",
                photos: [
                  {
                    photo_sizes: [
                      {
                        height: 480,
                        talkstar_aspect_ratio_id: 3,
                        url: "https://pi.tedcdn.com/r/talkstar-assets.example/4x3.jpg",
                        width: 640
                      },
                      {
                        height: 720,
                        talkstar_aspect_ratio_id: 2,
                        url: "https://pi.tedcdn.com/r/talkstar-assets.example/16x9.jpg",
                        width: 1280
                      }
                    ]
                  }
                ],
                slug: "drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
                speakers: "Drew McCartor",
                title: "The deadly threat affecting millions"
              },
              {
                objectID: "missing-title",
                slug: "missing_title"
              }
            ],
            nbHits: 7584,
            nbPages: 316,
            page: 0
          }
        ]
      }),
      0,
      "feed-id"
    );

    expect(result).toEqual({
      hasNextPage: true,
      items: [
        expect.objectContaining({
          author: "Drew McCartor",
          contentHtml:
            '<p><a href="https://www.ted.com/talks/drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it">The deadly threat affecting millions</a></p><p>Speaker: Drew McCartor | Duration: 13:37</p><p><img src="https://pi.tedcdn.com/r/talkstar-assets.example/16x9.jpg" alt="The deadly threat affecting millions"></p>',
          guid: "ted:video:647897",
          publishedAt: null,
          rawExtensionData: {
            ted: {
              backfilledFrom: "https://www.ted.com/api/search",
              detailFetched: false,
              durationSeconds: 817.25,
              objectId: "647897",
              pageNumber: 0,
              slug: "drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
              sortIndex: "newest",
              sourceIndex: "newest",
              speakers: "Drew McCartor",
              thumbnail: {
                aspectRatioId: 2,
                aspectRatioName: null,
                height: 720,
                url: "https://pi.tedcdn.com/r/talkstar-assets.example/16x9.jpg",
                width: 1280
              }
            }
          },
          summaryText: "TED talk by Drew McCartor.",
          title: "The deadly threat affecting millions",
          url: "https://www.ted.com/talks/drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it"
        })
      ],
      nbHits: 7584,
      nbPages: 316,
      pageNumber: 0
    });
    expect(result.items[0]?.dedupeKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stops at the final TED archive page", () => {
    const result = parseTedTalksArchiveSearchResponse(
      JSON.stringify({
        results: [
          {
            hits: [
              {
                objectID: "1",
                slug: "example_talk",
                title: "Example Talk"
              }
            ],
            nbHits: 25,
            nbPages: 2,
            page: 1
          }
        ]
      }),
      1,
      "feed-id"
    );

    expect(result.hasNextPage).toBe(false);
  });
});

describe("fetchTedTalksArchivePage", () => {
  it("retries transient TED archive HTTP failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 504 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                hits: [],
                nbHits: 0,
                nbPages: 0,
                page: 0
              }
            ]
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchTedTalksArchivePage(0, "feed-id", 5_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(request).resolves.toMatchObject({
      items: [],
      nbHits: 0,
      nbPages: 0
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after three transient TED archive failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 504 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchTedTalksArchivePage(0, "feed-id", 5_000);
    const rejection = expect(request).rejects.toThrow(
      "TED Talks archive request failed with HTTP 504."
    );

    await vi.advanceTimersByTimeAsync(3_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("fetchTedTalkDetailItem", () => {
  it("retries transient TED detail HTTP failures", async () => {
    vi.useFakeTimers();
    const archiveItem = parseTedTalksArchiveSearchResponse(
      JSON.stringify({
        results: [
          {
            hits: [
              {
                objectID: "647897",
                slug: "drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
                title: "The deadly threat affecting millions"
              }
            ],
            nbHits: 1,
            nbPages: 1,
            page: 0
          }
        ]
      }),
      0,
      "feed-id"
    ).items[0];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 504 }))
      .mockResolvedValueOnce(
        new Response(
          `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                videoData: {
                  canonicalUrl:
                    "https://www.ted.com/talks/drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
                  id: "184697",
                  publishedAt: "2026-07-10T14:39:19Z",
                  title: "The deadly threat affecting millions"
                }
              }
            }
          })}</script>`,
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchTedTalkDetailItem(archiveItem!, "feed-id", 5_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(request).resolves.toMatchObject({
      guid: "en.hd.talk.ted.com:184697",
      publishedAt: "2026-07-10T14:39:19.000Z"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null for missing TED detail pages without retrying", async () => {
    const archiveItem = parseTedTalksArchiveSearchResponse(
      JSON.stringify({
        results: [
          {
            hits: [
              {
                objectID: "647897",
                slug: "missing_talk",
                title: "Missing Talk"
              }
            ],
            nbHits: 1,
            nbPages: 1,
            page: 0
          }
        ]
      }),
      0,
      "feed-id"
    ).items[0];
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTedTalkDetailItem(archiveItem!, "feed-id", 5_000)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("parseTedTalkDetailPage", () => {
  it("enriches archive items with TED detail publication dates", () => {
    const archivePage = parseTedTalksArchiveSearchResponse(
      JSON.stringify({
        results: [
          {
            hits: [
              {
                duration: "590.256",
                objectID: "647897",
                slug: "drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
                speakers: "Drew McCartor",
                title: "The deadly threat affecting millions — and how to prevent it"
              }
            ],
            nbHits: 1,
            nbPages: 1,
            page: 0
          }
        ]
      }),
      0,
      "feed-id"
    );
    const archiveItem = archivePage.items[0];

    expect(archiveItem).toBeDefined();

    const item = parseTedTalkDetailPage(
      `<!doctype html>
      <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                videoData: {
                  canonicalUrl:
                    "https://www.ted.com/talks/drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
                  description:
                    "Lead poisoning robs the world's kids of millions of IQ points a day.",
                  duration: 593,
                  hlsUrl: "https://hls.ted.com/talk.m3u8",
                  id: "184697",
                  playerData: JSON.stringify({
                    id: 647897
                  }),
                  presenterDisplayName: "Drew McCartor",
                  primaryImageSet: [
                    {
                      aspectRatioName: "16x9",
                      url: "https://pi.tedcdn.com/r/talkstar-assets.example/16x9-detail.jpg"
                    }
                  ],
                  publishedAt: "2026-07-10T14:39:19Z",
                  recordedOn: "2026-04-14",
                  title: "The deadly threat affecting millions — and how to prevent it",
                  topics: {
                    nodes: [
                      {
                        name: "health"
                      },
                      {
                        name: "public health"
                      }
                    ]
                  }
                }
              }
            }
          })}</script>
        </head>
      </html>`,
      "https://www.ted.com/talks/drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it",
      archiveItem!,
      "feed-id"
    );

    expect(item).toEqual(
      expect.objectContaining({
        author: "Drew McCartor",
        guid: "en.hd.talk.ted.com:184697",
        publishedAt: "2026-07-10T14:39:19.000Z",
        rawExtensionData: {
          ted: expect.objectContaining({
            detailFetched: true,
            durationSeconds: 593,
            mediaId: "647897",
            objectId: "647897",
            recordedOn: "2026-04-14",
            talkId: "184697",
            topics: ["health", "public health"]
          })
        },
        summaryText: "Lead poisoning robs the world's kids of millions of IQ points a day.",
        title: "The deadly threat affecting millions — and how to prevent it",
        url: "https://www.ted.com/talks/drew_mccartor_the_deadly_threat_affecting_millions_and_how_to_prevent_it"
      })
    );
    expect(item?.contentHtml).toContain("Recorded: 2026-04-14");
    expect(item?.dedupeKey).toMatch(/^[a-f0-9]{64}$/);
  });
});
