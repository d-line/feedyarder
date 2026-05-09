import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];

export interface SubstackArchivePage {
  nextPageUrl: string | null;
  offset: number;
  pageNumber: number;
  posts: SubstackPost[];
}

export interface SubstackPost {
  audience?: unknown;
  body_html?: unknown;
  canonical_url?: unknown;
  cover_image?: unknown;
  description?: unknown;
  id?: unknown;
  podcast_duration?: unknown;
  podcast_url?: unknown;
  post_date?: unknown;
  publishedBylines?: unknown;
  reactions?: unknown;
  restacks?: unknown;
  slug?: unknown;
  subtitle?: unknown;
  title?: unknown;
  truncated_body_text?: unknown;
  type?: unknown;
  videoUpload?: unknown;
}

const archivePageSize = 50;
const knownSubstackCustomHosts = new Set(["blog.bytebytego.com"]);

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchSubstackArchivePage(
  url: string,
  timeoutMs: number
): Promise<SubstackArchivePage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Substack archive request failed with HTTP ${response.status}.`);
  }

  return parseSubstackArchivePage(await response.text(), url);
}

export async function fetchSubstackPostDetail(
  rootUrl: string,
  slug: string,
  timeoutMs: number
): Promise<SubstackPost | null> {
  const url = new URL(`/api/v1/posts/${encodeURIComponent(slug)}`, resolveSubstackRootUrl(rootUrl));
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Substack post detail request failed with HTTP ${response.status}.`);
  }

  return parseSubstackPost(await response.text());
}

export function parseSubstackArchivePage(json: string, pageUrl: string): SubstackArchivePage {
  const payload: unknown = JSON.parse(json);

  if (!Array.isArray(payload)) {
    throw new Error("Substack archive response was not an array.");
  }

  const offset = parseOffset(pageUrl);
  const limit = parseLimit(pageUrl);

  return {
    nextPageUrl: payload.length > 0 ? buildSubstackArchiveApiUrl(pageUrl, offset + payload.length, limit) : null,
    offset,
    pageNumber: Math.floor(offset / limit) + 1,
    posts: payload as SubstackPost[]
  };
}

export function parseSubstackPost(json: string): SubstackPost {
  const payload: unknown = JSON.parse(json);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Substack post detail response was not an object.");
  }

  return payload as SubstackPost;
}

export function normalizeSubstackPost(
  post: SubstackPost,
  feedId: string,
  sourcePageUrl: string,
  detailFetched: boolean
): NormalizedItem | null {
  const postId = typeof post.id === "number" ? String(post.id) : null;
  const slug = typeof post.slug === "string" ? post.slug : null;
  const url = typeof post.canonical_url === "string" ? normalizeUrl(post.canonical_url) : null;
  const title = typeof post.title === "string" ? htmlToText(post.title) : "";

  if (!postId || !slug || !url || !title) {
    return null;
  }

  const publishedAt = parseDate(post.post_date);
  const summaryText = pickSummaryText(post);
  const contentHtml = typeof post.body_html === "string" && post.body_html.trim().length > 0
    ? post.body_html
    : buildContentHtml(url, title, summaryText);
  const author = pickAuthors(post);
  const media = pickMedia(post);

  return {
    author,
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, url, url, title, publishedAt),
    guid: url,
    publishedAt,
    rawExtensionData: {
      substack: {
        audience: typeof post.audience === "string" ? post.audience : null,
        backfilledFrom: sourcePageUrl,
        detailFetched,
        media,
        postId,
        reactions: readRecord(post.reactions),
        restacks: typeof post.restacks === "number" ? post.restacks : null,
        slug,
        type: typeof post.type === "string" ? post.type : null
      }
    },
    summaryText,
    title,
    url
  };
}

export function buildSubstackArchiveApiUrl(
  rootUrl: string,
  offset = 0,
  limit = archivePageSize
): string {
  const url = new URL("/api/v1/archive", resolveSubstackRootUrl(rootUrl));

  url.searchParams.set("sort", "new");
  url.searchParams.set("search", "");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));

  return url.toString();
}

export function resolveSubstackRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (!isSupportedSubstackHost(url.hostname)) {
    throw new Error(`Expected a Substack publication URL, got: ${candidate}`);
  }

  return new URL("/", url);
}

export function isSupportedSubstackHost(hostname: string): boolean {
  return hostname.endsWith(".substack.com") || knownSubstackCustomHosts.has(hostname);
}

function pickSummaryText(post: SubstackPost): string | null {
  for (const value of [post.description, post.subtitle, post.truncated_body_text]) {
    if (typeof value !== "string") {
      continue;
    }

    const text = htmlToText(value);

    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function pickAuthors(post: SubstackPost): string | null {
  if (!Array.isArray(post.publishedBylines)) {
    return null;
  }

  const authors = post.publishedBylines
    .map((byline) => {
      if (!byline || typeof byline !== "object" || !("name" in byline)) {
        return null;
      }

      const name = (byline as { name?: unknown }).name;
      return typeof name === "string" ? htmlToText(name) : null;
    })
    .filter((name): name is string => Boolean(name));

  return authors.length > 0 ? Array.from(new Set(authors)).join(", ") : null;
}

function pickMedia(post: SubstackPost): {
  coverImage: string | null;
  podcastDuration: number | null;
  podcastUrl: string | null;
  videoDuration: number | null;
  videoUploadId: string | null;
} {
  const videoUpload = post.videoUpload && typeof post.videoUpload === "object"
    ? post.videoUpload as { duration?: unknown; id?: unknown }
    : null;

  return {
    coverImage: typeof post.cover_image === "string" ? normalizeUrl(post.cover_image) : null,
    podcastDuration: typeof post.podcast_duration === "number" ? post.podcast_duration : null,
    podcastUrl: typeof post.podcast_url === "string" ? normalizeUrl(post.podcast_url) : null,
    videoDuration: typeof videoUpload?.duration === "number" ? videoUpload.duration : null,
    videoUploadId: typeof videoUpload?.id === "string" ? videoUpload.id : null
  };
}

function buildContentHtml(url: string, title: string, summaryText: string | null): string {
  const parts = [`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`];

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  return parts.join("");
}

function parseOffset(pageUrl: string): number {
  const offset = Number(new URL(pageUrl).searchParams.get("offset") ?? "0");

  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function parseLimit(pageUrl: string): number {
  const limit = Number(new URL(pageUrl).searchParams.get("limit") ?? String(archivePageSize));

  return Number.isInteger(limit) && limit > 0 ? limit : archivePageSize;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function htmlToText(value: string): string {
  return normalizeWhitespace(textContent(parseFragment(value)));
}

function textContent(node: HtmlNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  return childNodes(node)
    .map((child) => textContent(child))
    .join(" ");
}

function childNodes(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
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
