import type { Pool } from "pg";

import { recordNotificationBatch } from "./repository.js";
import type { WorkerConfig } from "./config.js";
import type { FetchCycleSummaryItem } from "./fetch/types.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 3_500;
const TELEGRAM_MAX_DETAIL_LINES = 120;
const TELEGRAM_API_BASE = "https://api.telegram.org";

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
  const lines = [
    `Feedyarder fetch cycle @ ${sentAt.toISOString()}`,
    `feeds=${summaryItems.length} success=${successCount} unchanged=${notModifiedCount} errors=${errorCount} missing_pubdate=${missingPublishedAtCount}`,
    `error_breakdown network=${networkErrorCount} parse=${parseErrorCount}`,
    `detail_limit=${TELEGRAM_MAX_DETAIL_LINES}`,
    ...grouped.lines
  ];

  if (grouped.omittedCount > 0) {
    lines.push(`+${grouped.omittedCount} more events omitted`);
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

  const messages = buildFetchCycleMessages(summaryItems, new Date());

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
): { lines: string[]; omittedCount: number } {
  const sections = [
    {
      items: summaryItems.filter(
        (item) => item.status === "error" && item.errorCategory === "network"
      ),
      title: "error/network"
    },
    {
      items: summaryItems.filter(
        (item) => item.status === "error" && item.errorCategory === "parse"
      ),
      title: "error/parse"
    },
    {
      items: summaryItems.filter((item) => item.status === "error" && !item.errorCategory),
      title: "error/other"
    },
    {
      items: summaryItems.filter((item) => item.status === "not_modified"),
      title: "not_modified"
    },
    {
      items: summaryItems.filter((item) => item.status === "success"),
      title: "success"
    }
  ];

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
    lines,
    omittedCount: Math.max(0, summaryItems.length - includedCount)
  };
}

function formatSummaryLine(item: FetchCycleSummaryItem): string {
  const feedTitle = item.feedTitle?.trim();
  const feedLabel = feedTitle
    ? `${truncateText(feedTitle, 80)} <${truncateText(item.feedUrl, 100)}>`
    : truncateText(item.feedUrl, 120);
  const missingPublishedAtPart =
    item.missingPublishedAtCount && item.missingPublishedAtCount > 0
      ? ` missing_pubdate=${item.missingPublishedAtCount}`
      : "";
  const messagePart = item.errorMessage
    ? ` message=${truncateText(item.errorMessage.replace(/\s+/g, " "), 180)}`
    : "";

  return `${feedLabel}${missingPublishedAtPart}${messagePart}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
