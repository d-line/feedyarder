import type { Pool } from "pg";

import { recordNotificationBatch } from "./repository.js";
import type { WorkerConfig } from "./config.js";
import type { FetchCycleSummaryItem } from "./fetch/types.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 3_500;
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
  const header = [
    `Feedyarder fetch cycle @ ${sentAt.toISOString()}`,
    `feeds=${summaryItems.length} success=${successCount} unchanged=${notModifiedCount} errors=${errorCount} missing_pubdate=${missingPublishedAtCount}`
  ].join("\n");
  const lines = summaryItems.map((item) => formatSummaryLine(item));

  return chunkMessages(header, lines);
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

function chunkMessages(header: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [header];
  }

  const messages: string[] = [];
  let currentMessage = header;

  for (const line of lines) {
    const safeLine = line.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 64);
    const nextMessage =
      currentMessage.length > 0 ? `${currentMessage}\n${safeLine}` : safeLine;

    if (nextMessage.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      messages.push(currentMessage);
      currentMessage = `Feedyarder fetch cycle (cont)\n${safeLine}`;
      continue;
    }

    currentMessage = nextMessage;
  }

  if (currentMessage.length > 0) {
    messages.push(currentMessage);
  }

  return messages;
}

function formatSummaryLine(item: FetchCycleSummaryItem): string {
  const feedLabel = truncateText(item.feedUrl, 120);
  const statusPart = item.status;
  const categoryPart = item.errorCategory ? `/${item.errorCategory}` : "";
  const missingPublishedAtPart =
    item.missingPublishedAtCount && item.missingPublishedAtCount > 0
      ? ` missing_pubdate=${item.missingPublishedAtCount}`
      : "";
  const messagePart = item.errorMessage
    ? ` message=${truncateText(item.errorMessage.replace(/\s+/g, " "), 180)}`
    : "";

  return `${statusPart}${categoryPart} ${feedLabel}${missingPublishedAtPart}${messagePart}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
