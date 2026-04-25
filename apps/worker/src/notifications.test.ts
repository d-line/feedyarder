import { describe, expect, it } from "vitest";

import { buildFetchCycleMessages } from "./notifications.js";
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
