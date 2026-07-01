import type { Pool } from "pg";

import {
  readLastNotificationBatchSentAt,
  readTelegramDailyDigest,
  recordNotificationBatch,
  type TelegramDailyDigest,
  type TelegramDigestErrorSummary,
  type TelegramDigestFeedSummary,
  type TelegramDigestRecoveredFeed
} from "./repository.js";
import type { WorkerConfig } from "./config.js";
import type { FetchCycleSummaryItem } from "./fetch/types.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 3_500;
const TELEGRAM_MAX_DETAIL_LINES = 120;
const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_DAILY_DIGEST_KIND = "telegram_daily_digest";
const TELEGRAM_DAILY_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PERSISTENT_ERROR_ALERT_COUNTS = new Set([3, 10, 25]);

interface TelegramSendMessageResponse {
  ok: boolean;
  description?: string;
}

interface SendTelegramMessageInput {
  botToken: string;
  chatId: string;
  text: string;
}

export function buildFetchCycleMessages(
  summaryItems: FetchCycleSummaryItem[],
  sentAt: Date
): string[] {
  const successCount = summaryItems.filter((item) => item.status === "success").length;
  const notModifiedCount = summaryItems.filter(
    (item) => item.status === "not_modified"
  ).length;
  const errorCount = summaryItems.filter((item) => item.status === "error").length;
  const missingPublishedAtCount = summaryItems.reduce(
    (total, item) => total + (item.missingPublishedAtCount ?? 0),
    0
  );
  const networkErrorCount = summaryItems.filter(
    (item) => item.status === "error" && item.errorCategory === "network"
  ).length;
  const parseErrorCount = summaryItems.filter(
    (item) => item.status === "error" && item.errorCategory === "parse"
  ).length;
  const grouped = buildGroupedDetailLines(summaryItems, TELEGRAM_MAX_DETAIL_LINES);

  if (grouped.actionableCount === 0 && missingPublishedAtCount === 0) {
    return [];
  }

  const lines = [
    `Feedyarder fetch cycle @ ${sentAt.toISOString()}`,
    `feeds=${summaryItems.length} success=${successCount} unchanged=${notModifiedCount} errors=${errorCount} missing_pubdate=${missingPublishedAtCount}`,
    `error_breakdown network=${networkErrorCount} parse=${parseErrorCount}`
  ];

  if (grouped.actionableCount > 0) {
    lines.push(`actionable_detail_limit=${TELEGRAM_MAX_DETAIL_LINES}`, ...grouped.lines);
  }

  if (grouped.omittedCount > 0) {
    lines.push(`+${grouped.omittedCount} more actionable events omitted`);
  }

  return chunkMessageLines(lines);
}

export async function sendFetchCycleSummary(
  pool: Pool,
  config: Pick<WorkerConfig, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHAT_ID">,
  summaryItems: FetchCycleSummaryItem[]
): Promise<void> {
  if (summaryItems.length === 0) {
    return;
  }

  await recordNotificationBatch(pool, "fetch_cycle", summaryItems);

  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log("Telegram not configured, summary stored only");
    return;
  }

  const sentAt = new Date();
  const digestResult = await buildDueDailyDigestMessages(pool, sentAt);
  const messages = [
    ...buildFetchCycleMessages(summaryItems, sentAt),
    ...digestResult.messages
  ];

  if (messages.length === 0) {
    console.log("No actionable Telegram summary for fetch cycle");
    return;
  }

  for (const message of messages) {
    try {
      await sendTelegramMessage({
        botToken: config.TELEGRAM_BOT_TOKEN,
        chatId: config.TELEGRAM_CHAT_ID,
        text: message
      });
    } catch (error) {
      console.error("Failed to send Telegram fetch-cycle summary", error);
      return;
    }
  }

  if (digestResult.digest) {
    await recordNotificationBatch(pool, TELEGRAM_DAILY_DIGEST_KIND, digestResult.digest);
  }
}

async function sendTelegramMessage(input: SendTelegramMessageInput): Promise<void> {
  const endpoint = `${TELEGRAM_API_BASE}/bot${input.botToken}/sendMessage`;
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      chat_id: input.chatId,
      disable_web_page_preview: true,
      text: input.text
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  let parsed: TelegramSendMessageResponse | null = null;

  try {
    parsed = (await response.json()) as TelegramSendMessageResponse;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      `Telegram sendMessage HTTP ${response.status}: ${parsed?.description ?? "Unknown response"}`
    );
  }

  if (!parsed?.ok) {
    throw new Error(`Telegram sendMessage failed: ${parsed?.description ?? "Unknown error"}`);
  }
}

function chunkMessageLines(lines: string[]): string[] {
  const messages: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    const safeLine = line.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 128);
    const nextLines = currentLines.length > 0 ? [...currentLines, safeLine] : [safeLine];
    const nextMessage = nextLines.join("\n");

    if (nextMessage.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      currentLines = nextLines;
      continue;
    }

    if (currentLines.length > 0) {
      messages.push(currentLines.join("\n"));
      currentLines = [`Feedyarder fetch cycle (cont)`, safeLine];
      continue;
    }

    messages.push(safeLine.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH));
  }

  if (currentLines.length > 0) {
    messages.push(currentLines.join("\n"));
  }

  return messages;
}

function buildGroupedDetailLines(
  summaryItems: FetchCycleSummaryItem[],
  maxDetailLines: number
): { actionableCount: number; lines: string[]; omittedCount: number } {
  const sections = [
    {
      items: summaryItems.filter(isRecovered),
      title: "recovered"
    },
    {
      items: summaryItems.filter(
        (item) => isNewError(item) && isAuthAccessError(item)
      ),
      title: "new_error/auth"
    },
    {
      items: summaryItems.filter(
        (item) => isNewError(item) && !isAuthAccessError(item) && item.errorCategory === "parse"
      ),
      title: "new_error/parse"
    },
    {
      items: summaryItems.filter(
        (item) =>
          isNewError(item) &&
          !isAuthAccessError(item) &&
          item.errorCategory === "network"
      ),
      title: "new_error/network"
    },
    {
      items: summaryItems.filter(
        (item) => isNewError(item) && !isAuthAccessError(item) && !item.errorCategory
      ),
      title: "new_error/other"
    },
    {
      items: summaryItems.filter(isPersistentErrorThreshold),
      title: "persistent_error/threshold"
    }
  ];
  const actionableCount = sections.reduce((total, section) => total + section.items.length, 0);

  const lines: string[] = [];
  let includedCount = 0;

  for (const section of sections) {
    if (section.items.length === 0) {
      continue;
    }

    if (includedCount >= maxDetailLines) {
      break;
    }

    lines.push(`${section.title} (${section.items.length})`);

    for (const item of section.items) {
      if (includedCount >= maxDetailLines) {
        break;
      }

      lines.push(`- ${formatSummaryLine(item)}`);
      includedCount += 1;
    }
  }

  return {
    actionableCount,
    lines,
    omittedCount: Math.max(0, actionableCount - includedCount)
  };
}

async function buildDueDailyDigestMessages(
  pool: Pool,
  sentAt: Date
): Promise<{ digest: TelegramDailyDigest | null; messages: string[] }> {
  const lastDigestSentAt = await readLastNotificationBatchSentAt(
    pool,
    TELEGRAM_DAILY_DIGEST_KIND
  );

  if (
    lastDigestSentAt &&
    sentAt.getTime() - lastDigestSentAt.getTime() < TELEGRAM_DAILY_DIGEST_INTERVAL_MS
  ) {
    return {
      digest: null,
      messages: []
    };
  }

  const since =
    lastDigestSentAt ??
    new Date(sentAt.getTime() - TELEGRAM_DAILY_DIGEST_INTERVAL_MS);
  const digest = await readTelegramDailyDigest(pool, since);

  return {
    digest,
    messages: buildTelegramDailyDigestMessages(digest, sentAt)
  };
}

function buildTelegramDailyDigestMessages(
  digest: TelegramDailyDigest,
  sentAt: Date
): string[] {
  const lines = [
    `Feedyarder daily digest @ ${sentAt.toISOString()}`,
    `window_since=${digest.since.toISOString()}`,
    `feeds total=${digest.totalFeedCount} active=${digest.activeFeedCount} paused=${digest.pausedFeedCount} checked=${digest.checkedFeedCount} currently_failing=${digest.currentlyFailingFeedCount}`,
    `events fetch=${digest.fetchEventCount} errors=${digest.errorEventCount} missing_pubdate=${digest.missingPublishedAtCount} recovered_shown=${digest.recoveredFeedCount}`,
    `current_error_breakdown network=${digest.currentlyFailingNetworkCount} parse=${digest.currentlyFailingParseCount}`,
    ...formatDailyDigestFeedSection("newly_failing", digest.newlyFailingFeeds),
    ...formatDailyDigestRecoveredSection("recovered", digest.recoveredFeeds),
    ...formatDailyDigestFeedSection("longest_failing", digest.longestFailingFeeds),
    ...formatDailyDigestErrorSection("top_errors", digest.topErrorMessages)
  ];

  return chunkMessageLines(lines);
}

function formatDailyDigestFeedSection(
  title: string,
  feeds: TelegramDigestFeedSummary[]
): string[] {
  if (feeds.length === 0) {
    return [];
  }

  return [
    `${title} (${feeds.length})`,
    ...feeds.map(
      (feed) =>
        `- ${formatFeedLabel(feed.feedTitle, feed.feedUrl)} consecutive_errors=${feed.consecutiveErrorCount}${formatNullablePart(" category", feed.errorCategory)}${formatNullablePart(" message", compactErrorMessage(feed.errorMessage))}`
    )
  ];
}

function formatDailyDigestRecoveredSection(
  title: string,
  feeds: TelegramDigestRecoveredFeed[]
): string[] {
  if (feeds.length === 0) {
    return [];
  }

  return [
    `${title} (${feeds.length})`,
    ...feeds.map((feed) => `- ${formatFeedLabel(feed.feedTitle, feed.feedUrl)}`)
  ];
}

function formatDailyDigestErrorSection(
  title: string,
  errors: TelegramDigestErrorSummary[]
): string[] {
  if (errors.length === 0) {
    return [];
  }

  return [
    `${title} (${errors.length})`,
    ...errors.map(
      (error) =>
        `- count=${error.count}${formatNullablePart(" category", error.errorCategory)}${formatNullablePart(" message", compactErrorMessage(error.errorMessage))}`
    )
  ];
}

function isRecovered(item: FetchCycleSummaryItem): boolean {
  return item.previousStatus === "error" && item.status !== "error";
}

function isNewError(item: FetchCycleSummaryItem): boolean {
  return (
    item.status === "error" &&
    (item.previousStatus !== "error" ||
      (item.previousConsecutiveErrorCount ?? 0) === 0)
  );
}

function isPersistentErrorThreshold(item: FetchCycleSummaryItem): boolean {
  return (
    item.status === "error" &&
    !isNewError(item) &&
    PERSISTENT_ERROR_ALERT_COUNTS.has(item.consecutiveErrorCount ?? 0)
  );
}

function isAuthAccessError(item: FetchCycleSummaryItem): boolean {
  return item.httpStatus === 401 || item.httpStatus === 403;
}

function formatSummaryLine(item: FetchCycleSummaryItem): string {
  const feedLabel = formatFeedLabel(item.feedTitle, item.feedUrl);
  const httpStatusPart = item.httpStatus ? ` http=${item.httpStatus}` : "";
  const consecutiveErrorPart =
    item.status === "error" && item.consecutiveErrorCount
      ? ` consecutive_errors=${item.consecutiveErrorCount}`
      : "";
  const recoveredPart =
    item.status !== "error" && item.previousConsecutiveErrorCount
      ? ` recovered_after=${item.previousConsecutiveErrorCount}`
      : "";
  const missingPublishedAtPart =
    item.missingPublishedAtCount && item.missingPublishedAtCount > 0
      ? ` missing_pubdate=${item.missingPublishedAtCount}`
      : "";
  const messagePart = item.errorMessage
    ? ` message=${truncateText(compactErrorMessage(item.errorMessage) ?? "", 180)}`
    : "";

  return `${feedLabel}${httpStatusPart}${consecutiveErrorPart}${recoveredPart}${missingPublishedAtPart}${messagePart}`;
}

function formatFeedLabel(feedTitle: string | null | undefined, feedUrl: string): string {
  const trimmedFeedTitle = feedTitle?.trim();

  return trimmedFeedTitle
    ? `${truncateText(trimmedFeedTitle, 80)} <${truncateText(feedUrl, 100)}>`
    : truncateText(feedUrl, 120);
}

function formatNullablePart(label: string, value: string | null | undefined): string {
  return value ? `${label}=${truncateText(value, 180)}` : "";
}

function compactErrorMessage(value: string | null | undefined): string | null {
  return value ? value.replace(/\s+/g, " ") : null;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
