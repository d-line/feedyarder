import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

const tedTalksArchiveSearchUrl = "https://www.ted.com/api/search";
const tedTalksArchiveIndexName = "newest";
const tedTalksArchivePageSize = 24;
const maxRequestAttempts = 3;
const retryBaseDelayMs = 1_000;

const requestHeaders: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

const searchRequestHeaders: HeadersInit = {
  ...requestHeaders,
  "content-type": "application/json",
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export interface TedTalksArchivePage {
  hasNextPage: boolean;
  items: NormalizedItem[];
  nbHits: number | null;
  nbPages: number | null;
  pageNumber: number;
}

interface TedTalksSearchResult {
  hits?: unknown;
  nbHits?: unknown;
  nbPages?: unknown;
  page?: unknown;
}

interface TedTalksSearchHit {
  _index?: unknown;
  duration?: unknown;
  objectID?: unknown;
  photos?: unknown;
  slug?: unknown;
  speakers?: unknown;
  title?: unknown;
}

interface TedTalksThumbnail {
  aspectRatioName: string | null;
  aspectRatioId: number | null;
  height: number | null;
  url: string;
  width: number | null;
}

interface TedTalksDetailVideoData {
  canonicalUrl?: unknown;
  description?: unknown;
  duration?: unknown;
  hlsUrl?: unknown;
  id?: unknown;
  playerData?: unknown;
  primaryImageSet?: unknown;
  publishedAt?: unknown;
  recordedOn?: unknown;
  presenterDisplayName?: unknown;
  speakers?: unknown;
  title?: unknown;
  topics?: unknown;
}

export function isTedTalksHdFeed(candidate: string): boolean {
  try {
    const url = new URL(candidate);

    return (
      url.hostname.toLowerCase() === "feeds.feedburner.com" &&
      url.pathname.toLowerCase() === "/tedtalkshd"
    );
  } catch {
    return false;
  }
}

export function buildTedTalksArchiveSearchRequest(pageNumber: number): unknown[] {
  if (!Number.isInteger(pageNumber) || pageNumber < 0) {
    throw new Error(`TED Talks archive page must be a non-negative integer, got: ${pageNumber}`);
  }

  return [
    {
      indexName: tedTalksArchiveIndexName,
      params: {
        attributeForDistinct: "objectID",
        distinct: 1,
        facets: ["subtitle_languages", "tags"],
        highlightPostTag: "__/ais-highlight__",
        highlightPreTag: "__ais-highlight__",
        hitsPerPage: tedTalksArchivePageSize,
        maxValuesPerFacet: 500,
        page: pageNumber,
        query: ""
      }
    }
  ];
}

export async function fetchTedTalksArchivePage(
  pageNumber: number,
  feedId: string,
  timeoutMs: number
): Promise<TedTalksArchivePage> {
  const response = await fetchTedWithRetries(
    tedTalksArchiveSearchUrl,
    {
      body: JSON.stringify(buildTedTalksArchiveSearchRequest(pageNumber)),
      headers: searchRequestHeaders,
      method: "POST"
    },
    timeoutMs,
    "TED Talks archive"
  );

  return parseTedTalksArchiveSearchResponse(await response.text(), pageNumber, feedId);
}

export async function fetchTedTalkDetailItem(
  archiveItem: NormalizedItem,
  feedId: string,
  timeoutMs: number
): Promise<NormalizedItem | null> {
  if (!archiveItem.url) {
    return null;
  }

  const response = await fetchTedWithRetries(
    archiveItem.url,
    {
      headers: requestHeaders
    },
    timeoutMs,
    "TED Talks detail",
    new Set([404])
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TED Talks detail request failed with HTTP ${response.status}: ${archiveItem.url}`);
  }

  return parseTedTalkDetailPage(await response.text(), archiveItem.url, archiveItem, feedId);
}

async function fetchTedWithRetries(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  allowedStatuses = new Set<number>()
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRequestAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok || allowedStatuses.has(response.status)) {
        return response;
      }

      const error = new Error(`${label} request failed with HTTP ${response.status}.`);

      if (!isRetryableStatus(response.status) || attempt === maxRequestAttempts) {
        throw error;
      }

      await waitBeforeRetry(url, label, attempt, error.message);
    } catch (error) {
      if (attempt === maxRequestAttempts || isNonRetryableHttpError(error, label)) {
        throw error;
      }

      await waitBeforeRetry(url, label, attempt, formatError(error));
    }
  }

  throw new Error(`${label} request exhausted its retry attempts.`);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isNonRetryableHttpError(error: unknown, label: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedLabel} request failed with HTTP (\\d+)\\.$`).exec(error.message);

  return match ? !isRetryableStatus(Number(match[1])) : false;
}

async function waitBeforeRetry(
  url: string,
  label: string,
  attempt: number,
  reason: string
): Promise<void> {
  const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
  console.warn(
    `${label} request retrying: url=${url} attempt=${attempt + 1}/${maxRequestAttempts} delayMs=${delayMs} reason=${reason}`
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseTedTalksArchiveSearchResponse(
  json: string,
  requestedPageNumber: number,
  feedId: string
): TedTalksArchivePage {
  const result = readFirstSearchResult(JSON.parse(json));
  const hits = Array.isArray(result.hits) ? result.hits : [];
  const items = new Map<string, NormalizedItem>();

  for (const hit of hits) {
    const item = normalizeTedTalksSearchHit(hit as TedTalksSearchHit, requestedPageNumber, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  const nbHits = parseNonNegativeInteger(result.nbHits);
  const nbPages = parseNonNegativeInteger(result.nbPages);
  const pageNumber = parseNonNegativeInteger(result.page) ?? requestedPageNumber;

  return {
    hasNextPage:
      hits.length > 0 &&
      (nbPages === null ? hits.length >= tedTalksArchivePageSize : pageNumber + 1 < nbPages),
    items: Array.from(items.values()),
    nbHits,
    nbPages,
    pageNumber
  };
}

function normalizeTedTalksSearchHit(
  hit: TedTalksSearchHit,
  pageNumber: number,
  feedId: string
): NormalizedItem | null {
  const objectId = readId(hit.objectID);
  const slug = readNonEmptyString(hit.slug);
  const title = readNonEmptyString(hit.title);

  if (!objectId || !slug || !title) {
    return null;
  }

  const url = buildTedTalkUrl(slug);
  const speakers = readNonEmptyString(hit.speakers);
  const durationSeconds = parseNonNegativeNumber(hit.duration);
  const thumbnail = pickThumbnail(hit.photos);
  const guid = `ted:video:${objectId}`;
  const publishedAt = null;

  return {
    author: speakers,
    contentHtml: buildContentHtml({
      description: null,
      durationSeconds,
      recordedOn: null,
      speakers,
      thumbnail,
      title,
      topics: [],
      url
    }),
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      ted: {
        backfilledFrom: tedTalksArchiveSearchUrl,
        detailFetched: false,
        durationSeconds,
        objectId,
        pageNumber,
        slug,
        sortIndex: tedTalksArchiveIndexName,
        sourceIndex: readNonEmptyString(hit._index),
        speakers,
        thumbnail
      }
    },
    summaryText: speakers ? `TED talk by ${speakers}.` : null,
    title,
    url
  };
}

export function parseTedTalkDetailPage(
  html: string,
  pageUrl: string,
  archiveItem: NormalizedItem,
  feedId: string
): NormalizedItem | null {
  const videoData = readTedTalkDetailVideoData(html);

  if (!videoData) {
    return null;
  }

  const archiveData = readTedArchiveData(archiveItem);
  const title = readNonEmptyString(videoData.title) ?? archiveItem.title;
  const canonicalUrl = normalizeUrl(readNonEmptyString(videoData.canonicalUrl)) ?? archiveItem.url;

  if (!title || !canonicalUrl) {
    return null;
  }

  const talkId = readId(videoData.id);
  const mediaId = readId(readJsonObject(videoData.playerData)?.id) ?? archiveData.objectId;
  const speakers =
    readNonEmptyString(videoData.presenterDisplayName) ??
    readDetailSpeakers(videoData.speakers) ??
    archiveItem.author;
  const description = readNonEmptyString(videoData.description) ?? archiveItem.summaryText;
  const durationSeconds = parseNonNegativeNumber(videoData.duration) ?? archiveData.durationSeconds;
  const publishedAt = parseDate(videoData.publishedAt);
  const recordedOn = readNonEmptyString(videoData.recordedOn);
  const topics = readTopics(videoData.topics);
  const thumbnail = pickDetailThumbnail(videoData.primaryImageSet) ?? archiveData.thumbnail;
  const guid = talkId ? `en.hd.talk.ted.com:${talkId}` : archiveItem.guid;

  return {
    author: speakers,
    contentHtml: buildContentHtml({
      description,
      durationSeconds,
      recordedOn,
      speakers,
      thumbnail,
      title,
      topics,
      url: canonicalUrl
    }),
    dedupeKey: buildDedupeKey(feedId, guid, canonicalUrl, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      ted: {
        backfilledFrom: archiveData.backfilledFrom ?? tedTalksArchiveSearchUrl,
        detailFetched: true,
        detailUrl: pageUrl,
        durationSeconds,
        hlsUrl: normalizeUrl(readNonEmptyString(videoData.hlsUrl)),
        mediaId,
        objectId: archiveData.objectId,
        pageNumber: archiveData.pageNumber,
        recordedOn,
        slug: archiveData.slug,
        sortIndex: archiveData.sortIndex,
        sourceIndex: archiveData.sourceIndex,
        speakers,
        talkId,
        thumbnail,
        topics
      }
    },
    summaryText: description,
    title,
    url: canonicalUrl
  };
}

function readFirstSearchResult(payload: unknown): TedTalksSearchResult {
  if (!payload || typeof payload !== "object" || !("results" in payload)) {
    throw new Error("TED Talks archive response did not contain results.");
  }

  const results = payload.results;

  if (!Array.isArray(results)) {
    throw new Error("TED Talks archive response results were not an array.");
  }

  const firstResult = results[0];

  if (!firstResult || typeof firstResult !== "object") {
    throw new Error("TED Talks archive response did not contain a search result.");
  }

  return firstResult as TedTalksSearchResult;
}

function buildTedTalkUrl(slug: string): string {
  return new URL(
    `/talks/${slug.replace(/^\/+/, "").replace(/^talks\//, "")}`,
    "https://www.ted.com"
  ).toString();
}

function pickThumbnail(photos: unknown): TedTalksThumbnail | null {
  if (!Array.isArray(photos)) {
    return null;
  }

  const sizes = photos
    .flatMap((photo) => {
      if (!photo || typeof photo !== "object" || !("photo_sizes" in photo)) {
        return [];
      }

      return Array.isArray(photo.photo_sizes) ? photo.photo_sizes : [];
    })
    .map((size) => normalizePhotoSize(size))
    .filter((size): size is TedTalksThumbnail => size !== null);

  const sorted = sizes.toSorted((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const preferred = sorted.find((size) => size.aspectRatioId === 2);

  return preferred ?? sorted[0] ?? null;
}

function normalizePhotoSize(value: unknown): TedTalksThumbnail | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const url = "url" in value ? normalizeUrl(readNonEmptyString(value.url)) : null;

  if (!url) {
    return null;
  }

  return {
    aspectRatioName: null,
    aspectRatioId:
      "talkstar_aspect_ratio_id" in value
        ? parseNonNegativeInteger(value.talkstar_aspect_ratio_id)
        : null,
    height: "height" in value ? parseNonNegativeInteger(value.height) : null,
    url,
    width: "width" in value ? parseNonNegativeInteger(value.width) : null
  };
}

function pickDetailThumbnail(value: unknown): TedTalksThumbnail | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const sizes = value
    .map((entry): TedTalksThumbnail | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const url = "url" in entry ? normalizeUrl(readNonEmptyString(entry.url)) : null;

      if (!url) {
        return null;
      }

      return {
        aspectRatioId: null,
        aspectRatioName: "aspectRatioName" in entry ? readNonEmptyString(entry.aspectRatioName) : null,
        height: null,
        url,
        width: null
      };
    })
    .filter((entry): entry is TedTalksThumbnail => entry !== null);

  const preferred = sizes.find((size) => size.aspectRatioName === "16x9");

  return preferred ?? sizes[0] ?? null;
}

function buildContentHtml(input: {
  description: string | null;
  durationSeconds: number | null;
  recordedOn: string | null;
  speakers: string | null;
  thumbnail: TedTalksThumbnail | null;
  title: string;
  topics: string[];
  url: string;
}): string {
  const parts = [
    `<p><a href="${escapeHtml(input.url)}">${escapeHtml(input.title)}</a></p>`
  ];

  if (input.description) {
    parts.push(`<p>${escapeHtml(input.description)}</p>`);
  }

  const metadata = [
    input.speakers ? `Speaker: ${input.speakers}` : null,
    input.durationSeconds !== null ? `Duration: ${formatDuration(input.durationSeconds)}` : null,
    input.recordedOn ? `Recorded: ${input.recordedOn}` : null,
    input.topics.length > 0 ? `Topics: ${input.topics.join(", ")}` : null
  ].filter((part): part is string => Boolean(part));

  if (metadata.length > 0) {
    parts.push(`<p>${escapeHtml(metadata.join(" | "))}</p>`);
  }

  if (input.thumbnail) {
    parts.push(`<p><img src="${escapeHtml(input.thumbnail.url)}" alt="${escapeHtml(input.title)}"></p>`);
  }

  return parts.join("");
}

function formatDuration(totalSeconds: number): string {
  const roundedSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readTedTalkDetailVideoData(html: string): TedTalksDetailVideoData | null {
  const document = parse(html);
  const nextDataScript = findElements(
    document,
    (element) => element.tagName === "script" && getAttribute(element, "id") === "__NEXT_DATA__"
  )[0];
  const json = nextDataScript ? textContent(nextDataScript).trim() : null;

  if (!json) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  const props = readObject(payload)?.props;
  const pageProps = readObject(props)?.pageProps;
  const videoData = readObject(pageProps)?.videoData;

  return readObject(videoData) as TedTalksDetailVideoData | null;
}

function readTedArchiveData(item: NormalizedItem): {
  backfilledFrom: string | null;
  durationSeconds: number | null;
  objectId: string | null;
  pageNumber: number | null;
  slug: string | null;
  sortIndex: string | null;
  sourceIndex: string | null;
  thumbnail: TedTalksThumbnail | null;
} {
  const ted = readObject(item.rawExtensionData.ted);

  return {
    backfilledFrom: readNonEmptyString(ted?.backfilledFrom),
    durationSeconds: parseNonNegativeNumber(ted?.durationSeconds),
    objectId: readId(ted?.objectId),
    pageNumber: parseNonNegativeInteger(ted?.pageNumber),
    slug: readNonEmptyString(ted?.slug),
    sortIndex: readNonEmptyString(ted?.sortIndex),
    sourceIndex: readNonEmptyString(ted?.sourceIndex),
    thumbnail: normalizeThumbnailObject(ted?.thumbnail)
  };
}

function normalizeThumbnailObject(value: unknown): TedTalksThumbnail | null {
  const thumbnail = readObject(value);
  const url = normalizeUrl(readNonEmptyString(thumbnail?.url));

  if (!url) {
    return null;
  }

  return {
    aspectRatioId: parseNonNegativeInteger(thumbnail?.aspectRatioId),
    aspectRatioName: readNonEmptyString(thumbnail?.aspectRatioName),
    height: parseNonNegativeInteger(thumbnail?.height),
    url,
    width: parseNonNegativeInteger(thumbnail?.width)
  };
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  const object = readObject(value);

  if (object) {
    return object;
  }

  const json = readNonEmptyString(value);

  if (!json) {
    return null;
  }

  try {
    return readObject(JSON.parse(json));
  } catch {
    return null;
  }
}

function readTopics(value: unknown): string[] {
  const nodes = readObject(value)?.nodes;

  if (!Array.isArray(nodes)) {
    return [];
  }

  return Array.from(
    new Set(
      nodes
        .map((node) => readNonEmptyString(readObject(node)?.name))
        .filter((topic): topic is string => topic !== null)
    )
  );
}

function readDetailSpeakers(value: unknown): string | null {
  const nodes = readObject(value)?.nodes;

  if (!Array.isArray(nodes)) {
    return null;
  }

  const speakers = nodes
    .map((node) => {
      const speaker = readObject(node);

      if (!speaker) {
        return null;
      }

      const explicitName = readNonEmptyString(speaker.name);

      if (explicitName) {
        return explicitName;
      }

      const nameParts = [
        readNonEmptyString(speaker.firstname),
        readNonEmptyString(speaker.middlename),
        readNonEmptyString(speaker.lastname)
      ].filter((part): part is string => part !== null);

      return nameParts.length > 0 ? nameParts.join(" ") : null;
    })
    .filter((speaker): speaker is string => speaker !== null);

  return speakers.length > 0 ? speakers.join(", ") : null;
}

function parseDate(value: unknown): string | null {
  const text = readNonEmptyString(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readId(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeWhitespace(value) || null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value);
  }

  return null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" ? normalizeWhitespace(value) || null : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
