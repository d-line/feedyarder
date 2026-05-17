import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface FlibustaBackfillPage {
  genreSlug: string;
  genreTitle: string | null;
  items: NormalizedItem[];
  nextPageUrl: string | null;
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchFlibustaBackfillPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<FlibustaBackfillPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Flibusta backfill request failed with HTTP ${response.status}.`);
  }

  return parseFlibustaGenrePage(await response.text(), url, feedId);
}

export function parseFlibustaGenrePage(
  html: string,
  pageUrl: string,
  feedId: string
): FlibustaBackfillPage {
  const document = parse(html);
  const genreSlug = parseFlibustaGenreSlug(pageUrl);
  const genreTitle = pickGenreTitle(document);
  const list = pickGenreList(document, genreSlug);
  const items = list ? parseGenreList(list, pageUrl, feedId, genreSlug, genreTitle) : [];

  return {
    genreSlug,
    genreTitle,
    items,
    nextPageUrl: pickNextPageUrl(document, pageUrl)
  };
}

export function resolveFlibustaGenreUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname !== "flibusta.is") {
    throw new Error(`Expected a Flibusta URL, got: ${candidate}`);
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "g" || !parts[1]) {
    throw new Error(`Expected a Flibusta genre URL, got: ${candidate}`);
  }

  return new URL(`/g/${parts[1]}/`, "https://flibusta.is");
}

export function isFlibustaGenreUrl(candidate: string): boolean {
  try {
    resolveFlibustaGenreUrl(candidate);
    return true;
  } catch {
    return false;
  }
}

function parseGenreList(
  list: HtmlElement,
  pageUrl: string,
  feedId: string,
  genreSlug: string,
  genreTitle: string | null
): NormalizedItem[] {
  const items = new Map<string, NormalizedItem>();
  let currentDate: string | null = null;
  let currentAuthor: { name: string; url: string | null } | null = null;

  for (const child of childNodes(list)) {
    if (!isElement(child)) {
      continue;
    }

    if (child.tagName === "h4") {
      currentDate = parseFlibustaAddedDate(textContent(child));
      continue;
    }

    if (child.tagName === "h5") {
      currentAuthor = parseAuthorHeading(child, pageUrl);
      continue;
    }

    if (child.tagName !== "a") {
      continue;
    }

    const item = parseBookLink(child, {
      author: currentAuthor,
      feedId,
      genreSlug,
      genreTitle,
      pageUrl,
      publishedAt: currentDate
    });

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  return Array.from(items.values());
}

function parseBookLink(
  link: HtmlElement,
  context: {
    author: { name: string; url: string | null } | null;
    feedId: string;
    genreSlug: string;
    genreTitle: string | null;
    pageUrl: string;
    publishedAt: string | null;
  }
): NormalizedItem | null {
  const href = getAttribute(link, "href");
  const bookId = href?.match(/^\/b\/(\d+)$/)?.[1];
  const bookTitle = normalizeWhitespace(textContent(link));

  if (!bookId || bookTitle.length === 0) {
    return null;
  }

  const bookUrl = `http://flibusta.is/b/${bookId}`;
  const title = buildRssLikeTitle(bookTitle, context.author?.name ?? null, context.genreTitle);
  const summaryText = buildSummaryText(bookTitle, context.author?.name ?? null, context.genreTitle);

  return {
    author: context.author?.name ?? null,
    contentHtml: buildContentHtml({
      author: context.author,
      bookTitle,
      bookUrl,
      genreTitle: context.genreTitle,
      publishedAt: context.publishedAt
    }),
    dedupeKey: buildDedupeKey(context.feedId, bookUrl, bookUrl, title, context.publishedAt),
    guid: bookUrl,
    publishedAt: context.publishedAt,
    rawExtensionData: {
      flibusta: {
        addedDate: context.publishedAt?.slice(0, 10) ?? null,
        authorUrl: context.author?.url ?? null,
        backfilledFrom: context.pageUrl,
        bookId,
        genreSlug: context.genreSlug,
        genreTitle: context.genreTitle
      }
    },
    summaryText,
    title,
    url: bookUrl
  };
}

export function parseFlibustaAddedDate(value: string): string | null {
  const match = normalizeWhitespace(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const day = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString();
}

function parseAuthorHeading(
  heading: HtmlElement,
  pageUrl: string
): { name: string; url: string | null } | null {
  const authorLink = findElements(heading, (element) => element.tagName === "a")[0];
  const name = authorLink ? normalizeWhitespace(textContent(authorLink)) : normalizeWhitespace(textContent(heading));

  if (name.length === 0) {
    return null;
  }

  const href = authorLink ? getAttribute(authorLink, "href") : null;
  const url = href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;

  return { name, url };
}

function pickGenreTitle(document: HtmlNode): string | null {
  const title = findElements(
    document,
    (element) => element.tagName === "h1" && hasClass(element, "title")
  )[0];
  const value = title ? normalizeWhitespace(textContent(title)) : "";

  return value.length > 0 ? value : null;
}

function pickGenreList(document: HtmlNode, genreSlug: string): HtmlElement | null {
  const genreForm = findElements(document, (element) => {
    if (element.tagName !== "form") {
      return false;
    }

    const action = getAttribute(element, "action") ?? "";
    return action === `/g/${genreSlug}` || action === `/g/${genreSlug}/`;
  })[0];

  return genreForm
    ? findElements(genreForm, (element) => element.tagName === "ol")[0] ?? null
    : null;
}

function pickNextPageUrl(document: HtmlNode, pageUrl: string): string | null {
  const nextLink = findElements(document, (element) => {
    if (element.tagName !== "a") {
      return false;
    }

    const text = normalizeWhitespace(textContent(element)).toLowerCase();
    return text === "следующая" || text === "следующая ›" || text === "next" || text === "›";
  })[0];
  const href = nextLink ? getAttribute(nextLink, "href") : null;

  return href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;
}

function parseFlibustaGenreSlug(candidate: string): string {
  return resolveFlibustaGenreUrl(candidate).pathname.split("/").filter(Boolean)[1] ?? "";
}

function buildRssLikeTitle(bookTitle: string, author: string | null, genreTitle: string | null): string {
  return [bookTitle, author, genreTitle].filter((part): part is string => Boolean(part)).join(" - ");
}

function buildSummaryText(
  bookTitle: string,
  author: string | null,
  genreTitle: string | null
): string | null {
  const parts = [
    `Book: ${bookTitle}`,
    author ? `Author: ${author}` : null,
    genreTitle ? `Genre: ${genreTitle}` : null
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" — ") : null;
}

function buildContentHtml(input: {
  author: { name: string; url: string | null } | null;
  bookTitle: string;
  bookUrl: string;
  genreTitle: string | null;
  publishedAt: string | null;
}): string {
  const parts = [`<p><a href="${escapeHtml(input.bookUrl)}">${escapeHtml(input.bookTitle)}</a></p>`];

  const metadata = [
    input.author
      ? `Author: ${input.author.url ? `<a href="${escapeHtml(input.author.url)}">${escapeHtml(input.author.name)}</a>` : escapeHtml(input.author.name)}`
      : null,
    input.genreTitle ? `Genre: ${escapeHtml(input.genreTitle)}` : null,
    input.publishedAt ? `Added: ${escapeHtml(input.publishedAt.slice(0, 10))}` : null
  ].filter((part): part is string => Boolean(part));

  if (metadata.length > 0) {
    parts.push(`<p>${metadata.join(" — ")}</p>`);
  }

  return parts.join("");
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
