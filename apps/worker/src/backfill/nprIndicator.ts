import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey, parseFeedDocument } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

interface NprIndicatorAudioData {
  audioUrl?: unknown;
  duration?: unknown;
  program?: unknown;
  storyUrl?: unknown;
  title?: unknown;
  uid?: unknown;
}

export interface NprIndicatorArchivePage {
  episodeCount: number;
  items: NormalizedItem[];
  nextPageUrl: string | null;
}

const indicatorPodcastId = "510325";
const indicatorPodcastUrl =
  "https://www.npr.org/podcasts/510325/the-indicator-from-planet-money";
const indicatorFeedUrl = "https://feeds.npr.org/510325/podcast.xml";
const partialPageSize = 24;
const archiveResultLimit = 2_000;
const finalPageStart = archiveResultLimit - partialPageSize + 1;
const requestHeaders: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
};

export function resolveNprIndicatorPodcastUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (
    url.hostname === "feeds.npr.org" &&
    url.pathname === `/${indicatorPodcastId}/podcast.xml`
  ) {
    return new URL(indicatorPodcastUrl);
  }

  if (
    (url.hostname === "www.npr.org" || url.hostname === "npr.org") &&
    (
      url.pathname === `/podcasts/${indicatorPodcastId}/the-indicator-from-planet-money` ||
      url.pathname === `/podcasts/${indicatorPodcastId}/the-indicator-from-planet-money/`
    )
  ) {
    return new URL(indicatorPodcastUrl);
  }

  throw new Error(`Expected The Indicator NPR URL, got: ${candidate}`);
}

export function isNprIndicatorUrl(candidate: string): boolean {
  try {
    resolveNprIndicatorPodcastUrl(candidate);
    return true;
  } catch {
    return false;
  }
}

export function buildNprIndicatorPartialUrl(start: number): string {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new Error(`NPR Indicator start must be a positive integer, got: ${start}`);
  }

  const url = new URL(`${indicatorPodcastUrl}/partials`);
  url.searchParams.set("start", String(start));
  return url.toString();
}

export async function fetchNprIndicatorFeedItems(
  feedId: string,
  timeoutMs: number
): Promise<NormalizedItem[]> {
  const xml = await fetchNprDocument(indicatorFeedUrl, timeoutMs, "RSS feed");
  return parseFeedDocument(xml, feedId).items;
}

export async function fetchNprIndicatorArchivePage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<NprIndicatorArchivePage> {
  const html = await fetchNprDocument(url, timeoutMs, "archive page");
  return parseNprIndicatorArchivePage(html, url, feedId);
}

export function parseNprIndicatorArchivePage(
  html: string,
  pageUrl: string,
  feedId: string
): NprIndicatorArchivePage {
  const document = parse(html);
  const episodes = findElements(
    document,
    (element) =>
      element.tagName === "article" &&
      hasClass(element, "item") &&
      hasClass(element, "podcast-episode")
  );
  const items = episodes
    .map((episode) => parsePodcastEpisode(episode, pageUrl, feedId))
    .filter((item): item is NormalizedItem => item !== null);
  const start = readStartOffset(pageUrl);
  const nextStart =
    episodes.length === partialPageSize && start !== null && start < finalPageStart
      ? Math.min(start + partialPageSize, finalPageStart)
      : null;

  return {
    episodeCount: episodes.length,
    items,
    nextPageUrl: nextStart === null ? null : buildNprIndicatorPartialUrl(nextStart)
  };
}

export function mergeNprIndicatorRssItems(
  archiveItems: NormalizedItem[],
  rssItems: NormalizedItem[]
): NormalizedItem[] {
  const rssItemsByUrl = new Map(
    rssItems
      .filter((item): item is NormalizedItem & { url: string } => item.url !== null)
      .map((item) => [item.url, item])
  );

  return archiveItems.map((archiveItem) => {
    const rssItem = archiveItem.url ? rssItemsByUrl.get(archiveItem.url) : undefined;

    if (!rssItem) {
      return archiveItem;
    }

    return {
      ...rssItem,
      rawExtensionData: {
        ...rssItem.rawExtensionData,
        nprIndicator: archiveItem.rawExtensionData.nprIndicator
      }
    };
  });
}

async function fetchNprDocument(
  url: string,
  timeoutMs: number,
  kind: string
): Promise<string> {
  const startedAt = Date.now();
  let stage = "waiting_for_response_headers";

  console.log(`NPR Indicator ${kind} request started: url=${url} timeoutMs=${timeoutMs}`);

  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(timeoutMs)
    });

    console.log(
      `NPR Indicator ${kind} response headers received: url=${url} status=${response.status} contentLength=${response.headers.get("content-length") ?? "unknown"} contentType=${response.headers.get("content-type") ?? "unknown"} elapsedMs=${Date.now() - startedAt}`
    );

    if (!response.ok) {
      throw new Error(`NPR Indicator ${kind} request failed with HTTP ${response.status}.`);
    }

    stage = "downloading_response_body";
    const body = await response.text();

    console.log(
      `NPR Indicator ${kind} response body downloaded: url=${url} bytes=${Buffer.byteLength(body)} elapsedMs=${Date.now() - startedAt}`
    );

    return body;
  } catch (error) {
    throw new Error(
      `NPR Indicator ${kind} request failed: stage=${stage} url=${url} timeoutMs=${timeoutMs} elapsedMs=${Date.now() - startedAt} error=${formatRequestError(error)}`,
      { cause: error }
    );
  }
}

function parsePodcastEpisode(
  episode: HtmlElement,
  pageUrl: string,
  feedId: string
): NormalizedItem | null {
  const storyId = getAttribute(episode, "data-linked-story-id");
  const channelParentId = getAttribute(episode, "data-podcast-channel-parent-id");
  const primaryAudioId = getAttribute(episode, "data-primary-audio-id");
  const rawType = getAttribute(episode, "data-podcast-episode-raw-type");
  const derivedPlusType = getAttribute(
    episode,
    "data-podcast-episode-derived-plus-type"
  );
  const titleHeading = findElements(
    episode,
    (element) => element.tagName === "h2" && hasClass(element, "title")
  )[0];
  const titleLink = titleHeading
    ? findElements(titleHeading, (element) => element.tagName === "a")[0]
    : undefined;
  const title = titleLink ? normalizeWhitespace(textContent(titleLink)) : "";
  const href = titleLink ? getAttribute(titleLink, "href") : null;
  const url = href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;
  const dateElement = findElements(
    episode,
    (element) => element.tagName === "time" && getAttribute(element, "datetime") !== null
  )[0];
  const episodeDate = dateElement ? getAttribute(dateElement, "datetime") : null;
  const publishedAt = episodeDate ? parseArchiveDate(episodeDate) : null;
  const audioElement = findElements(
    episode,
    (element) => getAttribute(element, "data-audio") !== null
  )[0];
  const audio = readAudioData(audioElement ? getAttribute(audioElement, "data-audio") : null);

  if (
    !storyId ||
    channelParentId !== indicatorPodcastId ||
    !title ||
    !url ||
    !episodeDate
  ) {
    return null;
  }

  const teaser = findElements(
    episode,
    (element) => element.tagName === "p" && hasClass(element, "teaser")
  )[0];
  const summaryText = teaser
    ? normalizeWhitespace(textContentExcluding(teaser, (element) => element.tagName === "time")) || null
    : null;
  const imageElement = findElements(
    episode,
    (element) => element.tagName === "img" && findAncestorWithClass(episode, element, "item-image")
  )[0];
  const imageUrl = imageElement
    ? getAttribute(imageElement, "data-original") ?? getAttribute(imageElement, "src")
    : null;
  const transcriptLink = findElements(
    episode,
    (element) =>
      element.tagName === "a" &&
      hasClass(element, "audio-tool-transcript") &&
      getAttribute(element, "href") !== null
  )[0];
  const transcriptUrl = transcriptLink
    ? (resolveUrl(getAttribute(transcriptLink, "href") ?? "", pageUrl)?.toString() ?? null)
    : null;

  return {
    author: "NPR",
    contentHtml: buildContentHtml(summaryText, url, audio?.audioUrl ?? null, transcriptUrl),
    dedupeKey: buildDedupeKey(feedId, storyId, url, title, publishedAt),
    guid: storyId,
    publishedAt,
    rawExtensionData: {
      ...(audio?.audioUrl
        ? {
            enclosure: {
              "@_type": "audio/mpeg",
              "@_url": audio.audioUrl
            }
          }
        : {}),
      ...(audio?.durationSeconds !== null && audio?.durationSeconds !== undefined
        ? { "itunes:duration": String(audio.durationSeconds) }
        : {}),
      ...(imageUrl
        ? {
            "media:thumbnail": {
              "@_url": imageUrl
            }
          }
        : {}),
      nprIndicator: {
        audioTitle: audio?.title ?? null,
        audioUid: audio?.uid ?? null,
        backfilledFrom: pageUrl,
        channelParentId,
        derivedPlusType,
        durationSeconds: audio?.durationSeconds ?? null,
        imageUrl,
        primaryAudioId,
        program: audio?.program ?? null,
        rawType,
        storyId,
        transcriptUrl
      }
    },
    summaryText,
    title,
    url
  };
}

function readAudioData(raw: string | null): {
  audioUrl: string | null;
  durationSeconds: number | null;
  program: string | null;
  title: string | null;
  uid: string | null;
} | null {
  if (!raw) {
    return null;
  }

  let parsed: NprIndicatorAudioData;

  try {
    parsed = JSON.parse(raw) as NprIndicatorAudioData;
  } catch {
    return null;
  }

  return {
    audioUrl: typeof parsed.audioUrl === "string" ? parsed.audioUrl : null,
    durationSeconds: typeof parsed.duration === "number" ? parsed.duration : null,
    program: typeof parsed.program === "string" ? parsed.program : null,
    title: typeof parsed.title === "string" ? parsed.title : null,
    uid: typeof parsed.uid === "string" ? parsed.uid : null
  };
}

function buildContentHtml(
  summaryText: string | null,
  url: string,
  audioUrl: string | null,
  transcriptUrl: string | null
): string {
  const parts = summaryText ? [`<p>${escapeHtml(summaryText)}</p>`] : [];
  parts.push(`<p><a href="${escapeHtml(url)}">NPR episode page</a></p>`);

  if (audioUrl) {
    parts.push(`<p><a href="${escapeHtml(audioUrl)}">Listen to episode</a></p>`);
  }

  if (transcriptUrl) {
    parts.push(`<p><a href="${escapeHtml(transcriptUrl)}">Transcript</a></p>`);
  }

  return parts.join("");
}

function readStartOffset(pageUrl: string): number | null {
  const value = new URL(pageUrl).searchParams.get("start");
  const parsed = value ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
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

function findElements(
  root: HtmlNode,
  predicate: (element: HtmlElement) => boolean
): HtmlElement[] {
  const matches: HtmlElement[] = [];

  for (const child of childNodes(root)) {
    if (isElement(child) && predicate(child)) {
      matches.push(child);
    }

    matches.push(...findElements(child, predicate));
  }

  return matches;
}

function findAncestorWithClass(
  root: HtmlNode,
  target: HtmlNode,
  className: string
): boolean {
  for (const child of childNodes(root)) {
    if (isElement(child) && hasClass(child, className) && containsNode(child, target)) {
      return true;
    }

    if (findAncestorWithClass(child, target, className)) {
      return true;
    }
  }

  return false;
}

function containsNode(root: HtmlNode, target: HtmlNode): boolean {
  return root === target || childNodes(root).some((child) => containsNode(child, target));
}

function textContent(node: HtmlNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  return childNodes(node).map((child) => textContent(child)).join(" ");
}

function textContentExcluding(
  node: HtmlNode,
  exclude: (element: HtmlElement) => boolean
): string {
  if (isElement(node) && exclude(node)) {
    return "";
  }

  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  return childNodes(node)
    .map((child) => textContentExcluding(child, exclude))
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

function resolveUrl(href: string, baseUrl: string): URL | null {
  try {
    return new URL(href, baseUrl);
  } catch {
    return null;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
