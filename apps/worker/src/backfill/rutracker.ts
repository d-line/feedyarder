import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface RutrackerBackfillPage {
  items: NormalizedItem[];
  maxStart: number | null;
  pageSize: number;
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};
const maxRequestAttempts = 3;
const retryBaseDelayMs = 1_000;

const russianMonths = new Map<string, number>([
  ["янв", 0],
  ["фев", 1],
  ["мар", 2],
  ["апр", 3],
  ["май", 4],
  ["июн", 5],
  ["июл", 6],
  ["авг", 7],
  ["сен", 8],
  ["окт", 9],
  ["ноя", 10],
  ["дек", 11]
]);

export function buildRutrackerForumUrl(forumId: string, start: number | null): string {
  const forumUrl = new URL("https://rutracker.org/forum/viewforum.php");
  forumUrl.searchParams.set("f", forumId);

  if (start !== null) {
    forumUrl.searchParams.set("start", String(start));
  }

  return forumUrl.toString();
}

export async function fetchRutrackerBackfillPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<RutrackerBackfillPage> {
  for (let attempt = 1; attempt <= maxRequestAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok) {
        return parseRutrackerForumPage(await decodeResponseText(response), url, feedId);
      }

      const error = new Error(
        `RuTracker backfill request failed with HTTP ${response.status}.`
      );

      if (!isRetryableStatus(response.status) || attempt === maxRequestAttempts) {
        throw error;
      }

      await waitBeforeRetry(url, attempt, error.message);
    } catch (error) {
      if (attempt === maxRequestAttempts || isNonRetryableHttpError(error)) {
        throw error;
      }

      await waitBeforeRetry(url, attempt, formatError(error));
    }
  }

  throw new Error("RuTracker backfill request exhausted its retry attempts.");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isNonRetryableHttpError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const match = /^RuTracker backfill request failed with HTTP (\d+)\.$/.exec(error.message);
  return match ? !isRetryableStatus(Number(match[1])) : false;
}

async function waitBeforeRetry(url: string, attempt: number, reason: string): Promise<void> {
  const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
  console.warn(
    `RuTracker backfill request retrying: url=${url} attempt=${attempt + 1}/${maxRequestAttempts} delayMs=${delayMs} reason=${reason}`
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseRutrackerForumPage(
  html: string,
  pageUrl: string,
  feedId: string
): RutrackerBackfillPage {
  const document = parse(html);
  const rows = findElements(document, (element) => element.tagName === "tr");
  const items = new Map<string, NormalizedItem>();

  for (const row of rows) {
    const item = parseTopicRow(row, pageUrl, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  return {
    items: Array.from(items.values()),
    ...parseForumPagination(document, pageUrl)
  };
}

function parseTopicRow(
  row: HtmlElement,
  pageUrl: string,
  feedId: string
): NormalizedItem | null {
  const topicLink = pickTopicLink(row, pageUrl);

  if (!topicLink) {
    return null;
  }

  const topicId = topicLink.url.searchParams.get("t");

  if (!topicId) {
    return null;
  }

  const url = canonicalizeTopicUrl(topicLink.url);
  const guid = `rutracker-topic:${topicId}`;
  const title = normalizeWhitespace(topicLink.title);
  const rowText = normalizeWhitespace(textContent(row));
  const publishedAt = parseRutrackerDate(rowText);
  const author = pickAuthor(row);
  const summaryText = `RuTracker forum topic ${topicId}`;
  const contentHtml = `<p><a href="${escapeHtml(url)}">Open topic on RuTracker</a></p>`;

  return {
    author,
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      rutracker: {
        backfilledFrom: pageUrl,
        topicId
      }
    },
    summaryText,
    title,
    url
  };
}

function pickTopicLink(
  row: HtmlElement,
  pageUrl: string
): { title: string; url: URL } | null {
  const links = findElements(row, (element) => element.tagName === "a")
    .map((element) => ({
      className: getAttribute(element, "class") ?? "",
      href: getAttribute(element, "href"),
      title: normalizeWhitespace(textContent(element))
    }))
    .filter((link) => link.href && link.title.length > 0)
    .map((link) => ({
      className: link.className,
      title: link.title,
      url: resolveUrl(link.href as string, pageUrl)
    }))
    .filter(
      (link): link is { className: string; title: string; url: URL } =>
        Boolean(
          link.url?.pathname.endsWith("/viewtopic.php") && link.url.searchParams.has("t")
        )
    );

  if (links.length === 0) {
    return null;
  }

  return (
    links.find((link) => /\b(torTopic|topictitle|tt-text)\b/.test(link.className)) ??
    links.toSorted((left, right) => right.title.length - left.title.length)[0] ??
    null
  );
}

function pickAuthor(row: HtmlElement): string | null {
  const profileLink = findElements(row, (element) => element.tagName === "a")
    .map((element) => ({
      href: getAttribute(element, "href"),
      text: normalizeWhitespace(textContent(element))
    }))
    .find((link) => link.href?.includes("profile.php") && link.text.length > 0);

  return profileLink?.text ?? null;
}

function parseForumPagination(
  document: HtmlNode,
  pageUrl: string
): { maxStart: number | null; pageSize: number } {
  const currentUrl = new URL(pageUrl);
  const currentForumId = currentUrl.searchParams.get("f");
  const starts = new Set<number>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");

    if (!href) {
      continue;
    }

    const url = resolveUrl(href, pageUrl);

    if (
      !url ||
      !url.pathname.endsWith("/viewforum.php") ||
      url.searchParams.get("f") !== currentForumId
    ) {
      continue;
    }

    const start = Number(url.searchParams.get("start") ?? "0");

    if (Number.isInteger(start) && start >= 0) {
      starts.add(start);
    }
  }

  const sortedStarts = Array.from(starts).sort((left, right) => left - right);
  const positiveStarts = sortedStarts.filter((start) => start > 0);
  const pageSize = positiveStarts[0] ?? 50;

  return {
    maxStart: sortedStarts.at(-1) ?? null,
    pageSize
  };
}

function canonicalizeTopicUrl(url: URL): string {
  const canonical = new URL("/forum/viewtopic.php", url);
  const topicId = url.searchParams.get("t");

  if (topicId) {
    canonical.searchParams.set("t", topicId);
  }

  return canonical.toString();
}

function parseRutrackerDate(text: string): string | null {
  const isoLikeMatch = text.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);

  if (isoLikeMatch) {
    return buildUtcDate(
      isoLikeMatch[1],
      Number(isoLikeMatch[2]) - 1,
      isoLikeMatch[3],
      isoLikeMatch[4],
      isoLikeMatch[5]
    );
  }

  const match = text.match(/(\d{1,2})[-\s.]([А-Яа-яA-Za-z]{3})[-\s.](\d{2,4})\s+(\d{1,2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const dayText = match[1];
  const monthText = match[2];
  const yearText = match[3];
  const hourText = match[4];
  const minuteText = match[5];

  if (!dayText || !monthText || !yearText || !hourText || !minuteText) {
    return null;
  }

  const month = russianMonths.get(monthText.toLowerCase().slice(0, 3));

  if (month === undefined) {
    return null;
  }

  return buildUtcDate(yearText, month, dayText, hourText, minuteText);
}

function buildUtcDate(
  yearText: string | undefined,
  month: number,
  dayText: string | undefined,
  hourText: string | undefined,
  minuteText: string | undefined
): string | null {
  if (!yearText || !dayText || !hourText || !minuteText) {
    return null;
  }

  const yearNumber = Number(yearText);
  const fullYear = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
  const date = new Date(Date.UTC(fullYear, month, Number(dayText), Number(hourText), Number(minuteText)));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

async function decodeResponseText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1] ?? "windows-1251";
  const bytes = await response.arrayBuffer();

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function findElements(
  root: HtmlNode,
  predicate: (element: HtmlElement) => boolean
): HtmlElement[] {
  const matches: HtmlElement[] = [];

  for (const child of childNodes(root)) {
    if (isElement(child)) {
      if (predicate(child)) {
        matches.push(child);
      }

      matches.push(...findElements(child, predicate));
    } else {
      matches.push(...findElements(child, predicate));
    }
  }

  return matches;
}

function textContent(node: HtmlNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  return childNodes(node)
    .map((child) => textContent(child))
    .join(" ");
}

function getAttribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function childNodes(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function resolveUrl(href: string, pageUrl: string): URL | null {
  try {
    return new URL(href, pageUrl);
  } catch {
    return null;
  }
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
