import type { Pool } from "pg";

import { recordNotificationBatch } from "./repository.js";
import type { WorkerConfig } from "./config.js";
import type { FetchCycleSummaryItem } from "./fetch/types.js";

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

  console.log(
    `Telegram summary stub: would send ${summaryItems.length} fetch-cycle events to chat ${config.TELEGRAM_CHAT_ID}`
  );
}
