import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordNotificationBatchMock } = vi.hoisted(() => ({
  recordNotificationBatchMock: vi.fn()
}));

vi.mock("./repository.js", () => ({
  recordNotificationBatch: recordNotificationBatchMock
}));

import { buildFetchCycleMessages, sendFetchCycleSummary } from "./notifications.js";
import type { FetchCycleSummaryItem } from "./fetch/types.js";

describe("buildFetchCycleMessages", () => {
  it("builds a concise summary header and status lines", () => {
    const items: FetchCycleSummaryItem[] = [
      {
        feedId: "feed-1",
        feedTitle: "Example Feed 1",
        feedUrl: "https://example.com/feed-1.xml",
        status: "success"
      },
      {
        feedId: "feed-2",
        feedUrl: "https://example.com/feed-2.xml",
        status: "error",
        errorCategory: "parse",
        errorMessage: "invalid xml",
        missingPublishedAtCount: 2
      }
    ];

    const messages = buildFetchCycleMessages(items, new Date("2026-04-25T20:00:00.000Z"));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Feedyarder fetch cycle @ 2026-04-25T20:00:00.000Z");
    expect(messages[0]).toContain("feeds=2 success=1 unchanged=0 errors=1 missing_pubdate=2");
    expect(messages[0]).toContain("error_breakdown network=0 parse=1");
    expect(messages[0]).toContain("error/parse (1)");
    expect(messages[0]).toContain(
      "- https://example.com/feed-2.xml missing_pubdate=2 message=invalid xml"
    );
    expect(messages[0]).toContain("success (1)");
    expect(messages[0]).toContain(
      "- Example Feed 1 <https://example.com/feed-1.xml>"
    );
  });

  it("splits long summaries into multiple Telegram-sized messages", () => {
    const items: FetchCycleSummaryItem[] = Array.from({ length: 120 }, (_, index) => ({
      feedId: `feed-${index}`,
      feedUrl: `https://example.com/feed-${index}.xml`,
      status: "error" as const,
      errorCategory: "network" as const,
      errorMessage: "timeout while fetching feed data",
      missingPublishedAtCount: 1
    }));

    const messages = buildFetchCycleMessages(items, new Date("2026-04-25T20:00:00.000Z"));

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 3_500)).toBe(true);
    expect(messages[0]).toContain("feeds=120");
    expect(messages[0]).toContain("error/network");
    expect(messages.slice(1).every((message) => message.includes("Feedyarder fetch cycle (cont)"))).toBe(true);
  });

  it("caps details and emits omitted count", () => {
    const items: FetchCycleSummaryItem[] = Array.from({ length: 150 }, (_, index) => ({
      feedId: `feed-${index}`,
      feedUrl: `https://example.com/feed-${index}.xml`,
      status: "not_modified" as const
    }));

    const messages = buildFetchCycleMessages(items, new Date("2026-04-25T20:00:00.000Z"));

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.length <= 3_500)).toBe(true);
    expect(messages[0]).toContain("not_modified (150)");
    expect(messages.some((message) => message.includes("+30 more events omitted"))).toBe(true);
  });
});

describe("sendFetchCycleSummary", () => {
  const fakePool = {} as Pool;

  beforeEach(() => {
    recordNotificationBatchMock.mockReset();
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
        feedId: "feed-1",
        feedUrl: "https://example.com/feed-1.xml",
        status: "error",
        errorCategory: "network",
        errorMessage: "connection reset"
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends Telegram message when bot token and chat id are configured", async () => {
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
        status: "success",
        missingPublishedAtCount: 1
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
    expect(parsedBody.text).toContain("success (1)");
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
      feedId: `feed-${index}`,
      feedUrl: `https://example.com/feed-${index}.xml`,
      status: "error",
      errorCategory: "network",
      errorMessage: "timeout while fetching feed data"
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
