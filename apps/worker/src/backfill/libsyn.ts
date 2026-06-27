import { buildDedupeKey, parseFeedDocument } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

export interface LibsynArchivePage {
  items: NormalizedItem[];
  nextPageUrl: string | null;
  pageNumber: number;
  showId: string | null;
  title: string | null;
}

export interface LibsynRssOverride {
  guid: string | null;
  publishedAt: string | null;
}

interface LibsynPageData {
  destination_id?: unknown;
  items?: unknown;
  show?: {
    author?: unknown;
    show_id?: unknown;
    title?: unknown;
  };
}

interface LibsynPageItem {
  full_item_url?: unknown;
  image_url?: unknown;
  item_body?: unknown;
  item_body_clean?: unknown;
  item_id?: unknown;
  item_slug?: unknown;
  item_title?: unknown;
  premium_state?: unknown;
  primary_content?: {
    content_title?: unknown;
    content_type?: unknown;
    file_class?: unknown;
    url?: unknown;
    url_secure?: unknown;
  };
  release_date?: unknown;
}

const flossWeeklyArchiveUrl = "https://flossweekly.libsyn.com/";
const flossWeeklyFeedUrl = "https://feeds.libsyn.com/499093/rss";
const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchLibsynArchivePage(
  url: string,
  feedId: string,
  timeoutMs: number,
  rssOverrides: Map<string, LibsynRssOverride> = new Map()
): Promise<LibsynArchivePage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Libsyn archive request failed with HTTP ${response.status}.`);
  }

  return parseLibsynArchivePage(await response.text(), url, feedId, rssOverrides);
}

export async function fetchLibsynRssOverrides(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<Map<string, LibsynRssOverride>> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Libsyn RSS request failed with HTTP ${response.status}.`);
  }

  return parseLibsynRssOverrides(await response.text(), feedId);
}

export function parseLibsynArchivePage(
  html: string,
  pageUrl: string,
  feedId: string,
  rssOverrides: Map<string, LibsynRssOverride> = new Map()
): LibsynArchivePage {
  const data = parsePageData(html);
  const pageNumber = parsePageNumber(pageUrl);
  const items = new Map<string, NormalizedItem>();

  for (const value of Array.isArray(data.items) ? data.items : []) {
    const item = normalizeLibsynItem(value as LibsynPageItem, data, pageUrl, feedId, rssOverrides);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  const normalizedItems = Array.from(items.values());

  return {
    items: normalizedItems,
    nextPageUrl: normalizedItems.length > 0 ? buildArchivePageUrl(pageUrl, pageNumber + 1) : null,
    pageNumber,
    showId: readId(data.show?.show_id),
    title: readString(data.show?.title)
  };
}

export function parseLibsynRssOverrides(xml: string, feedId: string): Map<string, LibsynRssOverride> {
  const feed = parseFeedDocument(xml, feedId);
  const overrides = new Map<string, LibsynRssOverride>();

  for (const item of feed.items) {
    const itemId = readExtensionString(item.rawExtensionData["libsyn:item-id"]);

    if (!itemId || !hasEnclosure(item.rawExtensionData.enclosure)) {
      continue;
    }

    overrides.set(itemId, {
      guid: item.guid,
      publishedAt: item.publishedAt
    });
  }

  return overrides;
}

export function resolveFlossWeeklyLibsynArchiveUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname === "flossweekly.libsyn.com") {
    return new URL("/", flossWeeklyArchiveUrl);
  }

  if (
    (url.hostname === "feeds.libsyn.com" && url.pathname === "/499093/rss") ||
    (url.hostname === "rss.libsyn.com" && url.pathname === "/shows/499093/destinations/4272468.xml")
  ) {
    return new URL("/", flossWeeklyArchiveUrl);
  }

  throw new Error(`Expected the FLOSS Weekly Libsyn archive or feed URL, got: ${candidate}`);
}

export function resolveFlossWeeklyLibsynFeedUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname === "flossweekly.libsyn.com") {
    return new URL(flossWeeklyFeedUrl);
  }

  if (
    (url.hostname === "feeds.libsyn.com" && url.pathname === "/499093/rss") ||
    (url.hostname === "rss.libsyn.com" && url.pathname === "/shows/499093/destinations/4272468.xml")
  ) {
    return url;
  }

  throw new Error(`Expected the FLOSS Weekly Libsyn archive or feed URL, got: ${candidate}`);
}

export function isFlossWeeklyLibsynUrl(candidate: string): boolean {
  try {
    resolveFlossWeeklyLibsynArchiveUrl(candidate);
    return true;
  } catch {
    return false;
  }
}

function normalizeLibsynItem(
  item: LibsynPageItem,
  data: LibsynPageData,
  pageUrl: string,
  feedId: string,
  rssOverrides: Map<string, LibsynRssOverride>
): NormalizedItem | null {
  const itemId = readId(item.item_id);
  const title = readString(item.item_title);
  const url = normalizeUrl(readString(item.full_item_url));

  if (!itemId || !title || !url) {
    return null;
  }

  const rssOverride = rssOverrides.get(itemId);
  const guid = rssOverride?.guid ?? `libsyn:item:${itemId}`;
  const publishedAt = rssOverride?.publishedAt ?? parseReleaseDate(readString(item.release_date));
  const summaryText = readString(item.item_body_clean);
  const contentHtml = readString(item.item_body) ?? buildContentHtml(url, title, summaryText);
  const audio = normalizePrimaryContent(item.primary_content);
  const showId = readId(data.show?.show_id);
  const destinationId = readId(data.destination_id);

  return {
    author: readString(data.show?.author),
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      libsyn: {
        audio,
        backfilledFrom: pageUrl,
        destinationId,
        imageUrl: normalizeUrl(readString(item.image_url)),
        itemId,
        premiumState: readString(item.premium_state),
        releaseDate: readString(item.release_date),
        showId,
        slug: readString(item.item_slug),
        usedRssGuid: Boolean(rssOverride?.guid)
      }
    },
    summaryText,
    title,
    url
  };
}

function parsePageData(html: string): LibsynPageData {
  const match = html.match(/window\.PAGE_DATA\s*=\s*(\{.*?\});\s*<\/script>/s);

  if (!match?.[1]) {
    throw new Error("Libsyn archive page did not include window.PAGE_DATA.");
  }

  const parsed: unknown = JSON.parse(match[1]);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Libsyn PAGE_DATA was not an object.");
  }

  return parsed as LibsynPageData;
}

function normalizePrimaryContent(content: LibsynPageItem["primary_content"]): {
  contentTitle: string | null;
  contentType: string | null;
  fileClass: string | null;
  url: string | null;
} | null {
  if (!content || typeof content !== "object") {
    return null;
  }

  const url = normalizeUrl(readString(content.url_secure) ?? readString(content.url));

  if (!url) {
    return null;
  }

  return {
    contentTitle: readString(content.content_title),
    contentType: readString(content.content_type),
    fileClass: readString(content.file_class),
    url
  };
}

function buildArchivePageUrl(pageUrl: string, pageNumber: number): string {
  const root = resolveFlossWeeklyLibsynArchiveUrl(pageUrl);

  if (pageNumber <= 1) {
    return root.toString();
  }

  return new URL(`/page/${pageNumber}`, root).toString();
}

function parsePageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const match = url.pathname.match(/^\/page\/(\d+)\/?$/);

  return match?.[1] ? Number(match[1]) : 1;
}

function parseReleaseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(`${value} 00:00:00 UTC`);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildContentHtml(url: string, title: string, summaryText: string | null): string {
  const parts = [`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`];

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  return parts.join("");
}

function hasEnclosure(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasEnclosure(entry));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const url = readExtensionString(record["@_url"] ?? record.url);

  return Boolean(url);
}

function readExtensionString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value) {
    return readExtensionString((value as Record<string, unknown>)["#text"]);
  }

  if (value && typeof value === "object" && "__cdata" in value) {
    return readExtensionString((value as Record<string, unknown>).__cdata);
  }

  return null;
}

function readId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }

  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
