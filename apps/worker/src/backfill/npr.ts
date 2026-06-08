import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

interface NprAudioData {
  audioUrl?: unknown;
  duration?: unknown;
  slug?: unknown;
  storyUrl?: unknown;
  title?: unknown;
  uid?: unknown;
}

export interface NprArchivePage {
  items: NormalizedItem[];
  monthUrls: string[];
  nextPageUrl: string | null;
}

const freshAirArchiveUrl = "https://www.npr.org/programs/fresh-air/archive";
const requestHeaders: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
};

export async function fetchNprFreshAirArchivePage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<NprArchivePage> {
  const startedAt = Date.now();
  let stage = "waiting_for_response_headers";

  console.log(
    `NPR Fresh Air request started: url=${url} timeoutMs=${timeoutMs}`
  );

  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const headersElapsedMs = Date.now() - startedAt;

    console.log(
      `NPR Fresh Air response headers received: url=${url} status=${response.status} contentLength=${response.headers.get("content-length") ?? "unknown"} contentType=${response.headers.get("content-type") ?? "unknown"} elapsedMs=${headersElapsedMs}`
    );

    if (!response.ok) {
      throw new Error(`NPR Fresh Air backfill request failed with HTTP ${response.status}.`);
    }

    stage = "downloading_response_body";
    const html = await response.text();
    const bodyElapsedMs = Date.now() - startedAt;

    console.log(
      `NPR Fresh Air response body downloaded: url=${url} bytes=${Buffer.byteLength(html)} elapsedMs=${bodyElapsedMs}`
    );

    stage = "parsing_response_body";
    const page = parseNprFreshAirArchivePage(html, url, feedId);

    console.log(
      `NPR Fresh Air response parsed: url=${url} items=${page.items.length} monthLinks=${page.monthUrls.length} next=${page.nextPageUrl ?? "none"} elapsedMs=${Date.now() - startedAt}`
    );

    return page;
  } catch (error) {
    const details = formatRequestError(error);

    throw new Error(
      `NPR Fresh Air request failed: stage=${stage} url=${url} timeoutMs=${timeoutMs} elapsedMs=${Date.now() - startedAt} error=${details}`,
      { cause: error }
    );
  }
}

function formatRequestError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause =
    error.cause instanceof Error
      ? ` cause=${error.cause.name}: ${error.cause.message}`
      : "";

  return `${error.name}: ${error.message}${cause}`;
}

export function parseNprFreshAirArchivePage(
  html: string,
  pageUrl: string,
  feedId: string
): NprArchivePage {
  const document = parse(html);
  const shows = findElements(
    document,
    (element) => element.tagName === "article" && hasClass(element, "program-show")
  );
  const items = new Map<string, NormalizedItem>();

  for (const show of shows) {
    const item = parseProgramShow(show, pageUrl, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  return {
    items: Array.from(items.values()),
    monthUrls: pickArchiveMonthUrls(document, pageUrl),
    nextPageUrl: pickNextPageUrl(document, pageUrl)
  };
}

export function resolveNprFreshAirArchiveUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname === "feeds.npr.org") {
    const parts = url.pathname.split("/").filter(Boolean);

    if (
      (parts[0] === "381444908" && parts[1] === "podcast.xml") ||
      (parts[0] === "13" && parts[1] === "rss.xml")
    ) {
      return new URL(freshAirArchiveUrl);
    }
  }

  if (url.hostname === "www.npr.org" || url.hostname === "npr.org") {
    if (
      url.pathname === "/programs/fresh-air" ||
      url.pathname === "/programs/fresh-air/" ||
      url.pathname === "/programs/fresh-air/archive" ||
      url.pathname === "/programs/fresh-air/archive/" ||
      url.pathname.startsWith("/podcasts/381444908/fresh-air")
    ) {
      return new URL(freshAirArchiveUrl);
    }
  }

  throw new Error(`Expected an NPR Fresh Air URL, got: ${candidate}`);
}

export function isNprFreshAirUrl(candidate: string): boolean {
  try {
    resolveNprFreshAirArchiveUrl(candidate);
    return true;
  } catch {
    return false;
  }
}

export function sameNprArchiveMonth(leftUrl: string, rightUrl: string): boolean {
  const left = readArchiveMonthKey(leftUrl);
  const right = readArchiveMonthKey(rightUrl);

  return left !== null && right !== null && left === right;
}

function parseProgramShow(
  show: HtmlElement,
  pageUrl: string,
  feedId: string
): NormalizedItem | null {
  const episodeId = getAttribute(show, "data-episode-id");
  const episodeDate = getAttribute(show, "data-episode-date");
  const titleLink = findElements(
    show,
    (element) => element.tagName === "a" && findAncestorWithClass(show, element, "program-show__title") !== null
  )[0];
  const href = titleLink ? getAttribute(titleLink, "href") : null;
  const title = titleLink ? normalizeWhitespace(textContent(titleLink)) : "";
  const url = href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;

  if (!episodeId || !episodeDate || !title || !url) {
    return null;
  }

  const publishedAt = parseArchiveDate(episodeDate);
  const segments = pickSegments(show);
  const summaryText = buildSummaryText(segments);

  return {
    author: "NPR",
    contentHtml: buildContentHtml(url, title, episodeDate, segments),
    dedupeKey: buildDedupeKey(feedId, episodeId, url, title, publishedAt),
    guid: episodeId,
    publishedAt,
    rawExtensionData: {
      nprFreshAir: {
        backfilledFrom: pageUrl,
        episodeDate,
        episodeId,
        segments
      }
    },
    summaryText,
    title,
    url
  };
}

function pickSegments(show: HtmlElement): Array<{
  audioUrl: string | null;
  durationSeconds: number | null;
  slug: string | null;
  storyId: string | null;
  title: string;
  uid: string | null;
  url: string | null;
}> {
  const playAll = findElements(show, (element) => getAttribute(element, "data-play-all") !== null)[0];
  const raw = playAll ? getAttribute(playAll, "data-play-all") : null;

  if (raw) {
    const parsed = readPlayAllAudioData(raw);

    if (parsed.length > 0) {
      return parsed;
    }
  }

  return findElements(
    show,
    (element) => element.tagName === "article" && hasClass(element, "program-segment")
  )
    .map((segment) => {
      const titleLink = findElements(
        segment,
        (element) => element.tagName === "a" && findAncestorWithClass(segment, element, "program-segment__title") !== null
      )[0];
      const title = titleLink ? normalizeWhitespace(textContent(titleLink)) : "";
      const href = titleLink ? getAttribute(titleLink, "href") : null;
      const url = href ? (resolveUrl(href, "https://www.npr.org")?.toString() ?? null) : null;
      const storyId = url ? readNprStoryId(url) : null;

      return title
        ? {
            audioUrl: null,
            durationSeconds: null,
            slug: null,
            storyId,
            title,
            uid: null,
            url
          }
        : null;
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
}

function readPlayAllAudioData(raw: string): Array<{
  audioUrl: string | null;
  durationSeconds: number | null;
  slug: string | null;
  storyId: string | null;
  title: string;
  uid: string | null;
  url: string | null;
}> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || !("audioData" in parsed)) {
    return [];
  }

  const audioData = (parsed as { audioData?: unknown }).audioData;

  if (!Array.isArray(audioData)) {
    return [];
  }

  return audioData
    .map((entry) => normalizeAudioData(entry as NprAudioData))
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeAudioData>> => entry !== null);
}

function normalizeAudioData(data: NprAudioData): {
  audioUrl: string | null;
  durationSeconds: number | null;
  slug: string | null;
  storyId: string | null;
  title: string;
  uid: string | null;
  url: string | null;
} | null {
  const title = typeof data.title === "string" ? normalizeWhitespace(data.title) : "";

  if (!title) {
    return null;
  }

  const url = typeof data.storyUrl === "string" ? (resolveUrl(data.storyUrl, "https://www.npr.org")?.toString() ?? null) : null;
  const uid = typeof data.uid === "string" ? data.uid : null;

  return {
    audioUrl: typeof data.audioUrl === "string" ? data.audioUrl : null,
    durationSeconds: typeof data.duration === "number" ? data.duration : null,
    slug: typeof data.slug === "string" && data.slug.length > 0 ? data.slug : null,
    storyId: url ? readNprStoryId(url) : uid?.split(":")[0] ?? null,
    title,
    uid,
    url
  };
}

function pickArchiveMonthUrls(document: HtmlNode, pageUrl: string): string[] {
  const urls = new Map<string, string>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");

    if (!href) {
      continue;
    }

    const url = resolveUrl(href, pageUrl);

    if (!url || url.pathname !== "/programs/fresh-air/archive" || !url.searchParams.has("date")) {
      continue;
    }

    if (url.searchParams.has("eid")) {
      continue;
    }

    const normalized = url.toString();
    urls.set(normalized, normalized);
  }

  return Array.from(urls.values());
}

function pickNextPageUrl(document: HtmlNode, pageUrl: string): string | null {
  const currentMonth = readArchiveMonthKey(pageUrl);
  const nextLink = findElements(document, (element) => {
    if (element.tagName !== "a") {
      return false;
    }

    const rel = (getAttribute(element, "rel") ?? "").split(/\s+/);
    return rel.includes("nofollow") && normalizeWhitespace(textContent(element)) === "More from Fresh Air";
  })[0];
  const href = nextLink ? getAttribute(nextLink, "href") : null;
  const nextUrl = href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;

  if (!nextUrl || !currentMonth) {
    return nextUrl;
  }

  return sameNprArchiveMonth(pageUrl, nextUrl) ? nextUrl : null;
}

function readArchiveMonthKey(candidate: string): string | null {
  const url = new URL(candidate);
  const date = url.searchParams.get("date");

  if (!date) {
    return null;
  }

  const match = date.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/) ?? date.match(/^(\d{1,2})-\d{1,2}-(\d{4})$/);

  if (!match) {
    return null;
  }

  if (match[1]?.length === 4) {
    return `${match[1]}-${match[2]?.padStart(2, "0")}`;
  }

  return `${match[2]}-${match[1]?.padStart(2, "0")}`;
}

function parseArchiveDate(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
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

function buildSummaryText(segments: ReturnType<typeof pickSegments>): string | null {
  if (segments.length === 0) {
    return null;
  }

  return segments.map((segment) => segment.title).join(" / ");
}

function buildContentHtml(
  url: string,
  title: string,
  episodeDate: string,
  segments: ReturnType<typeof pickSegments>
): string {
  const parts = [
    `<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`,
    `<p>Fresh Air episode date: ${escapeHtml(episodeDate)}</p>`
  ];

  if (segments.length > 0) {
    parts.push(
      `<ul>${segments
        .map((segment) => {
          const label = [
            segment.slug,
            segment.durationSeconds !== null ? formatDuration(segment.durationSeconds) : null
          ].filter((value): value is string => Boolean(value));
          const suffix = label.length > 0 ? ` (${escapeHtml(label.join(", "))})` : "";
          const titleHtml = segment.url
            ? `<a href="${escapeHtml(segment.url)}">${escapeHtml(segment.title)}</a>`
            : escapeHtml(segment.title);

          return `<li>${titleHtml}${suffix}</li>`;
        })
        .join("")}</ul>`
    );
  }

  return parts.join("");
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function readNprStoryId(url: string): string | null {
  const parts = new URL(url).pathname.split("/").filter(Boolean);

  return parts.find((part) => part.startsWith("nx-s")) ?? null;
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

function findAncestorWithClass(
  root: HtmlNode,
  target: HtmlNode,
  className: string
): HtmlElement | null {
  for (const child of childNodes(root)) {
    if (child === target) {
      return null;
    }

    const descendantMatch = findAncestorWithClass(child, target, className);

    if (descendantMatch) {
      return descendantMatch;
    }

    if (isElement(child) && hasClass(child, className) && containsNode(child, target)) {
      return child;
    }
  }

  return null;
}

function containsNode(root: HtmlNode, target: HtmlNode): boolean {
  if (root === target) {
    return true;
  }

  return childNodes(root).some((child) => containsNode(child, target));
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
