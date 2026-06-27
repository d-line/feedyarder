import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey, parseFeedDocument } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface TwitEpisodeListPage {
  episodes: TwitEpisodeListEntry[];
  episodeUrls: string[];
  nextPageUrl: string | null;
  pageNumber: number;
  showId: string | null;
  totalPages: number | null;
}

export interface TwitEpisodeListEntry {
  dateText: string | null;
  episodeKey: string | null;
  episodeNumber: string | null;
  imageUrl: string | null;
  summaryText: string | null;
  title: string;
  url: string;
}

export interface TwitRssOverride {
  audioUrl: string | null;
  guid: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  summaryText: string | null;
}

const requestHeaders: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
};

const rssRequestHeaders: HeadersInit = {
  accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
};

export async function fetchTwitEpisodeListPage(
  url: string,
  timeoutMs: number
): Promise<TwitEpisodeListPage> {
  const response = await fetch(url, {
    headers: buildTwitHtmlHeaders(url),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Twit archive request failed with HTTP ${response.status}: ${url}`);
  }

  return parseTwitEpisodeListPage(await response.text(), url);
}

export async function fetchTwitEpisodeDetail(
  url: string,
  feedId: string,
  timeoutMs: number,
  rssOverrides: Map<string, TwitRssOverride> = new Map()
): Promise<NormalizedItem | null> {
  const response = await fetch(url, {
    headers: buildTwitHtmlHeaders(url),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404 || response.status === 418) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Twit episode request failed with HTTP ${response.status}: ${url}`);
  }

  return parseTwitEpisodeDetail(await response.text(), url, feedId, rssOverrides);
}

export async function fetchTwitRssOverrides(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<Map<string, TwitRssOverride>> {
  const response = await fetch(url, {
    headers: rssRequestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Twit RSS request failed with HTTP ${response.status}: ${url}`);
  }

  return parseTwitRssOverrides(await response.text(), feedId);
}

export async function fetchTwitRssSiteUrl(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<string | null> {
  const response = await fetch(url, {
    headers: rssRequestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Twit RSS request failed with HTTP ${response.status}: ${url}`);
  }

  return parseTwitRssSiteUrl(await response.text(), feedId);
}

export async function fetchTwitShowArchiveUrl(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: buildTwitHtmlHeaders(url),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Twit show page request failed with HTTP ${response.status}: ${url}`);
  }

  const archiveUrl = parseTwitShowArchiveUrl(await response.text(), url);

  if (!archiveUrl) {
    throw new Error(`Twit show page did not expose an all-episodes archive URL: ${url}`);
  }

  return archiveUrl;
}

function buildTwitHtmlHeaders(url: string): HeadersInit {
  const headers = new Headers(requestHeaders);

  headers.set("referer", resolveTwitReferer(url));

  return headers;
}

function resolveTwitReferer(url: string): string {
  try {
    const parsed = new URL(url);
    const showMatch = parsed.pathname.match(/^\/shows\/([^/]+)\/episodes\//);

    if (showMatch?.[1]) {
      return new URL(`/shows/${showMatch[1]}`, parsed).toString();
    }

    return new URL("/", parsed).toString();
  } catch {
    return "https://twit.tv/";
  }
}

function parseTwitEpisodeListEntry(episode: HtmlElement, pageUrl: string): TwitEpisodeListEntry | null {
  const link = findElements(episode, (element) => element.tagName === "a")[0];
  if (!link) {
    return null;
  }

  const href = getAttribute(link, "href");
  const url = href ? resolveUrl(href, pageUrl) : null;

  if (!url || !isTwitEpisodeUrl(url)) {
    return null;
  }

  url.search = "";
  url.hash = "";

  const canonicalUrl = url.toString();
  const episodeKey = readEpisodeKey(url);
  const episodeNumber = episodeKey && /^\d+[a-z]?$/i.test(episodeKey) ? episodeKey : null;
  const image = findElements(episode, (element) => element.tagName === "img")[0];
  const imageUrl = normalizeUrl(image ? getAttribute(image, "src") : null);
  const dateElement = findElements(episode, (element) => element.tagName === "span" && hasClass(element, "date"))[0];
  const dateText = dateElement ? normalizeWhitespace(textContent(dateElement)) : null;
  const lines = readNonEmptyTextLines(episode);
  const showTitle = lines.find((line) => !line.startsWith("#") && line !== dateText) ?? null;
  const dateLine = dateText ? lines.find((line) => line.startsWith(dateText)) : null;
  const subtitle = dateLine?.match(/\s-\s(.+)$/)?.[1] ?? null;
  const summaryText =
    lines.find((line) => line !== showTitle && !line.startsWith("#") && line !== dateLine && line !== dateText) ??
    normalizeWhitespace(getAttribute(link, "title") ?? "") ??
    null;
  const title =
    showTitle && episodeNumber
      ? `${showTitle} ${episodeNumber}${subtitle ? `: ${subtitle}` : ""}`
      : normalizeWhitespace(getAttribute(link, "title") ?? "") || canonicalUrl;

  return {
    dateText,
    episodeKey,
    episodeNumber,
    imageUrl,
    summaryText,
    title,
    url: canonicalUrl
  };
}

export function parseTwitEpisodeListPage(html: string, pageUrl: string): TwitEpisodeListPage {
  const document = parse(html);
  const episodes = new Map<string, TwitEpisodeListEntry>();

  for (const episode of findElements(
    document,
    (element) => element.tagName === "div" && hasClass(element, "episode") && hasClass(element, "item")
  )) {
    const entry = parseTwitEpisodeListEntry(episode, pageUrl);

    if (!entry) {
      continue;
    }

    episodes.set(entry.url, entry);
  }

  const entries = Array.from(episodes.values());

  return {
    episodes: entries,
    episodeUrls: entries.map((episode) => episode.url),
    nextPageUrl: pickNextPageUrl(document, pageUrl),
    pageNumber: parsePageNumber(pageUrl),
    showId: readShowId(new URL(pageUrl)),
    totalPages: pickTotalPages(document)
  };
}

export function parseTwitEpisodeDetail(
  html: string,
  pageUrl: string,
  feedId: string,
  rssOverrides: Map<string, TwitRssOverride> = new Map()
): NormalizedItem | null {
  const document = parse(html);
  const canonicalUrl = normalizeUrl(pickPropertyContent(document, "og:url") ?? pageUrl);
  const title = pickTitle(document) ?? pickPropertyContent(document, "og:title");

  if (!canonicalUrl || !title) {
    return null;
  }

  const rssOverride = rssOverrides.get(canonicalUrl);
  const audioUrl = pickMediaSource(document, "audio");
  const videoUrl = pickMediaSource(document, "video");
  const imageUrl = pickPropertyContent(document, "og:image");
  const summaryText =
    pickPropertyContent(document, "og:description") ??
    pickStructuredString(document, "description") ??
    pickEpisodeSummary(document);
  const publishedAt =
    rssOverride?.publishedAt ??
    parseDate(pickStructuredString(document, "uploadDate")) ??
    parseTwitDisplayDate(pickTextByClass(document, "air-date"));
  const guid = rssOverride?.guid ?? audioUrl ?? canonicalUrl;
  const show = pickBreadcrumbShow(document);
  const episodeKey = readEpisodeKey(new URL(canonicalUrl));
  const episodeNumber = parseEpisodeNumber(episodeKey, title);
  const hosts = pickPeopleByContainerClass(document, "hosts");
  const guests = pickPeopleByContainerClass(document, "guests");
  const transcriptUrl = pickTranscriptUrl(document, canonicalUrl);
  const duration = pickStructuredString(document, "duration");
  const contentHtml = buildContentHtml(canonicalUrl, title, summaryText, audioUrl, videoUrl, transcriptUrl);

  return {
    author: hosts.length > 0 ? hosts.join(", ") : null,
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, canonicalUrl, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      twit: {
        audioUrl,
        backfilledFrom: pageUrl,
        duration,
        episodeKey,
        episodeNumber,
        guests,
        hosts,
        imageUrl,
        show,
        transcriptUrl,
        usedRssGuid: Boolean(rssOverride?.guid),
        videoUrl
      }
    },
    summaryText,
    title,
    url: canonicalUrl
  };
}

export function normalizeTwitEpisodeListEntry(
  entry: TwitEpisodeListEntry,
  feedId: string,
  rssOverrides: Map<string, TwitRssOverride> = new Map()
): NormalizedItem {
  const rssOverride = rssOverrides.get(entry.url);
  const publishedAt = rssOverride?.publishedAt ?? parseTwitDisplayDate(entry.dateText);
  const guid = rssOverride?.guid ?? entry.url;
  const audioUrl = rssOverride?.audioUrl ?? null;
  const imageUrl = rssOverride?.imageUrl ?? entry.imageUrl;
  const summaryText = rssOverride?.summaryText ?? entry.summaryText;
  const contentHtml = buildContentHtml(entry.url, entry.title, summaryText, audioUrl, null, null);

  return {
    author: null,
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, entry.url, entry.title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      twit: {
        audioUrl,
        backfilledFrom: "archive-list",
        duration: null,
        episodeKey: entry.episodeKey,
        episodeNumber: entry.episodeNumber,
        guests: [],
        hosts: [],
        imageUrl,
        show: null,
        transcriptUrl: null,
        usedArchiveFallback: true,
        usedRssGuid: Boolean(rssOverride?.guid),
        videoUrl: null
      }
    },
    summaryText,
    title: entry.title,
    url: entry.url
  };
}

export function parseTwitRssOverrides(xml: string, feedId: string): Map<string, TwitRssOverride> {
  const feed = parseFeedDocument(xml, feedId);
  const overrides = new Map<string, TwitRssOverride>();

  for (const item of feed.items) {
    if (!item.url) {
      continue;
    }

    overrides.set(item.url, {
      audioUrl: pickRssEnclosureUrl(item.rawExtensionData.enclosure) ?? null,
      guid: item.guid,
      imageUrl: pickRssImageUrl(item.rawExtensionData),
      publishedAt: item.publishedAt,
      summaryText: item.summaryText
    });
  }

  return overrides;
}

export function parseTwitRssSiteUrl(xml: string, feedId: string): string | null {
  return parseFeedDocument(xml, feedId).siteUrl;
}

export function parseTwitShowArchiveUrl(html: string, pageUrl: string): string | null {
  const document = parse(html);

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");
    const url = href ? resolveUrl(href, pageUrl) : null;

    if (!url || !isTwitHost(url.hostname) || url.pathname !== "/episodes" || !readShowId(url)) {
      continue;
    }

    return normalizeTwitArchiveUrl(url).toString();
  }

  return null;
}

export function resolveTwitEpisodeArchiveUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (!isTwitHost(url.hostname)) {
    throw new Error(`Expected a Twit URL, got: ${candidate}`);
  }

  if (url.pathname === "/episodes" && readShowId(url)) {
    return normalizeTwitArchiveUrl(url);
  }

  throw new Error(`Expected a Twit episode archive URL with filter[shows], got: ${candidate}`);
}

export function isTwitUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return isTwitHost(url.hostname) || url.hostname === "feeds.twit.tv";
  } catch {
    return false;
  }
}

function normalizeTwitArchiveUrl(url: URL): URL {
  const normalized = new URL("/episodes", "https://twit.tv");
  const showId = readShowId(url);

  if (showId) {
    normalized.searchParams.set("filter[shows]", showId);
  }

  const page = url.searchParams.get("page");

  if (page && page !== "1") {
    normalized.searchParams.set("page", page);
  }

  return normalized;
}

function pickNextPageUrl(document: HtmlNode, pageUrl: string): string | null {
  const next = findElements(document, (element) => element.tagName === "a" && hasClass(element, "next"))[0];
  const href = next ? getAttribute(next, "href") : null;
  const url = href ? resolveUrl(href, pageUrl) : null;

  return url ? normalizeTwitArchiveUrl(url).toString() : null;
}

function pickTotalPages(document: HtmlNode): number | null {
  const input = findElements(
    document,
    (element) => element.tagName === "input" && hasClass(element, "page-number-input")
  )[0];
  const max = input ? getAttribute(input, "max") : null;

  return max && /^\d+$/.test(max) ? Number(max) : null;
}

function pickTitle(document: HtmlNode): string | null {
  const heading = findElements(document, (element) => element.tagName === "h1" && hasClass(element, "title"))[0];
  const subtitle = findElements(document, (element) => element.tagName === "h2" && hasClass(element, "subtitle"))[0];
  const title = heading ? normalizeWhitespace(textContent(heading)) : "";
  const subtitleText = subtitle ? normalizeWhitespace(textContent(subtitle)) : "";
  const combined = [title, subtitleText].filter(Boolean).join(": ");

  return combined || null;
}

function pickEpisodeSummary(document: HtmlNode): string | null {
  const overview = findElements(document, (element) => element.tagName === "div" && hasClass(element, "media-bd"))[0];
  const paragraph = overview ? findElements(overview, (element) => element.tagName === "p")[0] : null;
  const value = paragraph ? normalizeWhitespace(textContent(paragraph)) : "";

  return value || null;
}

function pickBreadcrumbShow(document: HtmlNode): { slug: string | null; title: string } | null {
  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");
    const match = href?.match(/^\/shows\/([^/?#]+)$/);
    const title = normalizeWhitespace(textContent(link));

    if (match?.[1] && title) {
      return {
        slug: match[1],
        title
      };
    }
  }

  return null;
}

function pickPeopleByContainerClass(document: HtmlNode, className: string): string[] {
  const container = findElements(
    document,
    (element) => element.tagName === "div" && hasClass(element, className)
  )[0];

  if (!container) {
    return [];
  }

  return findElements(container, (element) => element.tagName === "a")
    .map((link) => normalizeWhitespace(textContent(link)))
    .filter((value) => value.length > 0);
}

function pickMediaSource(document: HtmlNode, tagName: "audio" | "video"): string | null {
  const media = findElements(document, (element) => element.tagName === tagName)[0];
  const source = media ? findElements(media, (element) => element.tagName === "source")[0] : null;

  return normalizeUrl(source ? getAttribute(source, "src") : null);
}

function pickTranscriptUrl(document: HtmlNode, pageUrl: string): string | null {
  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const text = normalizeWhitespace(textContent(link)).toLowerCase();
    const href = getAttribute(link, "href");

    if (!text.includes("transcript") || !href) {
      continue;
    }

    return normalizeUrl(resolveUrl(href, pageUrl)?.toString() ?? null);
  }

  return null;
}

function pickTextByClass(document: HtmlNode, className: string): string | null {
  const element = findElements(document, (candidate) => hasClass(candidate, className))[0];
  const value = element ? normalizeWhitespace(textContent(element)) : "";

  return value || null;
}

function pickPropertyContent(document: HtmlNode, property: string): string | null {
  const meta = findElements(document, (element) => element.tagName === "meta")
    .find((element) => getAttribute(element, "property") === property);

  return meta ? getAttribute(meta, "content") : null;
}

function pickStructuredString(document: HtmlNode, field: string): string | null {
  for (const script of findElements(document, (element) => element.tagName === "script")) {
    if (getAttribute(script, "type") !== "application/ld+json") {
      continue;
    }

    const value = readStructuredField(textContent(script), field);

    if (value) {
      return value;
    }
  }

  return null;
}

function readStructuredField(json: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(json);
    const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    const value = record?.[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readShowId(url: URL): string | null {
  return url.searchParams.get("filter[shows]") ?? url.searchParams.get("filter%5Bshows%5D");
}

function readEpisodeKey(url: URL): string | null {
  const match = url.pathname.match(/\/episodes\/([^/?#]+)$/);

  return match?.[1] ?? null;
}

function parseEpisodeNumber(episodeKey: string | null, title: string): string | null {
  if (episodeKey && /^\d+[a-z]?$/i.test(episodeKey)) {
    return episodeKey;
  }

  const match = title.match(/\b(\d+[a-z]?)\b/i);

  return match?.[1] ?? null;
}

function parsePageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const page = url.searchParams.get("page");

  return page && /^\d+$/.test(page) ? Number(page) : 1;
}

function parseTwitDisplayDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(`${value.replace(/(\d+)(st|nd|rd|th)/, "$1")} 00:00:00 UTC`);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickRssEnclosureUrl(enclosure: unknown): string | null {
  const read = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const candidate = record["@_url"] ?? record.url;

    return typeof candidate === "string" ? normalizeUrl(candidate) : null;
  };

  if (Array.isArray(enclosure)) {
    for (const entry of enclosure) {
      const url = read(entry);

      if (url) {
        return url;
      }
    }

    return null;
  }

  return read(enclosure);
}

function pickRssImageUrl(rawExtensionData: Record<string, unknown>): string | null {
  for (const key of ["itunes:image", "media:thumbnail", "media:content"]) {
    const url = pickExtensionUrl(rawExtensionData[key]);

    if (url) {
      return url;
    }
  }

  return null;
}

function pickExtensionUrl(value: unknown): string | null {
  const read = (input: unknown): string | null => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return null;
    }

    const record = input as Record<string, unknown>;
    const candidate = record["@_href"] ?? record["@_url"] ?? record.href ?? record.url;

    return typeof candidate === "string" ? normalizeUrl(candidate) : null;
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = read(entry);

      if (url) {
        return url;
      }
    }

    return null;
  }

  return read(value);
}

function isTwitEpisodeUrl(url: URL): boolean {
  return isTwitHost(url.hostname) && /^\/shows\/[^/]+\/episodes\/[^/]+\/?$/.test(url.pathname);
}

function isTwitHost(hostname: string): boolean {
  return hostname === "twit.tv" || hostname === "www.twit.tv";
}

function buildContentHtml(
  url: string,
  title: string,
  summaryText: string | null,
  audioUrl: string | null,
  videoUrl: string | null,
  transcriptUrl: string | null
): string {
  const parts = [`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`];

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  if (audioUrl) {
    parts.push(`<p>Audio: <a href="${escapeHtml(audioUrl)}">${escapeHtml(audioUrl)}</a></p>`);
  }

  if (videoUrl) {
    parts.push(`<p>Video: <a href="${escapeHtml(videoUrl)}">${escapeHtml(videoUrl)}</a></p>`);
  }

  if (transcriptUrl) {
    parts.push(`<p>Transcript: <a href="${escapeHtml(transcriptUrl)}">${escapeHtml(transcriptUrl)}</a></p>`);
  }

  return parts.join("");
}

function findElements(node: HtmlNode, predicate: (element: HtmlElement) => boolean): HtmlElement[] {
  const results: HtmlElement[] = [];
  const visit = (current: HtmlNode): void => {
    if ("tagName" in current && predicate(current)) {
      results.push(current);
    }

    if ("childNodes" in current) {
      for (const child of current.childNodes) {
        visit(child);
      }
    }
  };

  visit(node);

  return results;
}

function hasClass(element: HtmlElement, className: string): boolean {
  return (getAttribute(element, "class") ?? "").split(/\s+/).includes(className);
}

function getAttribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function textContent(node: HtmlNode): string {
  if ("value" in node) {
    return node.value;
  }

  if (!("childNodes" in node)) {
    return "";
  }

  return node.childNodes.map((child) => textContent(child)).join("");
}

function readNonEmptyTextLines(node: HtmlNode): string[] {
  return textContent(node)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);
}

function resolveUrl(href: string, baseUrl: string): URL | null {
  try {
    return new URL(href, baseUrl);
  } catch {
    return null;
  }
}

function normalizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
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
