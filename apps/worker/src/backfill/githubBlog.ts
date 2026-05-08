import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];

export interface GitHubBlogBackfillPage {
  items: NormalizedItem[];
  nextPageUrl: string | null;
  pageNumber: number;
  totalPages: number | null;
}

interface GitHubBlogPost {
  _embedded?: {
    "wp:featuredmedia"?: unknown[];
    "wp:term"?: unknown[][];
  };
  categories?: unknown;
  content?: {
    rendered?: unknown;
  };
  date_gmt?: unknown;
  excerpt?: {
    rendered?: unknown;
  };
  id?: unknown;
  link?: unknown;
  modified_gmt?: unknown;
  tags?: unknown;
  title?: {
    rendered?: unknown;
  };
  yoast_head_json?: {
    author?: unknown;
  };
}

interface GitHubBlogTerm {
  id?: unknown;
  link?: unknown;
  name?: unknown;
  slug?: unknown;
  taxonomy?: unknown;
}

interface GitHubBlogMedia {
  alt_text?: unknown;
  id?: unknown;
  media_details?: {
    height?: unknown;
    width?: unknown;
  };
  source_url?: unknown;
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchGitHubBlogBackfillPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<GitHubBlogBackfillPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`GitHub Blog backfill request failed with HTTP ${response.status}.`);
  }

  return parseGitHubBlogApiPage(
    await response.text(),
    url,
    feedId,
    parsePositiveInteger(response.headers.get("x-wp-totalpages"))
  );
}

export function parseGitHubBlogApiPage(
  json: string,
  pageUrl: string,
  feedId: string,
  totalPages: number | null = null
): GitHubBlogBackfillPage {
  const payload: unknown = JSON.parse(json);

  if (!Array.isArray(payload)) {
    throw new Error("GitHub Blog API response was not an array.");
  }

  const items = new Map<string, NormalizedItem>();

  for (const value of payload) {
    const item = normalizeGitHubBlogPost(value as GitHubBlogPost, pageUrl, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    }
  }

  const pageNumber = parsePageNumber(pageUrl);

  return {
    items: Array.from(items.values()),
    nextPageUrl: resolveNextPageUrl(pageUrl, pageNumber, totalPages, payload.length),
    pageNumber,
    totalPages
  };
}

export function buildGitHubBlogApiPageUrl(rootUrl: string, pageNumber: number): string {
  const root = resolveGitHubBlogRootUrl(rootUrl);
  const url = new URL("/wp-json/wp/v2/posts", root);

  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(pageNumber));
  url.searchParams.set("_embed", "wp:featuredmedia,wp:term");

  return url.toString();
}

export function resolveGitHubBlogRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname !== "github.blog" && url.hostname !== "www.github.blog") {
    throw new Error(`Expected a GitHub Blog URL, got: ${candidate}`);
  }

  return new URL("/", "https://github.blog");
}

function normalizeGitHubBlogPost(
  post: GitHubBlogPost,
  pageUrl: string,
  feedId: string
): NormalizedItem | null {
  const postId = typeof post.id === "number" ? post.id : null;
  const url = typeof post.link === "string" ? normalizeUrl(post.link) : null;
  const title = htmlToText(typeof post.title?.rendered === "string" ? post.title.rendered : "");

  if (!postId || !url || !title) {
    return null;
  }

  const guid = `https://github.blog/?p=${postId}`;
  const publishedAt = parseGmtDate(post.date_gmt);
  const modifiedAt = parseGmtDate(post.modified_gmt);
  const summaryText = htmlToText(typeof post.excerpt?.rendered === "string" ? post.excerpt.rendered : "");
  const contentHtml = typeof post.content?.rendered === "string"
    ? post.content.rendered
    : buildContentHtml(url, title, summaryText);
  const terms = pickTerms(post);
  const categories = terms
    .filter((term) => term.taxonomy === "category")
    .map((term) => term.name);
  const tags = terms
    .filter((term) => term.taxonomy === "post_tag")
    .map((term) => term.name);
  const authors = terms
    .filter((term) => term.taxonomy === "author")
    .map((term) => term.name);
  const yoastAuthor = typeof post.yoast_head_json?.author === "string"
    ? htmlToText(post.yoast_head_json.author)
    : "";
  const thumbnail = pickThumbnail(post);

  return {
    author: yoastAuthor || (authors.length > 0 ? authors.join(", ") : null),
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      githubBlog: {
        backfilledFrom: pageUrl,
        categories,
        modifiedAt,
        postId: String(postId),
        tags,
        thumbnail
      }
    },
    summaryText: summaryText || null,
    title,
    url
  };
}

function pickTerms(post: GitHubBlogPost): Array<{
  id: number;
  link: string | null;
  name: string;
  slug: string | null;
  taxonomy: string;
}> {
  const groups = post._embedded?.["wp:term"] ?? [];
  const terms = groups.flatMap((group) => group);

  return terms
    .map((term) => normalizeTerm(term as GitHubBlogTerm))
    .filter((term): term is NonNullable<ReturnType<typeof normalizeTerm>> => term !== null);
}

function normalizeTerm(term: GitHubBlogTerm): {
  id: number;
  link: string | null;
  name: string;
  slug: string | null;
  taxonomy: string;
} | null {
  const id = typeof term.id === "number" ? term.id : null;
  const name = typeof term.name === "string" ? htmlToText(term.name) : "";
  const taxonomy = typeof term.taxonomy === "string" ? term.taxonomy : "";

  if (!id || !name || !taxonomy) {
    return null;
  }

  return {
    id,
    link: typeof term.link === "string" ? normalizeUrl(term.link) : null,
    name,
    slug: typeof term.slug === "string" ? term.slug : null,
    taxonomy
  };
}

function pickThumbnail(post: GitHubBlogPost): {
  altText: string | null;
  height: number | null;
  id: string;
  url: string;
  width: number | null;
} | null {
  const media = post._embedded?.["wp:featuredmedia"]?.[0] as GitHubBlogMedia | undefined;
  const mediaId = typeof media?.id === "number" ? String(media.id) : null;
  const url = typeof media?.source_url === "string" ? normalizeUrl(media.source_url) : null;

  if (!mediaId || !url) {
    return null;
  }

  return {
    altText: typeof media?.alt_text === "string" ? htmlToText(media.alt_text) || null : null,
    height: typeof media?.media_details?.height === "number" ? media.media_details.height : null,
    id: mediaId,
    url,
    width: typeof media?.media_details?.width === "number" ? media.media_details.width : null
  };
}

function buildContentHtml(url: string, title: string, summaryText: string): string {
  const parts = [`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`];

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  return parts.join("");
}

function resolveNextPageUrl(
  pageUrl: string,
  pageNumber: number,
  totalPages: number | null,
  itemCount: number
): string | null {
  if (itemCount === 0) {
    return null;
  }

  if (totalPages !== null && pageNumber >= totalPages) {
    return null;
  }

  const nextUrl = new URL(pageUrl);
  nextUrl.searchParams.set("page", String(pageNumber + 1));
  return nextUrl.toString();
}

function parsePageNumber(pageUrl: string): number {
  const parsed = Number(new URL(pageUrl).searchParams.get("page") ?? "1");

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseGmtDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.replace(/\s+/g, "");
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
