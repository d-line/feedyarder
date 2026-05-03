import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface DouBackfillPage {
  items: NormalizedItem[];
  nextPageUrl: string | null;
  pageNumber: number;
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

const ukrainianMonthIndexes = new Map<string, number>([
  ["січня", 0],
  ["лютого", 1],
  ["березня", 2],
  ["квітня", 3],
  ["травня", 4],
  ["червня", 5],
  ["липня", 6],
  ["серпня", 7],
  ["вересня", 8],
  ["жовтня", 9],
  ["листопада", 10],
  ["грудня", 11]
]);

export async function fetchDouBackfillPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<DouBackfillPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`DOU backfill request failed with HTTP ${response.status}.`);
  }

  return parseDouLentaPage(await response.text(), url, feedId);
}

export function parseDouLentaPage(
  html: string,
  pageUrl: string,
  feedId: string,
  currentYear = new Date().getUTCFullYear()
): DouBackfillPage {
  const document = parse(html);
  const articles = findElements(
    document,
    (element) => element.tagName === "article" && hasClass(element, "b-postcard")
  );
  const items = new Map<string, NormalizedItem>();

  for (const article of articles) {
    const item = parsePostcard(article, pageUrl, feedId, currentYear);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  return {
    items: Array.from(items.values()),
    nextPageUrl: pickNextPageUrl(html, pageUrl),
    pageNumber: parsePageNumber(pageUrl)
  };
}

export function parseDouArchiveDate(value: string, currentYear = new Date().getUTCFullYear()): string | null {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/^(\d{1,2})\s+([^\s,]+)(?:\s+(\d{4}))?\s*,\s*(\d{1,2}):(\d{2})$/u);

  if (!match?.[1] || !match[2] || !match[4] || !match[5]) {
    return null;
  }

  const monthIndex = ukrainianMonthIndexes.get(match[2].toLowerCase());

  if (monthIndex === undefined) {
    return null;
  }

  const day = Number(match[1]);
  const year = match[3] ? Number(match[3]) : currentYear;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, monthIndex, day, hour, minute));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function resolveDouLentaRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname !== "dou.ua" && url.hostname !== "www.dou.ua") {
    throw new Error(`Expected a DOU URL, got: ${candidate}`);
  }

  if (url.pathname.startsWith("/lenta/page/")) {
    return new URL(url.pathname, "https://dou.ua");
  }

  return new URL("/lenta/", "https://dou.ua");
}

function parsePostcard(
  article: HtmlElement,
  pageUrl: string,
  feedId: string,
  currentYear: number
): NormalizedItem | null {
  const titleLink = findElements(article, (element) => element.tagName === "a")
    .find((link) => {
      const parent = findAncestorTag(article, link, "h2");
      return parent ? hasClass(parent, "title") : false;
    });
  const href = titleLink ? getAttribute(titleLink, "href") : null;
  const title = titleLink ? normalizeWhitespace(textContent(titleLink)) : null;

  if (!href || !title) {
    return null;
  }

  const url = resolveUrl(href, pageUrl);

  if (!url) {
    return null;
  }

  url.search = "";
  url.hash = "";

  const articleUrl = url.toString();
  const author = pickAuthor(article);
  const publishedAt = pickPublishedAt(article, currentYear);
  const summaryText = pickSummaryText(article);
  const topic = pickTopic(article);
  const tags = pickTags(article);
  const path = url.pathname;

  return {
    author,
    contentHtml: buildContentHtml(articleUrl, title, summaryText, topic, tags),
    dedupeKey: buildDedupeKey(feedId, articleUrl, articleUrl, title, publishedAt),
    guid: articleUrl,
    publishedAt,
    rawExtensionData: {
      dou: {
        backfilledFrom: pageUrl,
        path,
        tags,
        topic
      }
    },
    summaryText,
    title,
    url: articleUrl
  };
}

function pickAuthor(article: HtmlElement): string | null {
  const authorLink = findElements(article, (element) => element.tagName === "a" && hasClass(element, "author"))[0];

  return authorLink ? normalizeWhitespace(textContent(authorLink)) : null;
}

function pickPublishedAt(article: HtmlElement, currentYear: number): string | null {
  const time = findElements(article, (element) => element.tagName === "time" && hasClass(element, "date"))[0];

  return time ? parseDouArchiveDate(textContent(time), currentYear) : null;
}

function pickSummaryText(article: HtmlElement): string | null {
  const paragraph = findElements(article, (element) => element.tagName === "p")[0];
  const summary = paragraph ? normalizeWhitespace(textContent(paragraph)) : "";

  return summary.length > 0 ? summary : null;
}

function pickTopic(article: HtmlElement): string | null {
  const topicLink = findElements(article, (element) => element.tagName === "a" && hasClass(element, "topic"))[0];
  const topic = topicLink ? normalizeWhitespace(textContent(topicLink)) : "";

  return topic.length > 0 ? topic : null;
}

function pickTags(article: HtmlElement): string[] {
  const tags = findElements(article, (element) => element.tagName === "a")
    .filter((link) => {
      const href = getAttribute(link, "href") ?? "";
      return href.includes("/lenta/tags/");
    })
    .map((link) => normalizeWhitespace(textContent(link)))
    .filter((tag) => tag.length > 0);

  return Array.from(new Set(tags));
}

function pickNextPageUrl(html: string, pageUrl: string): string | null {
  const match = html.match(/window\.nextPageUrl\s*=\s*"([^"]+)"/);
  const href = match?.[1];

  return href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;
}

function buildContentHtml(
  url: string,
  title: string,
  summaryText: string | null,
  topic: string | null,
  tags: string[]
): string {
  const parts = [`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`];

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  const taxonomy = [
    topic ? `Topic: ${topic}` : null,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : null
  ].filter((part): part is string => Boolean(part));

  if (taxonomy.length > 0) {
    parts.push(`<p>${escapeHtml(taxonomy.join(" — "))}</p>`);
  }

  return parts.join("");
}

function parsePageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const match = url.pathname.match(/\/lenta\/page\/(\d+)\/?$/);

  return match?.[1] ? Number(match[1]) : 1;
}

function findAncestorTag(root: HtmlElement, target: HtmlElement, tagName: string): HtmlElement | null {
  const parents = new Map<HtmlElement, HtmlElement>();

  populateParents(root, parents);

  let current = parents.get(target) ?? null;

  while (current) {
    if (current.tagName === tagName) {
      return current;
    }

    current = parents.get(current) ?? null;
  }

  return null;
}

function populateParents(parent: HtmlElement, parents: Map<HtmlElement, HtmlElement>): void {
  for (const child of childNodes(parent)) {
    if (!isElement(child)) {
      continue;
    }

    parents.set(child, parent);
    populateParents(child, parents);
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

function hasClass(element: HtmlElement, className: string): boolean {
  return (getAttribute(element, "class") ?? "").split(/\s+/).includes(className);
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
