import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

import type { WorkerConfig } from "../config.js";
import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";
import {
  insertItemsWithResults,
  type FeedBackfillTarget
} from "../repository.js";

const collectionUrl = "https://www.nytimes.com/column/ezra-klein-podcast";
const collectionBackfillUrl = `${collectionUrl}?page=10`;
const userAgent = "Feedyarder/0.1 (+https://localhost)";
const collectionsQueryHash = "6c6d034c68b27914ea51da184a895814be8186cf5247dca9a81c92147ebe5490";
const browserPageSize = 10;
const maxBrowserPages = 100;
const chromeExecutableCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

interface EzraCollectionParseResult {
  items: NormalizedItem[];
  reportedTotalCount: number | null;
}

interface ArticleRecord {
  id?: unknown;
  url?: unknown;
  firstPublished?: unknown;
  headline?: {
    default?: unknown;
  };
  bylines?: Array<{
    creators?: Array<{
      displayName?: unknown;
    }>;
    renderedRepresentation?: unknown;
  }>;
  summary?: unknown;
}

interface EzraBrowserArchiveResult {
  items: NormalizedItem[];
  pageCount: number;
  reportedTotalCount: number | null;
}

interface EzraBrowserSession {
  close(): Promise<void>;
  fetchArchive(feedId: string, timeoutMs: number): Promise<EzraBrowserArchiveResult>;
}

interface EzraGraphqlStream {
  edges?: Array<{
    node?: ArticleRecord;
  }>;
  pageInfo?: {
    endCursor?: unknown;
    hasNextPage?: unknown;
  };
  totalCount?: unknown;
}

export async function runEzraKleinBackfill(
  pool: Pool,
  feed: FeedBackfillTarget,
  config: Pick<WorkerConfig, "FETCH_TOTAL_TIMEOUT_MS">
): Promise<{ discoveredCount: number; insertedCount: number; pageCount: number; source: string }> {
  if (!isEzraKleinFeed(feed)) {
    throw new Error(
      `Feed ${feed.id} is not The Ezra Klein Show. Expected a NYT Ezra Klein feed or site URL.`
    );
  }

  console.log(`Backfill Ezra Klein Show collection url=${collectionBackfillUrl}`);

  const session = await createEzraBrowserSession();

  try {
    const result = await session.fetchArchive(feed.id, config.FETCH_TOTAL_TIMEOUT_MS);
    const insertResults = await insertItemsWithResults(pool, feed.id, result.items);
    const insertedCount = insertResults.filter((insertResult) => insertResult.inserted).length;

    console.log(
      `Backfill Ezra Klein Show parsed=${result.items.length} inserted=${insertedCount}`
    );

    if (result.reportedTotalCount && result.reportedTotalCount > result.items.length) {
      console.log(
        `Backfill Ezra Klein Show note: NYT reports totalCount=${result.reportedTotalCount}, browser archive exposed ${result.items.length} items.`
      );
    }

    return {
      discoveredCount: result.items.length,
      insertedCount,
      pageCount: result.pageCount,
      source: "nytimes-ezra-klein"
    };
  } finally {
    await session.close();
  }
}

export function parseEzraKleinCollectionPage(
  html: string,
  feedId: string
): EzraCollectionParseResult {
  const articles = extractArticleRecords(html);

  return {
    items: normalizeArticleRecords(articles, feedId),
    reportedTotalCount: extractReportedTotalCount(html)
  };
}

async function createEzraBrowserSession(
  env: NodeJS.ProcessEnv = process.env
): Promise<EzraBrowserSession> {
  const debugUrl = env.EZRA_KLEIN_BROWSER_DEBUG_URL?.trim();

  if (debugUrl) {
    const browser = await puppeteer.connect({
      browserURL: debugUrl,
      defaultViewport: null
    });
    const pages = await browser.pages();
    const page =
      pages.find((candidate) => candidate.url().includes("nytimes.com")) ??
      pages[0] ??
      await browser.newPage();

    return buildEzraBrowserSession(browser, page, false);
  }

  const executablePath = await resolveChromeExecutablePath(env);
  const userDataDir = path.resolve(
    env.EZRA_KLEIN_BROWSER_USER_DATA_DIR?.trim() ||
      path.join(".feedyarder", "ezra-klein-chrome-profile")
  );
  const headless = parseBooleanEnv(env.EZRA_KLEIN_BROWSER_HEADLESS, true);

  await mkdir(userDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    args: ["--disable-blink-features=AutomationControlled"],
    defaultViewport: null,
    executablePath,
    headless,
    userDataDir
  });
  const pages = await browser.pages();
  const page = pages[0] ?? await browser.newPage();

  return buildEzraBrowserSession(browser, page, true);
}

function buildEzraBrowserSession(
  browser: Browser,
  page: Page,
  ownsBrowser: boolean
): EzraBrowserSession {
  return {
    async close(): Promise<void> {
      if (ownsBrowser) {
        await browser.close();
      } else {
        browser.disconnect();
      }
    },

    async fetchArchive(feedId: string, timeoutMs: number): Promise<EzraBrowserArchiveResult> {
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);

      await page.setUserAgent(userAgent);
      await page.setCacheEnabled(false);

      const response = await page.goto(collectionBackfillUrl, {
        timeout: timeoutMs,
        waitUntil: "networkidle2"
      });

      if (!response?.ok()) {
        throw new Error(
          `NYT Ezra collection browser request failed with HTTP ${response?.status() ?? "unknown"}.`
        );
      }

      const firstPage = parseEzraKleinCollectionPage(await page.content(), feedId);
      const articles = [...firstPage.items];
      const seenUrls = new Set(
        articles
          .map((item) => item.url)
          .filter((value): value is string => Boolean(value))
      );
      let cursor = buildArrayConnectionCursor(articles.length - 1);
      let hasNextPage =
        firstPage.reportedTotalCount === null ||
        articles.length < firstPage.reportedTotalCount;
      let pageCount = 1;

      while (hasNextPage && pageCount < maxBrowserPages) {
        const stream = await fetchCollectionStreamPage(page, cursor);
        const records = readStreamArticleRecords(stream);
        const normalized = normalizeArticleRecords(records, feedId);

        if (normalized.length === 0) {
          break;
        }

        for (const item of normalized) {
          if (item.url && seenUrls.has(item.url)) {
            continue;
          }

          if (item.url) {
            seenUrls.add(item.url);
          }

          articles.push(item);
        }

        pageCount += 1;
        cursor = readString(stream.pageInfo?.endCursor) ?? cursor;
        hasNextPage = stream.pageInfo?.hasNextPage === true;

        console.log(
          `Backfill Ezra Klein Show browser page=${pageCount} discovered=${articles.length} hasNext=${hasNextPage}`
        );
      }

      return {
        items: articles,
        pageCount,
        reportedTotalCount: firstPage.reportedTotalCount
      };
    }
  };
}

async function fetchCollectionStreamPage(
  page: Page,
  cursor: string
): Promise<EzraGraphqlStream> {
  const result = await page.evaluate(
    async ({ cursor, hash, pageSize }) => {
      const token = document.documentElement.innerHTML.match(/"nyt-token":"([^"]+)"/)?.[1];

      if (!token) {
        throw new Error("Could not find NYT public token in browser page.");
      }

      const variables = {
        cursor,
        exclusionMode: "HIGHLIGHTS_AND_EMBEDDED",
        first: pageSize,
        hasHighlightsList: false,
        highlightsListFirst: 0,
        highlightsListUri: "nyt://per/personalized-list/__null__",
        id: "/column/ezra-klein-podcast",
        isEspanol: false,
        isFetchMore: false,
        isTranslatable: false
      };
      const extensions = {
        persistedQuery: {
          sha256Hash: hash,
          version: 1
        }
      };
      const url =
        "https://samizdat-graphql.nytimes.com/graphql/v2?operationName=CollectionsQuery&variables=" +
        encodeURIComponent(JSON.stringify(variables)) +
        "&extensions=" +
        encodeURIComponent(JSON.stringify(extensions));

      const responseText = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.withCredentials = true;
        xhr.open("GET", url, true);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("nyt-app-type", "project-vi");
        xhr.setRequestHeader("nyt-app-version", "0.0.5");
        xhr.setRequestHeader("nyt-token", token);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(new Error(`NYT CollectionsQuery failed with HTTP ${xhr.status}.`));
          }
        };
        xhr.onerror = () => reject(new Error("NYT CollectionsQuery browser XHR failed."));
        xhr.send(null);
      });

      return JSON.parse(responseText) as unknown;
    },
    {
      cursor,
      hash: collectionsQueryHash,
      pageSize: browserPageSize
    }
  );

  return readGraphqlStream(result);
}

async function resolveChromeExecutablePath(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.EZRA_KLEIN_BROWSER_EXECUTABLE_PATH?.trim();

  if (configured) {
    await assertExecutableExists(configured);
    return configured;
  }

  for (const candidate of chromeExecutableCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not find Chrome or Chromium for Ezra Klein backfill. Set EZRA_KLEIN_BROWSER_EXECUTABLE_PATH to the browser executable."
  );
}

async function assertExecutableExists(value: string): Promise<void> {
  try {
    await access(value);
  } catch {
    throw new Error(
      `EZRA_KLEIN_BROWSER_EXECUTABLE_PATH points to a missing browser executable: ${value}`
    );
  }
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const configured = value?.trim().toLowerCase();

  if (!configured) {
    return fallback;
  }

  if (["1", "true", "yes"].includes(configured)) {
    return true;
  }

  if (["0", "false", "no"].includes(configured)) {
    return false;
  }

  throw new Error(
    `EZRA_KLEIN_BROWSER_HEADLESS must be true or false, got: ${value}`
  );
}

function readGraphqlStream(value: unknown): EzraGraphqlStream {
  if (!value || typeof value !== "object") {
    throw new Error("NYT CollectionsQuery returned a non-object response.");
  }

  const response = value as {
    data?: {
      legacyCollection?: {
        collectionsPage?: {
          stream?: EzraGraphqlStream;
        };
      };
    };
    errors?: unknown;
  };
  const stream = response.data?.legacyCollection?.collectionsPage?.stream;

  if (!stream) {
    throw new Error(
      `NYT CollectionsQuery response did not contain a collection stream: ${JSON.stringify(response.errors ?? null)}`
    );
  }

  return stream;
}

function readStreamArticleRecords(stream: EzraGraphqlStream): ArticleRecord[] {
  return (stream.edges ?? [])
    .map((edge) => edge.node)
    .filter((node): node is ArticleRecord => Boolean(node));
}

function buildArrayConnectionCursor(index: number): string {
  return Buffer.from(`arrayconnection:${index}`).toString("base64");
}

export function isEzraKleinFeed(feed: FeedBackfillTarget): boolean {
  return [feed.feedUrl, feed.siteUrl]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.includes("nytimes.com") && value.includes("ezra-klein-podcast"));
}

function extractArticleRecords(html: string): ArticleRecord[] {
  const records: ArticleRecord[] = [];
  const articleKeyPattern = /"Article:[^"]+":/g;
  let match: RegExpExecArray | null;

  while ((match = articleKeyPattern.exec(html)) !== null) {
    const objectStartIndex = findObjectStartIndex(html, match.index + match[0].length);
    const objectText = readBalancedObject(html, objectStartIndex);

    if (!objectText) {
      continue;
    }

    try {
      records.push(JSON.parse(objectText) as ArticleRecord);
    } catch {
      continue;
    }
  }

  return records;
}

function normalizeArticleRecords(
  articles: ArticleRecord[],
  feedId: string
): NormalizedItem[] {
  const seen = new Set<string>();
  const items: NormalizedItem[] = [];

  for (const article of articles) {
    const url = readString(article.url);

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);

    const title = readString(article.headline?.default);
    const publishedAt = parseDate(readString(article.firstPublished));
    const author = readAuthor(article);
    const summaryText = readString(article.summary);
    const guid = url;

    items.push({
      author,
      contentHtml: summaryText,
      dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
      guid,
      publishedAt,
      rawExtensionData: {
        source: "nytimes-collection",
        nytArticleId: readString(article.id)
      },
      summaryText,
      title,
      url
    });
  }

  return items;
}

function findObjectStartIndex(source: string, startIndex: number): number {
  let index = startIndex;

  while (index < source.length && /\s/.test(source.charAt(index))) {
    index += 1;
  }

  return index;
}

function readBalancedObject(source: string, startIndex: number): string | null {
  if (source[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractReportedTotalCount(html: string): number | null {
  const match = html.match(/"totalCount"\s*:\s*(\d+)/);

  if (!match?.[1]) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function readAuthor(article: ArticleRecord): string | null {
  const rendered = article.bylines
    ?.map((byline) => readString(byline.renderedRepresentation))
    .find((value): value is string => Boolean(value));

  if (rendered) {
    return rendered.replace(/^By\s+/i, "");
  }

  const creatorNames = article.bylines
    ?.flatMap((byline) => byline.creators ?? [])
    .map((creator) => readString(creator.displayName))
    .filter((value): value is string => Boolean(value));

  return creatorNames && creatorNames.length > 0
    ? creatorNames.join(", ")
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
