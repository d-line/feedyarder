import type { Pool } from "pg";

import type { WorkerConfig } from "./config.js";
import { categorizeFetchError } from "./fetch/errors.js";
import { fetchFeedDocument } from "./fetch/http.js";
import { parseFeedDocument } from "./fetch/normalize.js";
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
  const feedsToProcess = dueFeeds.slice(0, config.WORKER_BATCH_SIZE);
  const results = await mapWithConcurrency(
    feedsToProcess,
    config.WORKER_CONCURRENCY,
    (feed) => processFeed(feed, config)
  );

  for (const result of results) {
    await recordFetchOutcome(pool, result.feed, result.outcome);

    const summaryItem: FetchCycleSummaryItem = {
      consecutiveErrorCount:
        result.outcome.status === "error" ? result.feed.consecutiveErrorCount + 1 : 0,
      feedId: result.feed.id,
      feedUrl: result.feed.feedUrl,
      previousConsecutiveErrorCount: result.feed.consecutiveErrorCount,
      previousStatus: result.feed.status,
      status: result.outcome.status
    };
    const resolvedFeedTitle = result.feed.title ?? result.outcome.feedTitle ?? null;

    if (resolvedFeedTitle) {
      summaryItem.feedTitle = resolvedFeedTitle;
    }

    if (result.outcome.errorCategory) {
      summaryItem.errorCategory = result.outcome.errorCategory;
    }

    if (result.outcome.errorMessage) {
      summaryItem.errorMessage = result.outcome.errorMessage;
    }

    if (result.outcome.httpStatus !== null) {
      summaryItem.httpStatus = result.outcome.httpStatus;
    }

    if (result.feed.lastErrorCategory) {
      summaryItem.previousErrorCategory = result.feed.lastErrorCategory;
    }

    if (result.outcome.missingPublishedAtCount > 0) {
      summaryItem.missingPublishedAtCount = result.outcome.missingPublishedAtCount;
    }

    summaryItems.push(summaryItem);
  }

  await sendFetchCycleSummary(pool, config, summaryItems);
}

async function processFeed(
  feed: DueFeed,
  config: WorkerConfig
): Promise<{ feed: DueFeed; outcome: FetchOutcome }> {
  const startedAt = Date.now();

  try {
    const fetched = await fetchFeedDocument(feed, config);

    if (fetched.status === "not_modified") {
      return {
        feed,
        outcome: {
          durationMs: Date.now() - startedAt,
          errorCategory: null,
          errorMessage: null,
          etag: fetched.etag,
          faviconUrl: null,
          feedTitle: null,
          httpStatus: fetched.httpStatus,
          items: [],
          lastModified: fetched.lastModified,
          missingPublishedAtCount: 0,
          newItemCount: 0,
          nextFetchIntervalMinutes: calculateNextFetchIntervalMinutes({
            currentIntervalMinutes: feed.fetchIntervalMinutes,
            consecutiveErrorCount: feed.consecutiveErrorCount,
            newItemCount: 0,
            status: "not_modified"
          }),
          siteUrl: null,
          status: "not_modified"
        }
      };
    }

    const parsed = parseFeedDocument(fetched.body ?? "", feed.id);
    const newItemCount = parsed.items.length;

    return {
      feed,
      outcome: {
        durationMs: Date.now() - startedAt,
        errorCategory: null,
        errorMessage: null,
        etag: fetched.etag,
        faviconUrl: parsed.faviconUrl,
        feedTitle: parsed.title,
        httpStatus: fetched.httpStatus,
        items: parsed.items,
        lastModified: fetched.lastModified,
        missingPublishedAtCount: parsed.missingPublishedAtCount,
        newItemCount,
        nextFetchIntervalMinutes: calculateNextFetchIntervalMinutes({
          currentIntervalMinutes: feed.fetchIntervalMinutes,
          consecutiveErrorCount: feed.consecutiveErrorCount,
          newItemCount,
          status: "success"
        }),
        siteUrl: parsed.siteUrl,
        status: "success"
      }
    };
  } catch (error) {
    return {
      feed,
      outcome: {
        durationMs: Date.now() - startedAt,
        errorCategory: categorizeFetchError(error),
        errorMessage: error instanceof Error ? error.message : "Unknown fetch failure",
        etag: null,
        faviconUrl: null,
        feedTitle: null,
        httpStatus: "status" in (error as object) ? Number((error as { status?: number }).status) : null,
        items: [],
        lastModified: null,
        missingPublishedAtCount: 0,
        newItemCount: 0,
        nextFetchIntervalMinutes: calculateNextFetchIntervalMinutes({
          currentIntervalMinutes: feed.fetchIntervalMinutes,
          consecutiveErrorCount: feed.consecutiveErrorCount + 1,
          newItemCount: 0,
          status: "error"
        }),
        siteUrl: null,
        status: "error"
      }
    };
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  iteratee: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let currentIndex = 0;

  async function runWorker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await iteratee(items[index] as TInput);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}
