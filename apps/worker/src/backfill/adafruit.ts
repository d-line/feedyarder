import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface AdafruitBackfillPage {
  items: NormalizedItem[];
  pageNumber: number;
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchAdafruitBackfillPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<AdafruitBackfillPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return {
      items: [],
      pageNumber: parsePageNumber(url)
    };
  }

  if (!response.ok) {
    throw new Error(`Adafruit backfill request failed with HTTP ${response.status}.`);
  }

  return parseAdafruitBlogPage(await response.text(), url, feedId);
}

export function parseAdafruitBlogPage(
  html: string,
  pageUrl: string,
  feedId: string
): AdafruitBackfillPage {
  const document = parse(html);
  const rows = findElements(
    document,
    (element) =>
      element.tagName === "div" &&
      hasClass(element, "post-row") &&
      /^post-\d+$/.test(getAttribute(element, "id") ?? "")
  );
  const items = new Map<string, NormalizedItem>();

  for (const row of rows) {
    const item = parsePostRow(row, pageUrl, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  return {
    items: Array.from(items.values()),
    pageNumber: parsePageNumber(pageUrl)
  };
}

export function buildAdafruitPageUrl(startUrl: string, pageNumber: number): string {
  const root = resolveAdafruitRootUrl(startUrl);

  if (pageNumber <= 1) {
    return root.toString();
  }

  return new URL(`/page/${pageNumber}/`, root).toString();
}

export function resolveAdafruitRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname !== "blog.adafruit.com") {
    throw new Error(`Expected an Adafruit blog URL, got: ${candidate}`);
  }

  return new URL("/", url);
}

function parsePostRow(
  row: HtmlElement,
  pageUrl: string,
  feedId: string
): NormalizedItem | null {
  const rowId = getAttribute(row, "id");
  const postId = rowId?.match(/^post-(\d+)$/)?.[1];
  const titleLink = findElements(row, (element) => element.tagName === "a" && hasClass(element, "storytitle"))[0];
  const href = titleLink ? getAttribute(titleLink, "href") : null;
  const title = titleLink ? normalizeWhitespace(textContent(titleLink)) : null;

  if (!postId || !href || !title) {
    return null;
  }

  const url = resolveUrl(href, pageUrl)?.toString();

  if (!url) {
    return null;
  }

  const author = pickAuthor(row);
  const publishedAt = pickPublishedAt(row);
  const thumbnailUrl = pickThumbnailUrl(row);
  const categories = pickTaxonomy(row, "category");
  const tags = pickTaxonomy(row, "tag");
  const guid = `adafruit-post:${postId}`;
  const summaryText = buildSummaryText(categories, tags);

  return {
    author,
    contentHtml: buildContentHtml(url, title, thumbnailUrl, categories, tags),
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      adafruit: {
        backfilledFrom: pageUrl,
        categories,
        postId,
        tags,
        thumbnailUrl
      }
    },
    summaryText,
    title,
    url
  };
}

function pickAuthor(row: HtmlElement): string | null {
  const authorLink = findElements(row, (element) => element.tagName === "a" && hasClass(element, "author"))[0];

  return authorLink ? normalizeWhitespace(textContent(authorLink)) : null;
}

function pickPublishedAt(row: HtmlElement): string | null {
  const time = findElements(row, (element) => element.tagName === "time" && hasClass(element, "published"))[0];
  const datetime = time ? getAttribute(time, "datetime") : null;

  if (!datetime) {
    return null;
  }

  const date = new Date(datetime);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickThumbnailUrl(row: HtmlElement): string | null {
  const thumbnailDiv = findElements(row, (element) => {
    const style = getAttribute(element, "style") ?? "";
    return element.tagName === "div" && style.includes("background-image");
  })[0];
  const style = thumbnailDiv ? getAttribute(thumbnailDiv, "style") : null;
  const match = style?.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
  const rawUrl = match?.[2];

  return rawUrl ? (resolveUrl(rawUrl, "https://blog.adafruit.com/")?.toString() ?? null) : null;
}

function pickTaxonomy(row: HtmlElement, kind: "category" | "tag"): string[] {
  const links = findElements(row, (element) => element.tagName === "a")
    .filter((link) => {
      const rel = getAttribute(link, "rel") ?? "";
      return kind === "category" ? rel.split(/\s+/).includes("category") : rel === "tag";
    })
    .map((link) => normalizeWhitespace(textContent(link)))
    .filter((value) => value.length > 0);

  return Array.from(new Set(links));
}

function buildSummaryText(categories: string[], tags: string[]): string | null {
  const parts = [
    categories.length > 0 ? `Filed under: ${categories.join(", ")}` : null,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : null
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" — ") : null;
}

function buildContentHtml(
  url: string,
  title: string,
  thumbnailUrl: string | null,
  categories: string[],
  tags: string[]
): string {
  const parts = [`<p><a href="${escapeHtml(url)}">Open article on Adafruit Blog</a></p>`];

  if (thumbnailUrl) {
    parts.push(`<p><img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(title)}"></p>`);
  }

  const summaryText = buildSummaryText(categories, tags);

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  return parts.join("");
}

function parsePageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const match = url.pathname.match(/\/page\/(\d+)\/?$/);

  return match?.[1] ? Number(match[1]) : 1;
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
