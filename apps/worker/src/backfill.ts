import { getConfig } from "./config.js";
import { getPool } from "./db/pool.js";
import { fetchRutrackerBackfillPage } from "./backfill/rutracker.js";
import {
  collectYouTubeBackfillItemBatches,
  resolveYouTubeBackfillUrls
} from "./backfill/youtube.js";
import {
  getFeedBackfillTarget,
  insertItemsWithResults,
  type FeedBackfillTarget
} from "./repository.js";
import type { NormalizedItem } from "./fetch/types.js";
import type { Pool } from "pg";

const defaultRequestDelayMs = 500;
const maxPages = 1_000;

async function run(): Promise<void> {
  const feedId = process.argv[2];

  if (!feedId) {
    throw new Error("Usage: npm run backfill -- <feed-id>");
  }

  const config = getConfig();
  const pool = getPool(config.DATABASE_URL);

  try {
    const feed = await getFeedBackfillTarget(pool, feedId);

    if (!feed) {
      throw new Error(`Feed ${feedId} was not found.`);
    }

    const result = isYouTubeFeed(feed)
      ? await backfillYouTubeFeed(pool, feed, config.FETCH_TOTAL_TIMEOUT_MS)
      : await backfillRutrackerFeed(pool, feed, config.FETCH_TOTAL_TIMEOUT_MS);

    console.log(
      `Backfill complete for ${feed.title ?? feed.feedUrl}: source=${result.source} pages=${result.pageCount} discovered=${result.discoveredCount} inserted=${result.insertedCount}`
    );
  } finally {
    await pool.end();
  }
}

async function backfillYouTubeFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const urls = resolveYouTubeBackfillUrls(feed);
  let discoveredCount = 0;
  let insertedCount = 0;

  for (const url of urls) {
    console.log(`Backfill crawling ${url.tab} ${url.url}`);

    const summary = await collectYouTubeBackfillItemBatches(
      url.url,
      url.tab,
      feed.id,
      timeoutMs,
      async (batch) => {
        console.log(
          `Backfill YouTube batch ready: tab=${url.tab} batch=${batch.batchNumber} items=${batch.items.length} parsed=${batch.parsedCount} normalized=${batch.normalizedCount} skipped=${batch.skippedCount}`
        );

        discoveredCount += batch.items.length;

        for (const result of await insertItemsWithResults(pool, feed.id, batch.items)) {
          console.log(formatInsertDebugLine(result.item, result.inserted));

          if (result.inserted) {
            insertedCount += 1;
          }
        }
      }
    );
    console.log(
      `Backfill yt-dlp parsed: tab=${url.tab} parsed=${summary.parsedCount} normalized=${summary.normalizedCount} skipped=${summary.skippedCount} batches=${summary.batchCount}`
    );
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: urls.length,
    source: "youtube"
  };
}

async function backfillRutrackerFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveRutrackerBackfillStartUrl(feed);
  const result = await crawlRutrackerForum(pool, feed.id, startUrl, timeoutMs);

  return {
    ...result,
    source: "rutracker"
  };
}

async function crawlRutrackerForum(
  pool: Pool,
  feedId: string,
  startUrl: string,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number }> {
  const seen = new Set<string>();
  let pageUrl: string | null = startUrl;
  let discoveredCount = 0;
  let insertedCount = 0;

  while (pageUrl && seen.size < maxPages) {
    if (seen.has(pageUrl)) {
      break;
    }

    seen.add(pageUrl);
    console.log(`Backfill crawling ${pageUrl}`);

    const page = await fetchRutrackerBackfillPage(pageUrl, feedId, timeoutMs);
    console.log(
      `Backfill page parsed: items=${page.items.length} pageSize=${page.pageSize} maxStart=${page.maxStart ?? "unknown"}`
    );

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feedId, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = resolveNextForumPageUrl(pageUrl, page.pageSize, page.maxStart, page.items.length);

    if (pageUrl) {
      await sleep(defaultRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seen.size
  };
}

function formatInsertDebugLine(item: NormalizedItem, inserted: boolean): string {
  const sourceId = readSourceId(item);
  const status = inserted ? "inserted" : "skipped_duplicate";

  return [
    `Backfill item ${status}`,
    `sourceId=${sourceId ?? "unknown"}`,
    `publishedAt=${item.publishedAt ?? "null"}`,
    `title=${item.title ?? "null"}`,
    `url=${item.url ?? "null"}`,
    `dedupeKey=${item.dedupeKey}`
  ].join(" | ");
}

function readSourceId(item: NormalizedItem): string | null {
  const rutrackerData = item.rawExtensionData.rutracker;

  if (
    rutrackerData &&
    typeof rutrackerData === "object" &&
    "topicId" in rutrackerData &&
    typeof rutrackerData.topicId === "string"
  ) {
    return rutrackerData.topicId;
  }

  const youtubeData = item.rawExtensionData.youtube;

  if (
    youtubeData &&
    typeof youtubeData === "object" &&
    "videoId" in youtubeData &&
    typeof youtubeData.videoId === "string"
  ) {
    return youtubeData.videoId;
  }

  return item.guid?.replace(/^rutracker-topic:/, "") ?? null;
}

function resolveNextForumPageUrl(
  currentPageUrl: string,
  pageSize: number,
  maxStart: number | null,
  itemCount: number
): string | null {
  if (itemCount === 0) {
    return null;
  }

  const currentUrl = new URL(currentPageUrl);
  const currentStart = Number(currentUrl.searchParams.get("start") ?? "0");
  const nextStart = currentStart + pageSize;

  if (maxStart !== null && nextStart > maxStart) {
    return null;
  }

  currentUrl.searchParams.set("start", String(nextStart));
  return currentUrl.toString();
}

function resolveRutrackerBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    const url = new URL(candidate);
    const forumId = extractForumId(url);

    if (!forumId) {
      continue;
    }

    const forumUrl = new URL("https://rutracker.org/forum/viewforum.php");
    forumUrl.searchParams.set("f", forumId);

    return forumUrl.toString();
  }

  throw new Error(
    `Feed ${feed.id} does not point to a RuTracker forum page. Expected a URL containing forum id f=... or /f/<id>.`
  );
}

function isYouTubeFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return url.hostname.includes("youtube.com") || url.hostname === "youtu.be";
    } catch {
      return false;
    }
  });
}

function extractForumId(url: URL): string | null {
  const searchForumId = url.searchParams.get("f");

  if (searchForumId && /^\d+$/.test(searchForumId)) {
    return searchForumId;
  }

  const pathMatch = url.pathname.match(/\/f\/(\d+)(?:\.atom|\/)?$/);

  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
