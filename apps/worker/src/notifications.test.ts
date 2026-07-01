import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  readLastNotificationBatchSentAtMock,
  readTelegramDailyDigestMock,
  recordNotificationBatchMock
} = vi.hoisted(() => ({
  readLastNotificationBatchSentAtMock: vi.fn(),
  readTelegramDailyDigestMock: vi.fn(),
  recordNotificationBatchMock: vi.fn()
}));

vi.mock("./repository.js", () => ({
  readLastNotificationBatchSentAt: readLastNotificationBatchSentAtMock,
  readTelegramDailyDigest: readTelegramDailyDigestMock,
  recordNotificationBatch: recordNotificationBatchMock
}));

import type { FetchCycleSummaryItem } from "./fetch/types.js";
import type { TelegramDailyDigest } from "./repository.js";
import { buildFetchCycleMessages, sendFetchCycleSummary } from "./notifications.js";

describe("buildFetchCycleMessages", () => {
  it("builds a concise actionable summary without normal feed details", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedTitle: "Example Feed 1",
        feedUrl: "https://example.com/feed-1.xml",
        status: "success"
      },
      {
        consecutiveErrorCount: 1,
        errorCategory: "parse",
        errorMessage: "invalid xml",
        feedId: "feed-2",
        feedUrl: "https://example.com/feed-2.xml",
        missingPublishedAtCount: 2,
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "error"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Feedyarder fetch cycle @ 2026-04-25T20:00:00.000Z");
    expect(messages[0]).toContain("feeds=2 success=1 unchanged=0 errors=1 missing_pubdate=2");
    expect(messages[0]).toContain("error_breakdown network=0 parse=1");
    expect(messages[0]).toContain("new_error/parse (1)");
    expect(messages[0]).toContain(
      "- https://example.com/feed-2.xml consecutive_errors=1 missing_pubdate=2 message=invalid xml"
    );
    expect(messages[0]).not.toContain("success (1)");
    expect(messages[0]).not.toContain("not_modified");
    expect(messages[0]).not.toContain("Example Feed 1");
  });

  it("returns no Telegram messages for cycles with only normal outcomes", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "success"
      },
      {
        feedId: "feed-2",
        feedUrl: "https://example.com/feed-2.xml",
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "not_modified"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toEqual([]);
  });

  it("sends a count-only Telegram summary for missing published dates without errors", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedTitle: "Example Feed",
        feedUrl: "https://example.com/feed-1.xml",
        missingPublishedAtCount: 3,
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "success"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("errors=0 missing_pubdate=3");
    expect(messages[0]).not.toContain("- Example Feed");
  });

  it("surfaces recoveries with the previous failure count", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedTitle: "Recovered Feed",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 7,
        previousStatus: "error",
        status: "not_modified"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("recovered (1)");
    expect(messages[0]).toContain(
      "- Recovered Feed <https://example.com/feed-1.xml> recovered_after=7"
    );
  });

  it("routes first 401 and 403 failures to the auth section", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        consecutiveErrorCount: 1,
        errorCategory: "network",
        errorMessage: "HTTP 401 while fetching feed",
        feedId: "feed-1",
        feedUrl: "https://example.com/private.xml",
        httpStatus: 401,
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "error"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("new_error/auth (1)");
    expect(messages[0]).toContain("http=401 consecutive_errors=1");
  });

  it("skips repeated failures until a persistent threshold is reached", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        consecutiveErrorCount: 2,
        errorCategory: "network",
        errorMessage: "timeout",
        feedId: "feed-1",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 1,
        previousStatus: "error",
        status: "error"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toEqual([]);
  });

  it("alerts repeated failures at persistent thresholds", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        consecutiveErrorCount: 3,
        errorCategory: "network",
        errorMessage: "timeout while fetching feed data",
        feedId: "feed-1",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 2,
        previousStatus: "error",
        status: "error"
      },
      {
        consecutiveErrorCount: 10,
        errorCategory: "parse",
        errorMessage: "invalid xml",
        feedId: "feed-2",
        feedUrl: "https://example.com/feed-2.xml",
        previousConsecutiveErrorCount: 9,
        previousStatus: "error",
        status: "error"
      }
    ];

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("persistent_error/threshold (2)");
    expect(messages[0]).toContain("consecutive_errors=3");
    expect(messages[0]).toContain("consecutive_errors=10");
  });

  it("splits long summaries into multiple Telegram-sized messages", () => {
    const items: FetchCycleSummaryItem[] = Array.from({ length: 120 }, (_, index) => ({
      consecutiveErrorCount: 1,
      errorCategory: "network" as const,
      errorMessage: "timeout while fetching feed data",
      feedId: `feed-${index}`,
      feedUrl: `https://example.com/feed-${index}.xml`,
      missingPublishedAtCount: 1,
      previousConsecutiveErrorCount: 0,
      previousStatus: "active",
      status: "error" as const
    }));

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 3_500)).toBe(true);
    expect(messages[0]).toContain("feeds=120");
    expect(messages[0]).toContain("new_error/network");
    expect(
      messages.slice(1).every((message) => message.includes("Feedyarder fetch cycle (cont)"))
    ).toBe(true);
  });

  it("caps actionable details and emits omitted count", () => {
    const items: FetchCycleSummaryItem[] = Array.from({ length: 150 }, (_, index) => ({
      consecutiveErrorCount: 3,
      errorCategory: "network" as const,
      errorMessage: "timeout while fetching feed data",
      feedId: `feed-${index}`,
      feedUrl: `https://example.com/feed-${index}.xml`,
      previousConsecutiveErrorCount: 2,
      previousStatus: "error",
      status: "error" as const
    }));

    const messages = buildFetchCycleMessages(
      items,
      new Date("2026-04-25T20:00:00.000Z")
    );

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.length <= 3_500)).toBe(true);
    expect(messages[0]).toContain("persistent_error/threshold (150)");
    expect(messages.some((message) => message.includes("+30 more actionable events omitted"))).toBe(true);
  });
});

describe("sendFetchCycleSummary", () => {
  const fakePool = {} as Pool;

  beforeEach(() => {
    recordNotificationBatchMock.mockReset();
    readLastNotificationBatchSentAtMock.mockReset();
    readTelegramDailyDigestMock.mockReset();
    readLastNotificationBatchSentAtMock.mockResolvedValue(
      new Date(Date.now() - 60 * 60 * 1000)
    );
    readTelegramDailyDigestMock.mockResolvedValue(buildDigestFixture());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("always records batch payload and skips Telegram when config is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summaryItems: FetchCycleSummaryItem[] = [
      {
        consecutiveErrorCount: 1,
        errorCategory: "network",
        errorMessage: "connection reset",
        feedId: "feed-1",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "error"
      }
    ];

    await sendFetchCycleSummary(
      fakePool,
      {
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_CHAT_ID: ""
      },
      summaryItems
    );

    expect(recordNotificationBatchMock).toHaveBeenCalledTimes(1);
    expect(recordNotificationBatchMock).toHaveBeenCalledWith(
      fakePool,
      "fetch_cycle",
      summaryItems
    );
    expect(readLastNotificationBatchSentAtMock).not.toHaveBeenCalled();
    expect(readTelegramDailyDigestMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores but skips Telegram when bot token and chat id are configured for normal cycles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const summaryItems: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedTitle: "Example Feed",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "success"
      }
    ];

    await sendFetchCycleSummary(
      fakePool,
      {
        TELEGRAM_BOT_TOKEN: "token-123",
        TELEGRAM_CHAT_ID: "chat-456"
      },
      summaryItems
    );

    expect(recordNotificationBatchMock).toHaveBeenCalledTimes(1);
    expect(readLastNotificationBatchSentAtMock).toHaveBeenCalledWith(
      fakePool,
      "telegram_daily_digest"
    );
    expect(readTelegramDailyDigestMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends Telegram message when bot token and chat id are configured for actionable cycles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const summaryItems: FetchCycleSummaryItem[] = [
      {
        consecutiveErrorCount: 1,
        errorCategory: "parse",
        errorMessage: "invalid xml",
        feedId: "feed-1",
        feedTitle: "Example Feed",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "error"
      }
    ];

    await sendFetchCycleSummary(
      fakePool,
      {
        TELEGRAM_BOT_TOKEN: "token-123",
        TELEGRAM_CHAT_ID: "chat-456"
      },
      summaryItems
    );

    expect(recordNotificationBatchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://api.telegram.org/bottoken-123/sendMessage");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json"
    });

    const parsedBody = JSON.parse(String(init.body)) as {
      chat_id: string;
      disable_web_page_preview: boolean;
      text: string;
    };
    expect(parsedBody.chat_id).toBe("chat-456");
    expect(parsedBody.disable_web_page_preview).toBe(true);
    expect(parsedBody.text).toContain("Feedyarder fetch cycle @");
    expect(parsedBody.text).toContain("new_error/parse (1)");
  });

  it("sends and records a daily digest when the digest window is due", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    readLastNotificationBatchSentAtMock.mockResolvedValue(null);

    const digest = buildDigestFixture({
      currentlyFailingFeedCount: 2,
      errorEventCount: 4,
      longestFailingFeeds: [
        {
          consecutiveErrorCount: 25,
          errorCategory: "network",
          errorMessage: "timeout",
          feedId: "feed-failing",
          feedTitle: "Failing Feed",
          feedUrl: "https://example.com/failing.xml",
          lastErrorAt: null,
          lastSuccessAt: null
        }
      ],
      newlyFailingFeeds: [
        {
          consecutiveErrorCount: 1,
          errorCategory: "parse",
          errorMessage: "invalid xml",
          feedId: "feed-new",
          feedTitle: null,
          feedUrl: "https://example.com/new.xml",
          lastErrorAt: null,
          lastSuccessAt: null
        }
      ],
      topErrorMessages: [
        {
          count: 3,
          errorCategory: "network",
          errorMessage: "timeout"
        }
      ]
    });
    readTelegramDailyDigestMock.mockResolvedValue(digest);

    const summaryItems: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedUrl: "https://example.com/feed-1.xml",
        previousConsecutiveErrorCount: 0,
        previousStatus: "active",
        status: "success"
      }
    ];

    await sendFetchCycleSummary(
      fakePool,
      {
        TELEGRAM_BOT_TOKEN: "token-123",
        TELEGRAM_CHAT_ID: "chat-456"
      },
      summaryItems
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(init.body)) as { text: string };
    expect(parsedBody.text).toContain("Feedyarder daily digest @");
    expect(parsedBody.text).toContain("currently_failing=2");
    expect(parsedBody.text).toContain("newly_failing (1)");
    expect(parsedBody.text).toContain("longest_failing (1)");
    expect(parsedBody.text).toContain("top_errors (1)");
    expect(recordNotificationBatchMock).toHaveBeenCalledTimes(2);
    expect(recordNotificationBatchMock).toHaveBeenNthCalledWith(
      2,
      fakePool,
      "telegram_daily_digest",
      digest
    );
  });

  it("stops sending additional Telegram chunks after first send failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "bad request" }), {
        status: 500
      })
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const summaryItems: FetchCycleSummaryItem[] = Array.from({ length: 120 }, (_, index) => ({
      consecutiveErrorCount: 1,
      errorCategory: "network",
      errorMessage: "timeout while fetching feed data",
      feedId: `feed-${index}`,
      feedUrl: `https://example.com/feed-${index}.xml`,
      previousConsecutiveErrorCount: 0,
      previousStatus: "active",
      status: "error"
    }));

    await sendFetchCycleSummary(
      fakePool,
      {
        TELEGRAM_BOT_TOKEN: "token-123",
        TELEGRAM_CHAT_ID: "chat-456"
      },
      summaryItems
    );

    expect(recordNotificationBatchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

function buildDigestFixture(
  overrides: Partial<TelegramDailyDigest> = {}
): TelegramDailyDigest {
  return {
    activeFeedCount: 3,
    checkedFeedCount: 2,
    currentlyFailingFeedCount: 0,
    currentlyFailingNetworkCount: 0,
    currentlyFailingParseCount: 0,
    errorEventCount: 0,
    fetchEventCount: 2,
    longestFailingFeeds: [],
    missingPublishedAtCount: 0,
    newlyFailingFeeds: [],
    pausedFeedCount: 1,
    recoveredFeedCount: 0,
    recoveredFeeds: [],
    since: new Date("2026-04-24T20:00:00.000Z"),
    topErrorMessages: [],
    totalFeedCount: 4,
    ...overrides
  };
}
