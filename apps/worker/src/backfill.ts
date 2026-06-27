import { readFile } from "node:fs/promises";
import path from "node:path";

import { getConfig } from "./config.js";
import { getPool } from "./db/pool.js";
import {
  buildAdafruitPageUrl,
  fetchAdafruitBackfillPage,
  resolveAdafruitRootUrl
} from "./backfill/adafruit.js";
import {
  fetchDouBackfillPage,
  resolveDouLentaRootUrl
} from "./backfill/dou.js";
import {
  buildGitHubBlogApiPageUrl,
  fetchGitHubBlogBackfillPage,
  resolveGitHubBlogRootUrl
} from "./backfill/githubBlog.js";
import {
  fetchForeignAffairsArticle,
  fetchForeignAffairsPodcastArchivePage,
  fetchForeignAffairsTaxonomies,
  fetchForeignAffairsTaxonomyPage,
  isForeignAffairsInterviewArchiveUrl,
  isForeignAffairsUrl,
  resolveForeignAffairsInterviewArchiveUrl,
  resolveForeignAffairsRootUrl
} from "./backfill/foreignAffairs.js";
import {
  fetchLiquorSitemap,
  isLiquorUrl,
  isPotentialLiquorArticleUrl,
  liquorRootTaxonomies,
  parseLiquorArticle,
  parseLiquorSitemap,
  parseLiquorTaxonomyPage,
  resolveLiquorRootUrl,
  type LiquorTaxonomy
} from "./backfill/liquor.js";
import { createLiquorBrowserSession } from "./backfill/liquorBrowser.js";
import {
  fetchFlibustaBackfillPage,
  isFlibustaGenreUrl,
  resolveFlibustaGenreUrl
} from "./backfill/flibusta.js";
import {
  fetchNprFreshAirArchivePage,
  isNprFreshAirUrl,
  type NprArchivePage,
  resolveNprFreshAirArchiveUrl,
  sameNprArchiveMonth
} from "./backfill/npr.js";
import {
  buildNprIndicatorPartialUrl,
  fetchNprIndicatorArchivePage,
  fetchNprIndicatorFeedItems,
  isNprIndicatorUrl,
  mergeNprIndicatorRssItems,
  resolveNprIndicatorPodcastUrl
} from "./backfill/nprIndicator.js";
import {
  fetchPromodjGroupPage,
  fetchPromodjItemPage,
  fetchPromodjMusicSections,
  isPromodjMaveBackfillFeed,
  resolvePromodjMusicUrl,
  type PromodjListedItem
} from "./backfill/promodj.js";
import {
  isEzraKleinFeed,
  runEzraKleinBackfill
} from "./backfill/ezraKlein.js";
import {
  fetchLearnCategories,
  fetchLearnCategoryPage,
  fetchLearnGuideDetail,
  normalizeLearnGuide,
  resolveLearnRootUrl
} from "./backfill/learn.js";
import {
  fetchLibsynArchivePage,
  fetchLibsynRssOverrides,
  isFlossWeeklyLibsynUrl,
  resolveFlossWeeklyLibsynArchiveUrl,
  resolveFlossWeeklyLibsynFeedUrl
} from "./backfill/libsyn.js";
import {
  buildRutrackerForumUrl,
  fetchRutrackerBackfillPage
} from "./backfill/rutracker.js";
import {
  buildRedditListingJsonUrl,
  fetchRedditBackfillPage,
  isRedditListingUrl
} from "./backfill/reddit.js";
import {
  buildSubstackArchiveApiUrl,
  fetchSubstackArchivePage,
  fetchSubstackPostDetail,
  isSupportedSubstackHost,
  normalizeSubstackPost,
  resolveSubstackRootUrl
} from "./backfill/substack.js";
import {
  fetchTwitEpisodeDetail,
  fetchTwitEpisodeListPage,
  fetchTwitRssOverrides,
  fetchTwitRssSiteUrl,
  fetchTwitShowArchiveUrl,
  isTwitUrl,
  normalizeTwitEpisodeListEntry,
  resolveTwitEpisodeArchiveUrl,
  type TwitRssOverride
} from "./backfill/twit.js";
import {
  collectYouTubeBackfillItemBatches,
  resolveYouTubeBackfillUrls
} from "./backfill/youtube.js";
import { parseBackfillArguments } from "./backfill/args.js";
import {
  getFeedBackfillTarget,
  getFolderBackfillTarget,
  insertItemsWithResults,
  recordFeedBackfillComplete,
  type FeedBackfillTarget
} from "./repository.js";
import type { NormalizedItem } from "./fetch/types.js";
import type { Pool } from "pg";

const defaultRequestDelayMs = 500;
const defaultLearnRequestDelayMinMs = 1_500;
const defaultLearnRequestDelayMaxMs = 5_000;
const defaultRedditRequestDelayMinMs = 1_000;
const defaultRedditRequestDelayMaxMs = 3_000;
const defaultForeignAffairsRequestDelayMinMs = 3_000;
const defaultForeignAffairsRequestDelayMaxMs = 8_000;
const defaultLiquorRequestDelayMinMs = 1_000;
const defaultLiquorRequestDelayMaxMs = 3_000;
const defaultFlibustaRequestDelayMs = 500;
const defaultNprRequestDelayMs = 500;
const defaultPromodjRequestDelayMs = 500;
const defaultSubstackRequestDelayMinMs = 5_000;
const defaultSubstackRequestDelayMaxMs = 15_000;
const maxPages = 10_000;

interface BackfillResult {
  discoveredCount: number;
  insertedCount: number;
  pageCount: number;
  source: string;
}

interface BackfillRunOptions {
  force: boolean;
  liquorSitemapFile: string | null;
  rutrackerStart: number | null;
  timeoutMs: number;
}

type BackfillRunOutcome =
  | { kind: "completed"; result: BackfillResult }
  | { kind: "skipped" };

async function run(): Promise<void> {
  const args = parseBackfillArguments(process.argv.slice(2));
  const config = getConfig();
  const pool = getPool(config.DATABASE_URL);

  try {
    if (args.selection.kind === "feed") {
      const feed = await getFeedBackfillTarget(pool, args.selection.feedId);

      if (!feed) {
        throw new Error(`Feed ${args.selection.feedId} was not found.`);
      }

      console.log(
        `Starting backfill for feed ${feed.id} force=${args.force} with config: ${formatConfigForLog(config)}`
      );
      const outcome = await backfillFeedWithTracking(
        pool,
        feed,
        {
          force: args.force,
          liquorSitemapFile: args.liquorSitemapFile,
          rutrackerStart: args.rutrackerStart,
          timeoutMs: config.FETCH_TOTAL_TIMEOUT_MS
        }
      );

      if (outcome.kind === "completed") {
        logBackfillComplete(feed, outcome.result);
      }

      return;
    }

    const folder = await getFolderBackfillTarget(pool, args.selection.folderReference);

    if (!folder) {
      throw new Error(`Folder ${args.selection.folderReference} was not found.`);
    }

    console.log(
      `Starting backfill for folder ${folder.title} (${folder.id}): feeds=${folder.feeds.length} force=${args.force} config=${formatConfigForLog(config)}`
    );
    const failures: Array<{ error: unknown; feed: FeedBackfillTarget }> = [];
    let skippedCount = 0;

    for (const feed of folder.feeds) {
      console.log(`Starting folder feed backfill: ${feed.title ?? feed.feedUrl} (${feed.id})`);

      try {
        const outcome = await backfillFeedWithTracking(
          pool,
          feed,
          {
            force: args.force,
            liquorSitemapFile: args.liquorSitemapFile,
            rutrackerStart: args.rutrackerStart,
            timeoutMs: config.FETCH_TOTAL_TIMEOUT_MS
          }
        );

        if (outcome.kind === "skipped") {
          skippedCount += 1;
          continue;
        }

        logBackfillComplete(feed, outcome.result);
      } catch (error) {
        failures.push({ error, feed });
        console.error(
          `Backfill failed for ${feed.title ?? feed.feedUrl} (${feed.id}): ${formatError(error)}`
        );
      }
    }

    console.log(
      `Folder backfill complete for ${folder.title}: feeds=${folder.feeds.length} completed=${folder.feeds.length - failures.length - skippedCount} skipped=${skippedCount} failed=${failures.length}`
    );

    if (failures.length > 0) {
      throw new Error(`Folder backfill failed for ${failures.length} feed(s).`);
    }
  } finally {
    console.error("Ending backfill process and closing database pool.");
    await pool.end();
  }
}

async function backfillFeedWithTracking(
  pool: Pool,
  feed: FeedBackfillTarget,
  options: BackfillRunOptions
): Promise<BackfillRunOutcome> {
  if (feed.lastBackfilledAt && !options.force) {
    console.warn(
      `Warning: skipping backfill for ${formatFeedLabel(feed)} (${feed.id}); feed was already backfilled at ${feed.lastBackfilledAt.toISOString()}. Use --force to run it again.`
    );
    return { kind: "skipped" };
  }

  if (feed.lastBackfilledAt && options.force) {
    console.warn(
      `Warning: forcing backfill for ${formatFeedLabel(feed)} (${feed.id}); previous backfill completed at ${feed.lastBackfilledAt.toISOString()}.`
    );
  }

  const result = await backfillFeed(
    pool,
    feed,
    options.timeoutMs,
    options.rutrackerStart,
    options.liquorSitemapFile
  );

  await recordFeedBackfillComplete(pool, feed.id);

  return { kind: "completed", result };
}

async function backfillFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number,
  rutrackerStart: number | null,
  liquorSitemapFile: string | null
): Promise<BackfillResult> {
  return isYouTubeFeed(feed)
    ? backfillYouTubeFeed(pool, feed, timeoutMs)
    : isAdafruitFeed(feed)
      ? backfillAdafruitFeed(pool, feed, timeoutMs)
      : isLearnFeed(feed)
        ? backfillLearnFeed(pool, feed, timeoutMs)
        : isDouFeed(feed)
          ? backfillDouFeed(pool, feed, timeoutMs)
          : isGitHubBlogFeed(feed)
            ? backfillGitHubBlogFeed(pool, feed, timeoutMs)
            : isSubstackFeed(feed)
              ? backfillSubstackFeed(pool, feed, timeoutMs)
              : isRedditFeed(feed)
                ? backfillRedditFeed(pool, feed, timeoutMs)
                : isForeignAffairsInterviewFeed(feed)
                  ? backfillForeignAffairsInterviewFeed(pool, feed, timeoutMs)
                  : isForeignAffairsFeed(feed)
                    ? backfillForeignAffairsFeed(pool, feed, timeoutMs)
                    : isLiquorFeed(feed)
                      ? backfillLiquorFeed(pool, feed, timeoutMs, liquorSitemapFile)
                      : isFlibustaFeed(feed)
                        ? backfillFlibustaFeed(pool, feed, timeoutMs)
                        : isNprFreshAirFeed(feed)
                          ? backfillNprFreshAirFeed(pool, feed, timeoutMs)
                          : isNprIndicatorFeed(feed)
                            ? backfillNprIndicatorFeed(pool, feed, timeoutMs)
                          : isPromodjFeed(feed)
                            ? backfillPromodjFeed(pool, feed, timeoutMs)
                            : isTwitFeed(feed)
                              ? backfillTwitFeed(pool, feed, timeoutMs)
                              : isFlossWeeklyLibsynFeed(feed)
                                ? backfillFlossWeeklyLibsynFeed(pool, feed, timeoutMs)
                                : isEzraKleinFeed(feed)
                                  ? runEzraKleinBackfill(pool, feed, { FETCH_TOTAL_TIMEOUT_MS: timeoutMs })
                                  : backfillRutrackerFeed(pool, feed, timeoutMs, rutrackerStart);
}

function logBackfillComplete(feed: FeedBackfillTarget, result: BackfillResult): void {
  console.log(
    `Backfill complete for ${feed.title ?? feed.feedUrl}: source=${result.source} pages=${result.pageCount} discovered=${result.discoveredCount} inserted=${result.insertedCount}`
  );
}

function formatFeedLabel(feed: FeedBackfillTarget): string {
  return feed.title ?? feed.feedUrl;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatConfigForLog(config: ReturnType<typeof getConfig>): string {
  return JSON.stringify({
    ...config,
    DATABASE_URL: redactDatabaseUrl(config.DATABASE_URL),
    TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN ? "[redacted]" : undefined,
    TELEGRAM_CHAT_ID: config.TELEGRAM_CHAT_ID ? "[redacted]" : undefined
  });
}

function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.username) {
      url.username = "[redacted]";
    }

    if (url.password) {
      url.password = "[redacted]";
    }

    return url.toString();
  } catch {
    return "[redacted]";
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
  timeoutMs: number,
  start: number | null
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveRutrackerBackfillStartUrl(feed, start);
  const result = await crawlRutrackerForum(pool, feed.id, startUrl, timeoutMs);

  return {
    ...result,
    source: "rutracker"
  };
}

async function backfillAdafruitFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveAdafruitBackfillStartUrl(feed);
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageCount = 0;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const pageUrl = buildAdafruitPageUrl(startUrl, pageNumber);
    console.log(`Backfill crawling Adafruit page ${pageNumber}: ${pageUrl}`);

    const page = await fetchAdafruitBackfillPage(pageUrl, feed.id, timeoutMs);
    pageCount += 1;
    console.log(`Backfill Adafruit page parsed: page=${page.pageNumber} items=${page.items.length}`);

    if (page.items.length === 0) {
      break;
    }

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    await sleep(defaultRequestDelayMs);
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount,
    source: "adafruit"
  };
}

async function backfillLearnFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveLearnBackfillStartUrl(feed);
  const learnDelay = resolveLearnBackfillDelay();

  await sleepRandom(learnDelay);
  const categories = await fetchLearnCategories(startUrl, timeoutMs);
  const latestCategory = {
    title: "New Guides",
    url: new URL("/guides/latest", startUrl).toString()
  };
  const seenGuideUrls = new Set<string>();
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageCount = 0;

  console.log(`Backfill Learn categories discovered: count=${categories.length}`);

  for (const category of [latestCategory, ...categories]) {
    let pageUrl: string | null = category.url;

    while (pageUrl && pageCount < maxPages) {
      console.log(`Backfill crawling Learn category=${category.title} pageUrl=${pageUrl}`);

      await sleepRandom(learnDelay);
      const page = await fetchLearnCategoryPage(pageUrl, timeoutMs);
      pageCount += 1;
      console.log(
        `Backfill Learn page parsed: category=${category.title} page=${page.pageNumber} guides=${page.guides.length} next=${page.nextPageUrl ?? "none"}`
      );

      const items: NormalizedItem[] = [];

      for (const guide of page.guides) {
        if (seenGuideUrls.has(guide.url)) {
          console.log(`Backfill Learn guide skipped_duplicate_discovery | url=${guide.url} | title=${guide.title}`);
          continue;
        }

        seenGuideUrls.add(guide.url);
        console.log(`Backfill Learn guide detail fetching | url=${guide.url} | title=${guide.title}`);

        await sleepRandom(learnDelay);
        const detail = await fetchLearnGuideDetail(guide.url, timeoutMs);
        const item = normalizeLearnGuide(guide, detail, feed.id, category, pageUrl);
        console.log(
          `Backfill Learn guide normalized | sourceId=${readSourceId(item) ?? "unknown"} | publishedAt=${item.publishedAt ?? "null"} | title=${item.title ?? "null"} | url=${item.url ?? "null"}`
        );
        items.push(item);
      }

      discoveredCount += items.length;

      for (const result of await insertItemsWithResults(pool, feed.id, items)) {
        console.log(formatInsertDebugLine(result.item, result.inserted));

        if (result.inserted) {
          insertedCount += 1;
        }
      }

      pageUrl = page.nextPageUrl;
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount,
    source: "adafruit-learn"
  };
}

async function backfillDouFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveDouBackfillStartUrl(feed);
  const seen = new Set<string>();
  let pageUrl: string | null = startUrl;
  let discoveredCount = 0;
  let insertedCount = 0;

  while (pageUrl && seen.size < maxPages) {
    if (seen.has(pageUrl)) {
      break;
    }

    seen.add(pageUrl);
    console.log(`Backfill crawling DOU pageUrl=${pageUrl}`);

    const page = await fetchDouBackfillPage(pageUrl, feed.id, timeoutMs);
    console.log(
      `Backfill DOU page parsed: page=${page.pageNumber} items=${page.items.length} next=${page.nextPageUrl ?? "none"}`
    );

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;

    if (pageUrl) {
      await sleep(defaultRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seen.size,
    source: "dou"
  };
}

async function backfillGitHubBlogFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveGitHubBlogBackfillStartUrl(feed);
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageCount = 0;
  let pageUrl: string | null = buildGitHubBlogApiPageUrl(startUrl, 1);

  while (pageUrl && pageCount < maxPages) {
    console.log(`Backfill crawling GitHub Blog pageUrl=${pageUrl}`);

    const page = await fetchGitHubBlogBackfillPage(pageUrl, feed.id, timeoutMs);
    pageCount += 1;
    console.log(
      `Backfill GitHub Blog page parsed: page=${page.pageNumber} items=${page.items.length} totalPages=${page.totalPages ?? "unknown"} next=${page.nextPageUrl ?? "none"}`
    );

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;

    if (pageUrl) {
      await sleep(defaultRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount,
    source: "github-blog"
  };
}

async function backfillSubstackFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveSubstackBackfillStartUrl(feed);
  const substackDelay = resolveSubstackBackfillDelay();
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageCount = 0;
  let pageUrl: string | null = buildSubstackArchiveApiUrl(startUrl);

  while (pageUrl && pageCount < maxPages) {
    console.log(`Backfill crawling Substack archive pageUrl=${pageUrl}`);

    await sleepRandom(substackDelay);
    const page = await fetchSubstackArchivePage(pageUrl, timeoutMs);
    pageCount += 1;
    console.log(
      `Backfill Substack archive parsed: page=${page.pageNumber} offset=${page.offset} posts=${page.posts.length} next=${page.nextPageUrl ?? "none"}`
    );

    const items: NormalizedItem[] = [];

    for (const post of page.posts) {
      const slug = typeof post.slug === "string" ? post.slug : null;
      const postId = typeof post.id === "number" ? String(post.id) : "unknown";

      if (!slug) {
        console.log(`Backfill Substack post skipped_missing_slug | sourceId=${postId}`);
        continue;
      }

      console.log(`Backfill Substack post detail fetching | sourceId=${postId} | slug=${slug}`);
      await sleepRandom(substackDelay);

      const detail = await fetchSubstackPostDetail(startUrl, slug, timeoutMs);
      const item = normalizeSubstackPost(detail ?? post, feed.id, pageUrl, detail !== null);

      if (!item) {
        console.log(`Backfill Substack post skipped_normalize_failed | sourceId=${postId} | slug=${slug}`);
        continue;
      }

      console.log(
        `Backfill Substack post normalized | sourceId=${readSourceId(item) ?? "unknown"} | publishedAt=${item.publishedAt ?? "null"} | title=${item.title ?? "null"} | url=${item.url ?? "null"}`
      );
      items.push(item);
    }

    discoveredCount += items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount,
    source: "substack"
  };
}

async function backfillRedditFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const redditDelay = resolveRedditBackfillDelay();
  const seen = new Set<string>();
  let pageUrl: string | null = resolveRedditBackfillStartUrl(feed);
  let discoveredCount = 0;
  let insertedCount = 0;

  while (pageUrl && seen.size < maxPages) {
    if (seen.has(pageUrl)) {
      break;
    }

    seen.add(pageUrl);
    console.log(`Backfill crawling Reddit pageUrl=${pageUrl}`);

    await sleepRandom(redditDelay);
    const page = await fetchRedditBackfillPage(pageUrl, feed.id, timeoutMs);
    console.log(
      `Backfill Reddit page parsed: subreddit=${page.subreddit ?? "unknown"} items=${page.items.length} rawChildren=${page.itemCount} after=${page.after ?? "none"} next=${page.nextPageUrl ?? "none"}`
    );

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seen.size,
    source: "reddit"
  };
}

async function backfillForeignAffairsFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveForeignAffairsBackfillStartUrl(feed);
  const foreignAffairsDelay = resolveForeignAffairsBackfillDelay();
  const seenArticleUrls = new Set<string>();
  const seenSourceIds = new Set<string>();
  const seenTaxonomyPageUrls = new Set<string>();
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageCount = 0;

  await sleepRandom(foreignAffairsDelay);
  console.log("==================================================================================================");
  const taxonomies = await fetchForeignAffairsTaxonomies(startUrl, timeoutMs);
  console.log(`Backfill Foreign Affairs taxonomies discovered: count=${taxonomies.length}`);
  console.log("==================================================================================================");
  for (const taxonomy of taxonomies) {
    let pageUrl: string | null = taxonomy.url;

    while (pageUrl && pageCount < maxPages) {
      if (seenTaxonomyPageUrls.has(pageUrl)) {
        break;
      }

      seenTaxonomyPageUrls.add(pageUrl);
      
      console.log("\n==================================================================================================");
      console.log(`Backfill crawling Foreign Affairs taxonomy=${taxonomy.title} pageUrl=${pageUrl}`);
      console.log("==================================================================================================");

      await sleepRandom(foreignAffairsDelay);
      const page = await fetchForeignAffairsTaxonomyPage(pageUrl, timeoutMs);
      pageCount += 1;
      console.log("\n==================================================================================================");
      console.log(
        `Backfill Foreign Affairs taxonomy page parsed: taxonomy=${taxonomy.title} page=${page.pageNumber} articleUrls=${page.articleUrls.length} next=${page.nextPageUrl ?? "none"}`
      );
      console.log("==================================================================================================");
      const items: NormalizedItem[] = [];

      for (const articleUrl of page.articleUrls) {
        console.log(`\n-----------------------------------------------------------------------------------------------`);
        if (seenArticleUrls.has(articleUrl)) {
          console.log(`Backfill Foreign Affairs article skipped_duplicate_discovery | url=${articleUrl}`);
          continue;
        }

        seenArticleUrls.add(articleUrl);
        console.log(`Backfill Foreign Affairs article detail fetching | url=${articleUrl}`);

        await sleepRandom(foreignAffairsDelay);
        const item = await fetchForeignAffairsArticle(articleUrl, feed.id, timeoutMs, {
          sourcePageUrl: pageUrl,
          taxonomy
        });

        if (!item) {
          console.log(`Backfill Foreign Affairs article skipped_normalize_failed | url=${articleUrl}`);
          continue;
        }

        const sourceId = readSourceId(item);

        if (sourceId && seenSourceIds.has(sourceId)) {
          console.log(
            `Backfill Foreign Affairs article skipped_duplicate_normalized | sourceId=${sourceId} | url=${item.url ?? articleUrl}`
          );
          continue;
        }

        if (sourceId) {
          seenSourceIds.add(sourceId);
        }

        console.log(
          `Backfill Foreign Affairs article normalized | sourceId=${sourceId ?? "unknown"} | publishedAt=${item.publishedAt ?? "null"} | title=${item.title ?? "null"} | url=${item.url ?? "null"}`
        );
        items.push(item);
        console.log(`-----------------------------------------------------------------------------------------------`);
      }

      discoveredCount += items.length;

      for (const result of await insertItemsWithResults(pool, feed.id, items)) {
        console.log(formatInsertDebugLine(result.item, result.inserted));

        if (result.inserted) {
          insertedCount += 1;
        }
      }

      pageUrl = page.nextPageUrl;
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount,
    source: "foreign-affairs"
  };
}

async function backfillForeignAffairsInterviewFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveForeignAffairsInterviewBackfillStartUrl(feed);
  const foreignAffairsDelay = resolveForeignAffairsBackfillDelay();
  const seenArticleUrls = new Set<string>();
  const seenSourceIds = new Set<string>();
  const seenArchivePageUrls = new Set<string>();
  const sourceTaxonomy = {
    slug: "foreign-affairs-interview",
    title: "The Foreign Affairs Interview",
    type: "tag" as const,
    url: startUrl
  };
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageUrl: string | null = startUrl;

  while (pageUrl && seenArchivePageUrls.size < maxPages) {
    if (seenArchivePageUrls.has(pageUrl)) {
      break;
    }

    seenArchivePageUrls.add(pageUrl);

    console.log("\n==================================================================================================");
    console.log(`Backfill crawling The Foreign Affairs Interview pageUrl=${pageUrl}`);
    console.log("==================================================================================================");

    await sleepRandom(foreignAffairsDelay);
    const page = await fetchForeignAffairsPodcastArchivePage(pageUrl, timeoutMs);
    console.log("\n==================================================================================================");
    console.log(
      `Backfill The Foreign Affairs Interview archive parsed: page=${page.pageNumber} articleUrls=${page.articleUrls.length} next=${page.nextPageUrl ?? "none"}`
    );
    console.log("==================================================================================================");

    const items: NormalizedItem[] = [];

    for (const articleUrl of page.articleUrls) {
      console.log(`\n-----------------------------------------------------------------------------------------------`);
      if (seenArticleUrls.has(articleUrl)) {
        console.log(`Backfill The Foreign Affairs Interview article skipped_duplicate_discovery | url=${articleUrl}`);
        continue;
      }

      seenArticleUrls.add(articleUrl);
      console.log(`Backfill The Foreign Affairs Interview article detail fetching | url=${articleUrl}`);

      await sleepRandom(foreignAffairsDelay);
      const item = await fetchForeignAffairsArticle(articleUrl, feed.id, timeoutMs, {
        sourcePageUrl: pageUrl,
        taxonomy: sourceTaxonomy
      });

      if (!item) {
        console.log(`Backfill The Foreign Affairs Interview article skipped_normalize_failed | url=${articleUrl}`);
        continue;
      }

      const sourceId = readSourceId(item);

      if (sourceId && seenSourceIds.has(sourceId)) {
        console.log(
          `Backfill The Foreign Affairs Interview article skipped_duplicate_normalized | sourceId=${sourceId} | url=${item.url ?? articleUrl}`
        );
        continue;
      }

      if (sourceId) {
        seenSourceIds.add(sourceId);
      }

      console.log(
        `Backfill The Foreign Affairs Interview article normalized | sourceId=${sourceId ?? "unknown"} | publishedAt=${item.publishedAt ?? "null"} | title=${item.title ?? "null"} | url=${item.url ?? "null"}`
      );
      items.push(item);
      console.log(`-----------------------------------------------------------------------------------------------`);
    }

    discoveredCount += items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seenArchivePageUrls.size,
    source: "foreign-affairs-interview"
  };
}

async function backfillLiquorFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number,
  sitemapFile: string | null
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const rootUrl = resolveLiquorBackfillStartUrl(feed);
  const requestDelay = resolveLiquorBackfillDelay();
  const sitemapQueue = sitemapFile ? [] : [new URL("/sitemap.xml", rootUrl).toString()];
  const seenSitemapUrls = new Set<string>();
  const sitemapEntries = new Map<
    string,
    { lastModified: string | null; sitemapUrl: string }
  >();
  let pageCount = 0;

  if (sitemapFile) {
    const resolvedPath = path.resolve(sitemapFile);
    let xml: string;

    try {
      xml = await readFile(resolvedPath, "utf8");
    } catch (error) {
      throw new Error(
        `Liquor.com sitemap file could not be read: ${resolvedPath}: ${formatError(error)}`
      );
    }

    const sitemap = parseLiquorSitemap(xml, resolvedPath);

    if (sitemap.sitemapUrls.length > 0 && sitemap.urlEntries.length === 0) {
      throw new Error(
        `Liquor.com sitemap file is an index, not a URL set: ${resolvedPath}. Download the referenced sitemap_1.xml file and pass that path instead.`
      );
    }

    for (const entry of sitemap.urlEntries) {
      sitemapEntries.set(entry.url, {
        lastModified: entry.lastModified,
        sitemapUrl: resolvedPath
      });
    }

    pageCount += 1;
    console.log(
      `Backfill Liquor.com local sitemap parsed: path=${resolvedPath} urls=${sitemap.urlEntries.length}`
    );
  }

  while (sitemapQueue.length > 0 && seenSitemapUrls.size < maxPages) {
    const sitemapUrl = sitemapQueue.shift();

    if (!sitemapUrl || seenSitemapUrls.has(sitemapUrl)) {
      continue;
    }

    seenSitemapUrls.add(sitemapUrl);
    console.log(`Backfill crawling Liquor.com sitemap=${sitemapUrl}`);
    await sleepRandom(requestDelay);
    const sitemap = await fetchLiquorSitemap(sitemapUrl, timeoutMs);
    pageCount += 1;

    for (const childUrl of sitemap.sitemapUrls) {
      if (!seenSitemapUrls.has(childUrl)) {
        sitemapQueue.push(childUrl);
      }
    }

    for (const entry of sitemap.urlEntries) {
      sitemapEntries.set(entry.url, {
        lastModified: entry.lastModified,
        sitemapUrl
      });
    }

    console.log(
      `Backfill Liquor.com sitemap parsed: childSitemaps=${sitemap.sitemapUrls.length} urls=${sitemap.urlEntries.length}`
    );
  }

  const browserSession = await createLiquorBrowserSession();

  try {
    const taxonomyQueue: Array<{ path: string[]; taxonomy: LiquorTaxonomy }> =
      liquorRootTaxonomies.map((taxonomy) => ({
        path: [taxonomy.title],
        taxonomy
      }));
    const seenTaxonomyUrls = new Set<string>();
    const taxonomyPathsByArticle = new Map<string, string[][]>();

    while (taxonomyQueue.length > 0 && seenTaxonomyUrls.size < maxPages) {
      const next = taxonomyQueue.shift();

      if (!next || seenTaxonomyUrls.has(next.taxonomy.url)) {
        continue;
      }

      seenTaxonomyUrls.add(next.taxonomy.url);
      console.log(
        `Backfill crawling Liquor.com taxonomy=${next.path.join(" > ")} url=${next.taxonomy.url}`
      );
      await sleepRandom(requestDelay);
      const page = parseLiquorTaxonomyPage(
        await browserSession.fetchHtml(next.taxonomy.url, timeoutMs),
        next.taxonomy.url
      );
      pageCount += 1;

      for (const article of page.articles) {
        const paths = taxonomyPathsByArticle.get(article.url) ?? [];
        paths.push(next.path);
        taxonomyPathsByArticle.set(article.url, paths);
      }

      for (const child of page.childTaxonomies) {
        if (!seenTaxonomyUrls.has(child.url)) {
          taxonomyQueue.push({
            path: [...next.path, child.title],
            taxonomy: child
          });
        }
      }

      console.log(
        `Backfill Liquor.com taxonomy parsed: title=${page.title ?? next.taxonomy.title} articles=${page.articles.length} children=${page.childTaxonomies.length}`
      );
    }

    const articleEntries = Array.from(sitemapEntries.entries()).filter(([url]) =>
      isPotentialLiquorArticleUrl(url, seenTaxonomyUrls)
    );
    let discoveredCount = 0;
    let insertedCount = 0;
    let pendingItems: NormalizedItem[] = [];

    const flushItems = async (): Promise<void> => {
      if (pendingItems.length === 0) {
        return;
      }

      for (const result of await insertItemsWithResults(pool, feed.id, pendingItems)) {
        console.log(formatInsertDebugLine(result.item, result.inserted));

        if (result.inserted) {
          insertedCount += 1;
        }
      }

      pendingItems = [];
    };

    for (const [articleUrl, sitemapSource] of articleEntries) {
      if (pageCount >= maxPages) {
        break;
      }

      console.log(`Backfill Liquor.com article detail fetching | url=${articleUrl}`);
      await sleepRandom(requestDelay);
      const html = await browserSession.fetchHtml(articleUrl, timeoutMs);
      const item = html
        ? parseLiquorArticle(html, articleUrl, feed.id, {
            sitemapLastModified: sitemapSource.lastModified,
            sitemapUrl: sitemapSource.sitemapUrl,
            taxonomyPaths: taxonomyPathsByArticle.get(articleUrl) ?? []
          })
        : null;
      pageCount += 1;

      if (!item) {
        console.log(`Backfill Liquor.com article skipped_not_article | url=${articleUrl}`);
        continue;
      }

      discoveredCount += 1;
      pendingItems.push(item);

      if (pendingItems.length >= 25) {
        await flushItems();
      }
    }

    await flushItems();

    return {
      discoveredCount,
      insertedCount,
      pageCount,
      source: "liquor"
    };
  } finally {
    await browserSession.close();
  }
}

async function backfillFlossWeeklyLibsynFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveFlossWeeklyLibsynBackfillStartUrl(feed);
  const rssUrl = resolveFlossWeeklyLibsynBackfillFeedUrl(feed);
  const rssOverrides = await fetchLibsynRssOverrides(rssUrl, feed.id, timeoutMs);
  const seenPageUrls = new Set<string>();
  let pageUrl: string | null = startUrl;
  let discoveredCount = 0;
  let insertedCount = 0;

  console.log(`Backfill FLOSS Weekly Libsyn RSS overrides loaded: url=${rssUrl} count=${rssOverrides.size}`);

  while (pageUrl && seenPageUrls.size < maxPages) {
    if (seenPageUrls.has(pageUrl)) {
      break;
    }

    seenPageUrls.add(pageUrl);
    console.log(`Backfill crawling FLOSS Weekly Libsyn pageUrl=${pageUrl}`);

    const page = await fetchLibsynArchivePage(pageUrl, feed.id, timeoutMs, rssOverrides);
    console.log(
      `Backfill FLOSS Weekly Libsyn page parsed: page=${page.pageNumber} items=${page.items.length} next=${page.nextPageUrl ?? "none"}`
    );

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;

    if (pageUrl) {
      await sleep(defaultRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seenPageUrls.size,
    source: "floss-weekly-libsyn"
  };
}

async function backfillTwitFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const { archiveUrl, rssUrl } = await resolveTwitBackfillConfig(feed, timeoutMs);
  const rssOverrides = rssUrl
    ? await fetchTwitRssOverrides(rssUrl, feed.id, timeoutMs)
    : new Map<string, TwitRssOverride>();
  const seenPageUrls = new Set<string>();
  const seenEpisodeUrls = new Set<string>();
  let pageUrl: string | null = archiveUrl;
  let discoveredCount = 0;
  let insertedCount = 0;

  console.log(
    `Backfill Twit starting: archiveUrl=${archiveUrl} rssUrl=${rssUrl ?? "none"} rssOverrides=${rssOverrides.size}`
  );

  while (pageUrl && seenPageUrls.size < maxPages) {
    if (seenPageUrls.has(pageUrl)) {
      break;
    }

    seenPageUrls.add(pageUrl);
    console.log(`Backfill crawling Twit archive pageUrl=${pageUrl}`);

    const page = await fetchTwitEpisodeListPage(pageUrl, timeoutMs);
    console.log(
      `Backfill Twit archive page parsed: showId=${page.showId ?? "unknown"} page=${page.pageNumber} episodes=${page.episodeUrls.length} totalPages=${page.totalPages ?? "unknown"} next=${page.nextPageUrl ?? "none"}`
    );

    const items: NormalizedItem[] = [];

    for (const episode of page.episodes) {
      const episodeUrl = episode.url;

      if (seenEpisodeUrls.has(episodeUrl)) {
        console.log(`Backfill Twit episode skipped_duplicate_discovery | url=${episodeUrl}`);
        continue;
      }

      seenEpisodeUrls.add(episodeUrl);
      console.log(`Backfill Twit episode detail fetching | url=${episodeUrl}`);

      await sleep(defaultRequestDelayMs);
      const item =
        await fetchTwitEpisodeDetail(episodeUrl, feed.id, timeoutMs, rssOverrides) ??
        normalizeTwitEpisodeListEntry(episode, feed.id, rssOverrides);

      if (!item) {
        console.log(`Backfill Twit episode skipped_normalize_failed | url=${episodeUrl}`);
        continue;
      }

      console.log(
        `Backfill Twit episode normalized | sourceId=${readSourceId(item) ?? "unknown"} | publishedAt=${item.publishedAt ?? "null"} | title=${item.title ?? "null"} | url=${item.url ?? "null"}`
      );
      items.push(item);
    }

    discoveredCount += items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;

    if (pageUrl) {
      await sleep(defaultRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seenPageUrls.size,
    source: "twit"
  };
}

async function backfillFlibustaFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const seen = new Set<string>();
  let pageUrl: string | null = resolveFlibustaBackfillStartUrl(feed);
  let discoveredCount = 0;
  let insertedCount = 0;

  while (pageUrl && seen.size < maxPages) {
    if (seen.has(pageUrl)) {
      break;
    }

    seen.add(pageUrl);
    console.log(`Backfill crawling Flibusta pageUrl=${pageUrl}`);

    const page = await fetchFlibustaBackfillPage(pageUrl, feed.id, timeoutMs);
    console.log(
      `Backfill Flibusta page parsed: genre=${page.genreSlug} title=${page.genreTitle ?? "unknown"} items=${page.items.length} next=${page.nextPageUrl ?? "none"}`
    );

    discoveredCount += page.items.length;

    for (const result of await insertItemsWithResults(pool, feed.id, page.items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;

    if (pageUrl) {
      await sleep(defaultFlibustaRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seen.size,
    source: "flibusta"
  };
}

async function backfillNprFreshAirFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const startUrl = resolveNprFreshAirBackfillStartUrl(feed);
  console.log(
    `Backfill NPR Fresh Air starting: feedId=${feed.id} feedUrl=${feed.feedUrl} archiveUrl=${startUrl} timeoutMs=${timeoutMs}`
  );
  const rootPage = await fetchNprFreshAirArchivePage(startUrl, feed.id, timeoutMs);
  const monthUrls = rootPage.monthUrls.length > 0 ? rootPage.monthUrls : [startUrl];
  const seenPages = new Set<string>();
  const seenEpisodeIds = new Set<string>();
  let discoveredCount = 0;
  let insertedCount = 0;

  console.log(`Backfill NPR Fresh Air archive months discovered: count=${monthUrls.length}`);

  for (const monthUrl of monthUrls) {
    let pageUrl: string | null = monthUrl;

    while (pageUrl && seenPages.size < maxPages) {
      if (seenPages.has(pageUrl)) {
        break;
      }

      seenPages.add(pageUrl);
      console.log(`Backfill crawling NPR Fresh Air pageUrl=${pageUrl}`);

      const page: NprArchivePage = pageUrl === startUrl
        ? rootPage
        : await fetchNprFreshAirArchivePage(pageUrl, feed.id, timeoutMs);
      console.log(
        `Backfill NPR Fresh Air page parsed: items=${page.items.length} monthLinks=${page.monthUrls.length} next=${page.nextPageUrl ?? "none"}`
      );

      const items = page.items.filter((item: NormalizedItem) => {
        const sourceId = readSourceId(item);

        if (!sourceId) {
          return true;
        }

        if (seenEpisodeIds.has(sourceId)) {
          console.log(`Backfill NPR Fresh Air item skipped_duplicate_discovery | sourceId=${sourceId} | url=${item.url ?? "null"}`);
          return false;
        }

        seenEpisodeIds.add(sourceId);
        return true;
      });

      discoveredCount += items.length;

      for (const result of await insertItemsWithResults(pool, feed.id, items)) {
        console.log(formatInsertDebugLine(result.item, result.inserted));

        if (result.inserted) {
          insertedCount += 1;
        }
      }

      pageUrl = page.nextPageUrl && sameNprArchiveMonth(monthUrl, page.nextPageUrl)
        ? page.nextPageUrl
        : null;

      if (pageUrl) {
        await sleep(defaultNprRequestDelayMs);
      }
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seenPages.size,
    source: "npr-fresh-air"
  };
}

async function backfillNprIndicatorFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const podcastUrl = resolveNprIndicatorBackfillStartUrl(feed);
  const rssItems = await fetchNprIndicatorFeedItems(feed.id, timeoutMs);
  const seenStoryIds = new Set<string>();
  let pageUrl: string | null = buildNprIndicatorPartialUrl(1);
  let discoveredCount = 0;
  let insertedCount = 0;
  let pageCount = 0;

  console.log(
    `Backfill NPR Indicator starting: feedId=${feed.id} feedUrl=${feed.feedUrl} podcastUrl=${podcastUrl} rssItems=${rssItems.length} timeoutMs=${timeoutMs}`
  );

  while (pageUrl && pageCount < maxPages) {
    console.log(`Backfill crawling NPR Indicator pageUrl=${pageUrl}`);
    const page = await fetchNprIndicatorArchivePage(pageUrl, feed.id, timeoutMs);
    pageCount += 1;

    const uniqueItems = page.items.filter((item) => {
      const sourceId = readSourceId(item);

      if (!sourceId) {
        return true;
      }

      if (seenStoryIds.has(sourceId)) {
        console.log(
          `Backfill NPR Indicator item skipped_duplicate_discovery | sourceId=${sourceId} | url=${item.url ?? "null"}`
        );
        return false;
      }

      seenStoryIds.add(sourceId);
      return true;
    });
    const items = mergeNprIndicatorRssItems(uniqueItems, rssItems);
    discoveredCount += items.length;

    console.log(
      `Backfill NPR Indicator page parsed: episodes=${page.episodeCount} items=${items.length} next=${page.nextPageUrl ?? "none"}`
    );

    for (const result of await insertItemsWithResults(pool, feed.id, items)) {
      console.log(formatInsertDebugLine(result.item, result.inserted));

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    pageUrl = page.nextPageUrl;

    if (pageUrl) {
      await sleep(defaultNprRequestDelayMs);
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount,
    source: "npr-indicator"
  };
}

async function backfillPromodjFeed(
  pool: Pool,
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  const sections = await fetchPromodjMusicSections(timeoutMs);
  const seenPageUrls = new Set<string>();
  const seenFileIds = new Set<string>();
  let discoveredCount = 0;
  let insertedCount = 0;

  console.log(`Backfill PromoDJ sections discovered: count=${sections.length}`);

  for (const section of sections) {
    let pageUrl: string | null = section.url;

    while (pageUrl && seenPageUrls.size < maxPages) {
      if (seenPageUrls.has(pageUrl)) {
        break;
      }

      seenPageUrls.add(pageUrl);
      console.log(`Backfill crawling PromoDJ section=${section.title} pageUrl=${pageUrl}`);

      const page = await fetchPromodjGroupPage(pageUrl, timeoutMs);
      console.log(
        `Backfill PromoDJ group page parsed: section=${section.title} page=${page.pageNumber} items=${page.items.length} next=${page.nextPageUrl ?? "none"}`
      );

      const listedItems: PromodjListedItem[] = [];

      for (const listedItem of page.items) {
        if (seenFileIds.has(listedItem.id)) {
          console.log(`Backfill PromoDJ item skipped_duplicate_discovery | sourceId=${listedItem.id} | url=${listedItem.url}`);
          continue;
        }

        seenFileIds.add(listedItem.id);
        listedItems.push(listedItem);
      }

      discoveredCount += listedItems.length;

      const items: NormalizedItem[] = [];

      for (const listedItem of listedItems) {
        console.log(`Backfill PromoDJ item detail fetching | sourceId=${listedItem.id} | url=${listedItem.url}`);
        await sleep(defaultPromodjRequestDelayMs);

        const parsed = await fetchPromodjItemPage(listedItem, feed.id, timeoutMs);
        console.log(
          `Backfill PromoDJ item normalized | sourceId=${listedItem.id} | publishedAt=${parsed.item.publishedAt ?? "null"} | duration=${parsed.source.durationSeconds ?? "null"} | title=${parsed.item.title ?? "null"} | url=${parsed.item.url ?? "null"}`
        );
        items.push(parsed.item);
      }

      for (const result of await insertItemsWithResults(pool, feed.id, items)) {
        console.log(formatInsertDebugLine(result.item, result.inserted));

        if (result.inserted) {
          insertedCount += 1;
        }
      }

      pageUrl = page.nextPageUrl;

      if (pageUrl) {
        await sleep(defaultPromodjRequestDelayMs);
      }
    }
  }

  return {
    discoveredCount,
    insertedCount,
    pageCount: seenPageUrls.size,
    source: "promodj"
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

  const adafruitData = item.rawExtensionData.adafruit;

  if (
    adafruitData &&
    typeof adafruitData === "object" &&
    "postId" in adafruitData &&
    typeof adafruitData.postId === "string"
  ) {
    return adafruitData.postId;
  }

  const adafruitLearnData = item.rawExtensionData.adafruitLearn;

  if (
    adafruitLearnData &&
    typeof adafruitLearnData === "object" &&
    "guideId" in adafruitLearnData &&
    typeof adafruitLearnData.guideId === "string"
  ) {
    return adafruitLearnData.guideId;
  }

  const douData = item.rawExtensionData.dou;

  if (
    douData &&
    typeof douData === "object" &&
    "path" in douData &&
    typeof douData.path === "string"
  ) {
    return douData.path;
  }

  const githubBlogData = item.rawExtensionData.githubBlog;

  if (
    githubBlogData &&
    typeof githubBlogData === "object" &&
    "postId" in githubBlogData &&
    typeof githubBlogData.postId === "string"
  ) {
    return githubBlogData.postId;
  }

  const substackData = item.rawExtensionData.substack;

  if (
    substackData &&
    typeof substackData === "object" &&
    "postId" in substackData &&
    typeof substackData.postId === "string"
  ) {
    return substackData.postId;
  }

  const redditData = item.rawExtensionData.reddit;

  if (
    redditData &&
    typeof redditData === "object" &&
    "name" in redditData &&
    typeof redditData.name === "string"
  ) {
    return redditData.name;
  }

  const libsynData = item.rawExtensionData.libsyn;

  if (
    libsynData &&
    typeof libsynData === "object" &&
    "itemId" in libsynData &&
    typeof libsynData.itemId === "string"
  ) {
    return libsynData.itemId;
  }

  const twitData = item.rawExtensionData.twit;

  if (twitData && typeof twitData === "object") {
    if (
      "episodeKey" in twitData &&
      typeof twitData.episodeKey === "string" &&
      twitData.episodeKey.length > 0
    ) {
      return twitData.episodeKey;
    }

    if (
      "episodeNumber" in twitData &&
      typeof twitData.episodeNumber === "string" &&
      twitData.episodeNumber.length > 0
    ) {
      return twitData.episodeNumber;
    }
  }

  const foreignAffairsData = item.rawExtensionData.foreignAffairs;

  if (
    foreignAffairsData &&
    typeof foreignAffairsData === "object" &&
    "nodeId" in foreignAffairsData &&
    typeof foreignAffairsData.nodeId === "string"
  ) {
    return foreignAffairsData.nodeId;
  }

  const liquorData = item.rawExtensionData.liquor;

  if (
    liquorData &&
    typeof liquorData === "object" &&
    "documentId" in liquorData &&
    typeof liquorData.documentId === "string"
  ) {
    return liquorData.documentId;
  }

  const flibustaData = item.rawExtensionData.flibusta;

  if (
    flibustaData &&
    typeof flibustaData === "object" &&
    "bookId" in flibustaData &&
    typeof flibustaData.bookId === "string"
  ) {
    return flibustaData.bookId;
  }

  const nprFreshAirData = item.rawExtensionData.nprFreshAir;

  if (
    nprFreshAirData &&
    typeof nprFreshAirData === "object" &&
    "episodeId" in nprFreshAirData &&
    typeof nprFreshAirData.episodeId === "string"
  ) {
    return nprFreshAirData.episodeId;
  }

  const nprIndicatorData = item.rawExtensionData.nprIndicator;

  if (
    nprIndicatorData &&
    typeof nprIndicatorData === "object" &&
    "storyId" in nprIndicatorData &&
    typeof nprIndicatorData.storyId === "string"
  ) {
    return nprIndicatorData.storyId;
  }

  const promodjData = item.rawExtensionData.promodj;

  if (
    promodjData &&
    typeof promodjData === "object" &&
    "fileId" in promodjData &&
    typeof promodjData.fileId === "string"
  ) {
    return promodjData.fileId;
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

function resolveRutrackerBackfillStartUrl(
  feed: FeedBackfillTarget,
  start: number | null
): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    const url = new URL(candidate);
    const forumId = extractForumId(url);

    if (!forumId) {
      continue;
    }

    return buildRutrackerForumUrl(forumId, start);
  }

  throw new Error(
    `Feed ${feed.id} does not point to a RuTracker forum page. Expected a URL containing forum id f=... or /f/<id>.`
  );
}

function resolveAdafruitBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveAdafruitRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to the Adafruit blog.`);
}

function resolveLearnBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveLearnRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to Adafruit Learn.`);
}

function resolveDouBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveDouLentaRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to DOU.`);
}

function resolveGitHubBlogBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveGitHubBlogRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to GitHub Blog.`);
}

function resolveSubstackBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveSubstackRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to a Substack publication.`);
}

function resolveRedditBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return buildRedditListingJsonUrl(candidate);
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to an old Reddit subreddit listing.`);
}

function resolveFlossWeeklyLibsynBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveFlossWeeklyLibsynArchiveUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  if (isFlossWeeklyTitle(feed.title)) {
    return resolveFlossWeeklyLibsynArchiveUrl("https://flossweekly.libsyn.com/").toString();
  }

  throw new Error(`Feed ${feed.id} does not point to FLOSS Weekly on Libsyn.`);
}

function resolveFlossWeeklyLibsynBackfillFeedUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.feedUrl, feed.siteUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveFlossWeeklyLibsynFeedUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  if (isFlossWeeklyTitle(feed.title)) {
    return resolveFlossWeeklyLibsynFeedUrl("https://flossweekly.libsyn.com/").toString();
  }

  throw new Error(`Feed ${feed.id} does not point to FLOSS Weekly on Libsyn.`);
}

async function resolveTwitBackfillConfig(
  feed: FeedBackfillTarget,
  timeoutMs: number
): Promise<{ archiveUrl: string; rssUrl: string | null }> {
  const rssUrl = resolveTwitRssUrl(feed);

  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return {
        archiveUrl: resolveTwitEpisodeArchiveUrl(candidate).toString(),
        rssUrl
      };
    } catch {
      continue;
    }
  }

  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      const url = new URL(candidate);

      if (url.hostname === "twit.tv" || url.hostname === "www.twit.tv") {
        return {
          archiveUrl: await fetchTwitShowArchiveUrl(url.toString(), timeoutMs),
          rssUrl
        };
      }
    } catch {
      continue;
    }
  }

  if (rssUrl) {
    const siteUrl = await fetchTwitRssSiteUrl(rssUrl, feed.id, timeoutMs);

    if (siteUrl) {
      return {
        archiveUrl: await fetchTwitShowArchiveUrl(siteUrl, timeoutMs),
        rssUrl
      };
    }
  }

  throw new Error(`Feed ${feed.id} does not point to a Twit show or Twit episodes archive.`);
}

function resolveTwitRssUrl(feed: FeedBackfillTarget): string | null {
  for (const candidate of [feed.feedUrl, feed.siteUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      const url = new URL(candidate);

      if (url.hostname === "feeds.twit.tv") {
        return url.toString();
      }
    } catch {
      continue;
    }
  }

  return null;
}

function resolveForeignAffairsBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveForeignAffairsRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to Foreign Affairs.`);
}

function resolveForeignAffairsInterviewBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveForeignAffairsInterviewArchiveUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  if (isForeignAffairsInterviewTitle(feed.title)) {
    return resolveForeignAffairsInterviewArchiveUrl("https://www.foreignaffairs.com/rss.xml").toString();
  }

  throw new Error(`Feed ${feed.id} does not point to The Foreign Affairs Interview archive.`);
}

function resolveLiquorBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveLiquorRootUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to Liquor.com.`);
}

function resolveFlibustaBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveFlibustaGenreUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to a Flibusta genre feed.`);
}

function resolveNprFreshAirBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveNprFreshAirArchiveUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to NPR Fresh Air.`);
}

function resolveNprIndicatorBackfillStartUrl(feed: FeedBackfillTarget): string {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    try {
      return resolveNprIndicatorPodcastUrl(candidate).toString();
    } catch {
      continue;
    }
  }

  throw new Error(`Feed ${feed.id} does not point to NPR's The Indicator.`);
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

function isAdafruitFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return url.hostname === "blog.adafruit.com";
    } catch {
      return false;
    }
  });
}

function isLearnFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return url.hostname === "learn.adafruit.com";
    } catch {
      return false;
    }
  });
}

function isDouFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return url.hostname === "dou.ua" || url.hostname === "www.dou.ua";
    } catch {
      return false;
    }
  });
}

function isGitHubBlogFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return url.hostname === "github.blog" || url.hostname === "www.github.blog";
    } catch {
      return false;
    }
  });
}

function isSubstackFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return isSupportedSubstackHost(url.hostname);
    } catch {
      return false;
    }
  });
}

function isRedditFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    return isRedditListingUrl(candidate);
  });
}

function isFlossWeeklyLibsynFeed(feed: FeedBackfillTarget): boolean {
  if ([feed.siteUrl, feed.feedUrl].some((candidate) => candidate && isFlossWeeklyLibsynUrl(candidate))) {
    return true;
  }

  return isFlossWeeklyTitle(feed.title);
}

function isFlossWeeklyTitle(title: string | null): boolean {
  return title?.trim().toLowerCase() === "floss weekly";
}

function isTwitFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => candidate && isTwitUrl(candidate));
}

function isForeignAffairsFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    return isForeignAffairsUrl(candidate);
  });
}

function isForeignAffairsInterviewFeed(feed: FeedBackfillTarget): boolean {
  if ([feed.siteUrl, feed.feedUrl].some((candidate) => candidate && isForeignAffairsInterviewArchiveUrl(candidate))) {
    return true;
  }

  return isForeignAffairsInterviewTitle(feed.title);
}

function isForeignAffairsInterviewTitle(title: string | null): boolean {
  return title?.trim().toLowerCase() === "the foreign affairs interview";
}

function isLiquorFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    return isLiquorUrl(candidate);
  });
}

function isFlibustaFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    return isFlibustaGenreUrl(candidate);
  });
}

function isNprFreshAirFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    return isNprFreshAirUrl(candidate);
  });
}

function isNprIndicatorFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    return isNprIndicatorUrl(candidate);
  });
}

function isPromodjFeed(feed: FeedBackfillTarget): boolean {
  return [feed.siteUrl, feed.feedUrl].some((candidate) => {
    if (!candidate) {
      return false;
    }

    if (isPromodjMaveBackfillFeed(candidate)) {
      return true;
    }

    try {
      return new URL(candidate).toString() === resolvePromodjMusicUrl();
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

function sleepRandom(range: { maxMs: number; minMs: number }): Promise<void> {
  const delayMs =
    range.minMs + Math.floor(Math.random() * (range.maxMs - range.minMs + 1));

  console.log(`Backfill request delay: ${delayMs}ms`);
  return sleep(delayMs);
}

function resolveLearnBackfillDelay(): { maxMs: number; minMs: number } {
  const minMs = resolvePositiveIntegerEnv(
    "LEARN_BACKFILL_DELAY_MIN_MS",
    defaultLearnRequestDelayMinMs
  );
  const maxMs = resolvePositiveIntegerEnv(
    "LEARN_BACKFILL_DELAY_MAX_MS",
    defaultLearnRequestDelayMaxMs
  );

  if (maxMs < minMs) {
    throw new Error(
      `LEARN_BACKFILL_DELAY_MAX_MS must be greater than or equal to LEARN_BACKFILL_DELAY_MIN_MS. Got min=${minMs} max=${maxMs}.`
    );
  }

  return { maxMs, minMs };
}

function resolveSubstackBackfillDelay(): { maxMs: number; minMs: number } {
  const minMs = resolvePositiveIntegerEnv(
    "SUBSTACK_BACKFILL_DELAY_MIN_MS",
    defaultSubstackRequestDelayMinMs
  );
  const maxMs = resolvePositiveIntegerEnv(
    "SUBSTACK_BACKFILL_DELAY_MAX_MS",
    defaultSubstackRequestDelayMaxMs
  );

  if (maxMs < minMs) {
    throw new Error(
      `SUBSTACK_BACKFILL_DELAY_MAX_MS must be greater than or equal to SUBSTACK_BACKFILL_DELAY_MIN_MS. Got min=${minMs} max=${maxMs}.`
    );
  }

  return { maxMs, minMs };
}

function resolveRedditBackfillDelay(): { maxMs: number; minMs: number } {
  const minMs = resolvePositiveIntegerEnv(
    "REDDIT_BACKFILL_DELAY_MIN_MS",
    defaultRedditRequestDelayMinMs
  );
  const maxMs = resolvePositiveIntegerEnv(
    "REDDIT_BACKFILL_DELAY_MAX_MS",
    defaultRedditRequestDelayMaxMs
  );

  if (maxMs < minMs) {
    throw new Error(
      `REDDIT_BACKFILL_DELAY_MAX_MS must be greater than or equal to REDDIT_BACKFILL_DELAY_MIN_MS. Got min=${minMs} max=${maxMs}.`
    );
  }

  return { maxMs, minMs };
}

function resolveForeignAffairsBackfillDelay(): { maxMs: number; minMs: number } {
  const minMs = resolvePositiveIntegerEnv(
    "FOREIGN_AFFAIRS_BACKFILL_DELAY_MIN_MS",
    defaultForeignAffairsRequestDelayMinMs
  );
  const maxMs = resolvePositiveIntegerEnv(
    "FOREIGN_AFFAIRS_BACKFILL_DELAY_MAX_MS",
    defaultForeignAffairsRequestDelayMaxMs
  );

  if (maxMs < minMs) {
    throw new Error(
      `FOREIGN_AFFAIRS_BACKFILL_DELAY_MAX_MS must be greater than or equal to FOREIGN_AFFAIRS_BACKFILL_DELAY_MIN_MS. Got min=${minMs} max=${maxMs}.`
    );
  }

  return { maxMs, minMs };
}

function resolveLiquorBackfillDelay(): { maxMs: number; minMs: number } {
  const minMs = resolvePositiveIntegerEnv(
    "LIQUOR_BACKFILL_DELAY_MIN_MS",
    defaultLiquorRequestDelayMinMs
  );
  const maxMs = resolvePositiveIntegerEnv(
    "LIQUOR_BACKFILL_DELAY_MAX_MS",
    defaultLiquorRequestDelayMaxMs
  );

  if (maxMs < minMs) {
    throw new Error(
      `LIQUOR_BACKFILL_DELAY_MAX_MS must be greater than or equal to LIQUOR_BACKFILL_DELAY_MIN_MS. Got min=${minMs} max=${maxMs}.`
    );
  }

  return { maxMs, minMs };
}

function resolvePositiveIntegerEnv(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();

  if (!configured) {
    return fallback;
  }

  const parsed = Number(configured);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds, got: ${configured}`);
  }

  return parsed;
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
