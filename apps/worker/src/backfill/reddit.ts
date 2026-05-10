import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];

interface RedditListing {
  data?: {
    after?: unknown;
    before?: unknown;
    children?: unknown;
  };
  kind?: unknown;
}

interface RedditChild {
  data?: unknown;
  kind?: unknown;
}

interface RedditPost {
  author?: unknown;
  created_utc?: unknown;
  domain?: unknown;
  id?: unknown;
  is_self?: unknown;
  locked?: unknown;
  name?: unknown;
  num_comments?: unknown;
  over_18?: unknown;
  permalink?: unknown;
  post_hint?: unknown;
  score?: unknown;
  selftext?: unknown;
  selftext_html?: unknown;
  spoiler?: unknown;
  stickied?: unknown;
  subreddit?: unknown;
  subreddit_name_prefixed?: unknown;
  thumbnail?: unknown;
  title?: unknown;
  url?: unknown;
}

export interface RedditBackfillPage {
  after: string | null;
  itemCount: number;
  items: NormalizedItem[];
  nextPageUrl: string | null;
  subreddit: string | null;
}

const redditPageSize = 100;
const supportedSorts = new Set(["controversial", "hot", "new", "rising", "top"]);
const requestHeaders: HeadersInit = {
  accept: "application/json",
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchRedditBackfillPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<RedditBackfillPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Reddit backfill request failed with HTTP ${response.status}.`);
  }

  return parseRedditListingPage(await response.text(), url, feedId);
}

export function parseRedditListingPage(
  json: string,
  pageUrl: string,
  feedId: string
): RedditBackfillPage {
  const payload = JSON.parse(json) as RedditListing;
  const data = payload.data;
  const children = Array.isArray(data?.children) ? data.children : [];
  const items = new Map<string, NormalizedItem>();

  for (const child of children) {
    if (!isObject(child)) {
      continue;
    }

    const redditChild = child as RedditChild;

    if (redditChild.kind !== "t3" || !isObject(redditChild.data)) {
      continue;
    }

    const item = normalizeRedditPost(redditChild.data as RedditPost, pageUrl, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  const after = typeof data?.after === "string" && data.after.length > 0 ? data.after : null;

  return {
    after,
    itemCount: children.length,
    items: Array.from(items.values()),
    nextPageUrl: after ? buildRedditListingJsonUrl(pageUrl, after) : null,
    subreddit: parseRedditListingUrl(pageUrl)?.subreddit ?? null
  };
}

export function normalizeRedditPost(
  post: RedditPost,
  pageUrl: string,
  feedId: string
): NormalizedItem | null {
  const id = readString(post.id);
  const name = readString(post.name) ?? (id ? `t3_${id}` : null);
  const title = normalizeWhitespace(readString(post.title) ?? "");
  const permalink = readString(post.permalink);
  const commentsUrl = permalink ? normalizeRedditCommentsUrl(permalink, pageUrl) : null;

  if (!name || !title || !commentsUrl) {
    return null;
  }

  const externalUrl = normalizeUrl(readString(post.url), pageUrl);
  const author = readString(post.author);
  const publishedAt = parseCreatedUtc(post.created_utc);
  const selftext = normalizeWhitespace(readString(post.selftext) ?? "");
  const selftextHtml = decodeHtmlEntities(readString(post.selftext_html));
  const subreddit = readString(post.subreddit);
  const subredditNamePrefixed = readString(post.subreddit_name_prefixed);

  return {
    author: author ? `/u/${author}` : null,
    contentHtml: buildContentHtml({
      commentsUrl,
      externalUrl,
      selftextHtml,
      title
    }),
    dedupeKey: buildDedupeKey(feedId, name, commentsUrl, title, publishedAt),
    guid: name,
    publishedAt,
    rawExtensionData: {
      reddit: {
        backfilledFrom: pageUrl,
        domain: readString(post.domain),
        externalUrl,
        id,
        isSelf: readBoolean(post.is_self),
        locked: readBoolean(post.locked),
        name,
        numComments: readNumber(post.num_comments),
        over18: readBoolean(post.over_18),
        permalink,
        postHint: readString(post.post_hint),
        score: readNumber(post.score),
        spoiler: readBoolean(post.spoiler),
        stickied: readBoolean(post.stickied),
        subreddit,
        subredditNamePrefixed,
        thumbnail: readString(post.thumbnail)
      }
    },
    summaryText: selftext.length > 0 ? selftext : null,
    title,
    url: commentsUrl
  };
}

export function buildRedditListingJsonUrl(candidate: string, after: string | null = null): string {
  const parsed = parseRedditListingUrl(candidate);

  if (!parsed) {
    throw new Error(`Expected an old Reddit subreddit listing URL, got: ${candidate}`);
  }

  const url = new URL(`/r/${parsed.subreddit}/${parsed.sort}/.json`, parsed.origin);
  url.searchParams.set("limit", String(redditPageSize));

  if (parsed.timeFilter) {
    url.searchParams.set("t", parsed.timeFilter);
  }

  if (after) {
    url.searchParams.set("after", after);
  }

  return url.toString();
}

export function isRedditListingUrl(candidate: string): boolean {
  try {
    return parseRedditListingUrl(candidate) !== null;
  } catch {
    return false;
  }
}

function parseRedditListingUrl(candidate: string): {
  origin: string;
  sort: string;
  subreddit: string;
  timeFilter: string | null;
} | null {
  const url = new URL(candidate);

  if (!isSupportedRedditHost(url.hostname)) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "r" || !parts[1]) {
    return null;
  }

  let sort = "new";

  for (const part of parts.slice(2)) {
    const cleaned = part.toLowerCase().replace(/^\./, "");

    if (cleaned === "json" || cleaned === "rss") {
      continue;
    }

    const sortCandidate = cleaned.replace(/\.(?:json|rss)$/i, "");

    if (supportedSorts.has(sortCandidate)) {
      sort = sortCandidate;
      break;
    }

    return null;
  }

  return {
    origin: url.origin,
    sort,
    subreddit: parts[1],
    timeFilter: url.searchParams.get("t")
  };
}

function normalizeRedditCommentsUrl(permalink: string, pageUrl: string): string | null {
  const url = normalizeUrl(permalink, pageUrl);

  if (!url) {
    return null;
  }

  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

function buildContentHtml(input: {
  commentsUrl: string;
  externalUrl: string | null;
  selftextHtml: string | null;
  title: string;
}): string {
  const parts: string[] = [];

  if (input.selftextHtml) {
    parts.push(input.selftextHtml);
  }

  if (input.externalUrl && input.externalUrl !== input.commentsUrl) {
    parts.push(`<p><a href="${escapeHtml(input.externalUrl)}">${escapeHtml(input.title)}</a></p>`);
  }

  parts.push(`<p><a href="${escapeHtml(input.commentsUrl)}">comments</a></p>`);

  return parts.join("");
}

function parseCreatedUtc(value: unknown): string | null {
  const seconds = readNumber(value);

  if (seconds === null) {
    return null;
  }

  const date = new Date(seconds * 1000);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeHtmlEntities(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const decoded = normalizeWhitespace(textContent(parseFragment(value)));

  return decoded.length > 0 ? decoded : null;
}

function textContent(node: HtmlNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  return childNodes(node)
    .map((child) => textContent(child))
    .join("");
}

function childNodes(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function normalizeUrl(value: string | null, pageUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, pageUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isSupportedRedditHost(hostname: string): boolean {
  return hostname === "old.reddit.com" || hostname === "www.reddit.com" || hostname === "reddit.com";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
