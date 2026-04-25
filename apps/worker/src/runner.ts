import type { Pool } from "pg";

import type { WorkerConfig } from "./config.js";
import { categorizeFetchError } from "./fetch/errors.js";
import { calculateNextFetchIntervalMinutes } from "./fetch/schedule.js";
import type { DueFeed, FetchCycleSummaryItem, FetchOutcome } from "./fetch/types.js";
import { sendFetchCycleSummary } from "./notifications.js";
import { listDueFeeds, recordFetchOutcome } from "./repository.js";

export async function runWorkerCycle(
  pool: Pool,
  config: WorkerConfig
): Promise<void> {
  const dueFeeds = await listDueFeeds(pool, config.WORKER_BATCH_SIZE);

  if (dueFeeds.length === 0) {
    console.log("Worker cycle: no feeds due");
    return;
  }

  const summaryItems: FetchCycleSummaryItem[] = [];
  const feedsToProcess = dueFeeds.slice(0, config.WORKER_CONCURRENCY);

  for (const feed of feedsToProcess) {
    const outcome = await processFeed(feed);

    await recordFetchOutcome(pool, feed, outcome);

    const summaryItem: FetchCycleSummaryItem = {
      feedId: feed.id,
      feedUrl: feed.feedUrl,
      status: outcome.status
    };

    if (outcome.errorCategory) {
      summaryItem.errorCategory = outcome.errorCategory;
    }

    if (outcome.errorMessage) {
      summaryItem.errorMessage = outcome.errorMessage;
    }

    if (outcome.missingPublishedAtCount > 0) {
      summaryItem.missingPublishedAtCount = outcome.missingPublishedAtCount;
    }

    summaryItems.push(summaryItem);
  }

  await sendFetchCycleSummary(pool, config, summaryItems);
}

async function processFeed(feed: DueFeed): Promise<FetchOutcome> {
  try {
    const result = await fetchFeedDocument(feed.feedUrl);

    const nextFetchIntervalMinutes = calculateNextFetchIntervalMinutes({
      currentIntervalMinutes: feed.fetchIntervalMinutes,
      consecutiveErrorCount: feed.consecutiveErrorCount,
      newItemCount: 0,
      status: result
    });

    return {
      status: result,
      missingPublishedAtCount: 0,
      nextFetchIntervalMinutes
    };
  } catch (error) {
    return {
      status: "error",
      errorCategory: categorizeFetchError(error),
      errorMessage: error instanceof Error ? error.message : "Unknown fetch failure",
      missingPublishedAtCount: 0,
      nextFetchIntervalMinutes: calculateNextFetchIntervalMinutes({
        currentIntervalMinutes: feed.fetchIntervalMinutes,
        consecutiveErrorCount: feed.consecutiveErrorCount + 1,
        newItemCount: 0,
        status: "error"
      })
    };
  }
}

async function fetchFeedDocument(feedUrl: string): Promise<"success" | "not_modified"> {
  console.log(`Fetch stub: ${feedUrl}`);

  if (feedUrl.trim().length === 0) {
    throw new Error("Feed URL is empty");
  }

  return "success";
}
