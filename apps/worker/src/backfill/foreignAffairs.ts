import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface ForeignAffairsTaxonomy {
  slug: string;
  title: string;
  type: "tag" | "topic";
  url: string;
}

export interface ForeignAffairsTaxonomyPage {
  articleUrls: string[];
  nextPageUrl: string | null;
  pageNumber: number;
  taxonomyTitle: string | null;
}

export interface ForeignAffairsPodcastArchivePage {
  articleUrls: string[];
  nextPageUrl: string | null;
  pageNumber: number;
  title: string | null;
}

export interface ForeignAffairsArticleSource {
  sourcePageUrl: string;
  taxonomy: ForeignAffairsTaxonomy;
}

interface DataLayerArticle {
  articletypedl?: unknown;
  authorsdl?: unknown;
  customtagdl?: unknown;
  nodedatalayer?: unknown;
  paywallstdl?: unknown;
  postdate_dl?: unknown;
  regiontagdl?: unknown;
  topictagdl?: unknown;
}

const requestHeaders: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15"
};

const nonArticlePathPrefixes = [
  "/about-foreign-affairs",
  "/accessibility-statement",
  "/app",
  "/author-listing",
  "/authors/",
  "/book-reviews/issue/",
  "/browse/",
  "/events",
  "/feedback",
  "/frequently-asked-questions",
  "/gift",
  "/graduateschoolforum",
  "/group-subscriptions",
  "/issues/",
  "/manage-preferences",
  "/mediakit",
  "/myaccount",
  "/node/",
  "/permissions",
  "/podcasts/",
  "/privacy-policy",
  "/regions",
  "/report-a-problem",
  "/rss.xml",
  "/search",
  "/staff",
  "/submissions",
  "/subscribe",
  "/subscription",
  "/tags/",
  "/terms-use",
  "/topics-tags",
  "/topics/",
  "/user/"
];

export async function fetchForeignAffairsTaxonomies(
  rootUrl: string,
  timeoutMs: number
): Promise<ForeignAffairsTaxonomy[]> {
  const url = new URL("/topics-tags", resolveForeignAffairsRootUrl(rootUrl));
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Foreign Affairs topics request failed with HTTP ${response.status}.`);
  }
  return parseForeignAffairsTaxonomies(await response.text(), url.toString());
}

export async function fetchForeignAffairsTaxonomyPage(
  url: string,
  timeoutMs: number
): Promise<ForeignAffairsTaxonomyPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return {
      articleUrls: [],
      nextPageUrl: null,
      pageNumber: parsePageNumber(url),
      taxonomyTitle: null
    };
  }

  if (!response.ok) {
    throw new Error(`Foreign Affairs taxonomy page request failed with HTTP ${response.status}.`);
  }

  return parseForeignAffairsTaxonomyPage(await response.text(), url);
}

export async function fetchForeignAffairsPodcastArchivePage(
  url: string,
  timeoutMs: number
): Promise<ForeignAffairsPodcastArchivePage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return {
      articleUrls: [],
      nextPageUrl: null,
      pageNumber: parsePageNumber(url),
      title: null
    };
  }

  if (!response.ok) {
    throw new Error(`Foreign Affairs podcast archive request failed with HTTP ${response.status}.`);
  }

  return parseForeignAffairsPodcastArchivePage(await response.text(), url);
}

export async function fetchForeignAffairsArticle(
  url: string,
  feedId: string,
  timeoutMs: number,
  source: ForeignAffairsArticleSource
): Promise<NormalizedItem | null> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Foreign Affairs article request failed with HTTP ${response.status}.`);
  }

  return parseForeignAffairsArticle(await response.text(), url, feedId, source);
}

export function parseForeignAffairsTaxonomies(
  html: string,
  pageUrl: string
): ForeignAffairsTaxonomy[] {
  const document = parse(html);
  const taxonomies = new Map<string, ForeignAffairsTaxonomy>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");
    const url = href ? resolveUrl(href, pageUrl) : null;

    if (!url || !isForeignAffairsHost(url.hostname)) {
      continue;
    }

    const match = url.pathname.match(/^\/(topics|tags)\/([^/]+)\/?$/);

    if (!match?.[1] || !match[2]) {
      continue;
    }

    const title = normalizeWhitespace(textContent(link));

    if (!title) {
      continue;
    }

    const normalizedUrl = normalizeForeignAffairsUrl(url);
    taxonomies.set(normalizedUrl, {
      slug: match[2],
      title,
      type: match[1] === "topics" ? "topic" : "tag",
      url: normalizedUrl
    });
  }

  return Array.from(taxonomies.values()).sort((left, right) => left.url.localeCompare(right.url));
}

export function parseForeignAffairsTaxonomyPage(
  html: string,
  pageUrl: string
): ForeignAffairsTaxonomyPage {
  const document = parse(html);
  const articleUrls = new Map<string, string>();
  const searchResults = findElements(
    document,
    (element) => element.tagName === "div" && hasClass(element, "search-results")
  );
  const resultLists = searchResults.flatMap((element) =>
    findElements(element, (candidate) => candidate.tagName === "ul")
  );

  for (const resultList of resultLists) {
    for (const link of findElements(resultList, (element) => element.tagName === "a")) {
      const href = getAttribute(link, "href");
      const url = href ? resolveUrl(href, pageUrl) : null;

      console.log(`Found search result link: ${url ?? "invalid url"} with text "${normalizeWhitespace(textContent(link))}"`);
      
      if (!url || !isArticleUrl(url)) {
        continue;
      }

      const normalized = normalizeForeignAffairsUrl(url);
      articleUrls.set(normalized, normalized);
    }
  }

  for (const url of pickStructuredItemListUrls(document, pageUrl)) {
    articleUrls.set(url, url);
  }

  return {
    articleUrls: Array.from(articleUrls.values()),
    nextPageUrl: pickNextPageUrl(document, pageUrl),
    pageNumber: parsePageNumber(pageUrl),
    taxonomyTitle: pickTitle(document)
  };
}

export function parseForeignAffairsPodcastArchivePage(
  html: string,
  pageUrl: string
): ForeignAffairsPodcastArchivePage {
  const document = parse(html);
  const articleUrls = new Map<string, string>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");
    const url = href ? resolveUrl(href, pageUrl) : null;

    if (!url || !isPodcastEpisodeUrl(url)) {
      continue;
    }

    const normalized = normalizeForeignAffairsUrl(url);
    articleUrls.set(normalized, normalized);
  }

  return {
    articleUrls: Array.from(articleUrls.values()),
    nextPageUrl: pickNextPageUrl(document, pageUrl),
    pageNumber: parsePageNumber(pageUrl),
    title: pickTitle(document)
  };
}

export function parseForeignAffairsArticle(
  html: string,
  pageUrl: string,
  feedId: string,
  source: ForeignAffairsArticleSource
): NormalizedItem | null {
  const document = parse(html);
  const dataLayer = pickDataLayerArticle(html);
  const canonicalUrl = pickLinkHref(document, "canonical") ?? normalizeForeignAffairsUrl(new URL(pageUrl));
  const nodeId = pickNodeId(document, html);
  const title =
    pickPropertyContent(document, "og:title") ??
    pickStructuredArticleString(document, "alternativeHeadline") ??
    pickTitle(document);
  const summaryText =
    pickMetaContent(document, "description") ??
    pickPropertyContent(document, "og:description") ??
    pickStructuredArticleString(document, "description");
  const publishedAt =
    parseDate(pickPropertyContent(document, "article:published_time")) ??
    parseDate(pickStructuredArticleString(document, "datePublished")) ??
    parseDate(readString(dataLayer?.postdate_dl));
  const modifiedAt =
    parseDate(pickPropertyContent(document, "article:modified_time")) ??
    parseDate(pickStructuredArticleString(document, "dateModified"));
  const authors = pickPropertyContents(document, "article:author");
  const dataLayerAuthors = readString(dataLayer?.authorsdl);
  const author = authors.length > 0 ? authors.join(", ") : dataLayerAuthors;

  if (!nodeId || !title || !canonicalUrl) {
    return null;
  }

  const image = pickImage(document);
  const regions = readStringArray(dataLayer?.regiontagdl);
  const topics = readStringArray(dataLayer?.topictagdl);
  const tags = readStringArray(dataLayer?.customtagdl);

  return {
    author,
    contentHtml: buildContentHtml(canonicalUrl, title, summaryText, image?.url ?? null),
    dedupeKey: buildDedupeKey(feedId, nodeId, canonicalUrl, title, publishedAt),
    guid: nodeId,
    publishedAt,
    rawExtensionData: {
      foreignAffairs: {
        articleType: readString(dataLayer?.articletypedl),
        backfilledFrom: source.sourcePageUrl,
        image,
        modifiedAt,
        nodeId,
        paywallStatus: readString(dataLayer?.paywallstdl),
        regions,
        sourceTaxonomy: source.taxonomy,
        tags,
        topics
      }
    },
    summaryText,
    title,
    url: canonicalUrl
  };
}

export function resolveForeignAffairsRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (!isForeignAffairsHost(url.hostname)) {
    throw new Error(`Expected a Foreign Affairs URL, got: ${candidate}`);
  }

  return new URL("/", "https://www.foreignaffairs.com");
}

export function resolveForeignAffairsInterviewArchiveUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (!isForeignAffairsHost(url.hostname)) {
    throw new Error(`Expected a Foreign Affairs URL, got: ${candidate}`);
  }

  if (url.pathname === "/rss.xml") {
    return new URL("/podcasts/foreign-affairs-interview", "https://www.foreignaffairs.com");
  }

  if (!isForeignAffairsInterviewArchiveUrl(url.toString())) {
    throw new Error(`Expected The Foreign Affairs Interview archive URL, got: ${candidate}`);
  }

  return new URL("/podcasts/foreign-affairs-interview", "https://www.foreignaffairs.com");
}

export function isForeignAffairsInterviewArchiveUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      isForeignAffairsHost(url.hostname) &&
      /^\/podcasts\/foreign-affairs-interview\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isForeignAffairsUrl(candidate: string): boolean {
  try {
    return isForeignAffairsHost(new URL(candidate).hostname);
  } catch {
    return false;
  }
}

function pickNextPageUrl(document: HtmlNode, pageUrl: string): string | null {
  const currentPage = parsePageNumber(pageUrl);
  const expectedNextPage = currentPage + 1;

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");
    const url = href ? resolveUrl(href, pageUrl) : null;

    if (!url || url.pathname !== new URL(pageUrl).pathname) {
      continue;
    }

    const page = parsePageNumber(url.toString());

    if (page === expectedNextPage) {
      return normalizeTaxonomyPageUrl(url);
    }
  }

  return null;
}

function isPodcastEpisodeUrl(url: URL): boolean {
  return (
    isForeignAffairsHost(url.hostname) &&
    /^\/podcasts\/[^/?#]+\/?$/.test(url.pathname) &&
    !isForeignAffairsInterviewArchiveUrl(url.toString())
  );
}

function pickDataLayerArticle(html: string): DataLayerArticle | null {
  const match = html.match(/window\.dataLayer\.push\((\{.*?\})\);/s);

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? parsed as DataLayerArticle : null;
  } catch {
    return null;
  }
}

function pickStructuredArticleString(document: HtmlNode, field: string): string | null {
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

function pickStructuredItemListUrls(document: HtmlNode, pageUrl: string): string[] {
  const urls = new Map<string, string>();

  for (const script of findElements(document, (element) => element.tagName === "script")) {
    if (getAttribute(script, "type") !== "application/ld+json") {
      continue;
    }

    for (const value of readStructuredItemListUrls(textContent(script))) {
      const url = resolveUrl(value, pageUrl);

      if (!url || !isArticleUrl(url)) {
        continue;
      }

      const normalized = normalizeForeignAffairsUrl(url);
      urls.set(normalized, normalized);
    }
  }

  return Array.from(urls.values());
}

function readStructuredItemListUrls(json: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const urls: string[] = [];

  collectStructuredItemListUrls(parsed, urls);

  return urls;
}

function collectStructuredItemListUrls(value: unknown, urls: string[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStructuredItemListUrls(entry, urls);
    }

    return;
  }

  const record = value as Record<string, unknown>;
  const itemListElements = record.itemListElement ?? record.ItemListElement;

  if (Array.isArray(itemListElements)) {
    for (const entry of itemListElements) {
      const entryUrl = entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).url
        : null;

      if (typeof entryUrl === "string") {
        urls.push(entryUrl);
      }
    }
  }

  collectStructuredItemListUrls(record.mainEntity, urls);
}

function readStructuredField(json: string, field: string): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];

  for (const candidate of candidates) {
    const value = readStructuredFieldFromValue(candidate, field);

    if (value) {
      return value;
    }
  }

  return null;
}

function readStructuredFieldFromValue(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record[field] === "string") {
    return record[field];
  }

  const graph = record["@graph"];

  if (Array.isArray(graph)) {
    for (const entry of graph) {
      const nested = readStructuredFieldFromValue(entry, field);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function pickNodeId(document: HtmlNode, html: string): string | null {
  const shortlink = pickLinkHref(document, "shortlink");
  const shortlinkMatch = shortlink?.match(/\/node\/(\d+)$/);

  if (shortlinkMatch?.[1]) {
    return shortlinkMatch[1];
  }

  const dataLayer = pickDataLayerArticle(html);
  const nodeId = readString(dataLayer?.nodedatalayer);

  return nodeId && /^\d+$/.test(nodeId) ? nodeId : null;
}

function pickImage(document: HtmlNode): {
  height: number | null;
  url: string;
  width: number | null;
} | null {
  const url = pickPropertyContent(document, "og:image") ?? pickMetaContent(document, "twitter:image");

  if (!url) {
    return null;
  }

  return {
    height: parsePositiveInteger(pickPropertyContent(document, "og:image:height")),
    url,
    width: parsePositiveInteger(pickPropertyContent(document, "og:image:width"))
  };
}

function pickTitle(document: HtmlNode): string | null {
  const title = findElements(document, (element) => element.tagName === "title")[0];
  const value = title ? normalizeWhitespace(textContent(title).replace(/\s+\|\s+Foreign Affairs$/, "")) : "";

  return value.length > 0 ? value : null;
}

function pickMetaContent(document: HtmlNode, name: string): string | null {
  return pickMetaContents(document, "name", name)[0] ?? null;
}

function pickPropertyContent(document: HtmlNode, property: string): string | null {
  return pickPropertyContents(document, property)[0] ?? null;
}

function pickPropertyContents(document: HtmlNode, property: string): string[] {
  return pickMetaContents(document, "property", property);
}

function pickMetaContents(document: HtmlNode, attributeName: string, attributeValue: string): string[] {
  return findElements(
    document,
    (element) => element.tagName === "meta" && getAttribute(element, attributeName) === attributeValue
  )
    .map((element) => getAttribute(element, "content"))
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0);
}

function pickLinkHref(document: HtmlNode, rel: string): string | null {
  const link = findElements(
    document,
    (element) => element.tagName === "link" && getAttribute(element, "rel") === rel
  )[0];
  const href = link ? getAttribute(link, "href") : null;

  return href ? normalizeForeignAffairsUrl(new URL(href, "https://www.foreignaffairs.com")) : null;
}

function isArticleUrl(url: URL): boolean {
  if (!isForeignAffairsHost(url.hostname)) {
    return false;
  }

  if (url.pathname === "/" || url.pathname.includes(".")) {
    return false;
  }

  if (nonArticlePathPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))) {
    return false;
  }

  return url.pathname.split("/").filter(Boolean).length >= 2;
}

function buildContentHtml(
  url: string,
  title: string,
  summaryText: string | null,
  imageUrl: string | null
): string {
  const parts: string[] = [];

  if (imageUrl) {
    parts.push(`<p><img src="${escapeHtml(imageUrl)}" alt="" /></p>`);
  }

  if (summaryText) {
    parts.push(`<p>${escapeHtml(summaryText)}</p>`);
  }

  parts.push(`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`);

  return parts.join("");
}

function parsePageNumber(pageUrl: string): number {
  const page = new URL(pageUrl).searchParams.get("page");
  const parsed = page ? Number(page) : 0;

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTaxonomyPageUrl(url: URL): string {
  const normalized = new URL(url.pathname, "https://www.foreignaffairs.com");
  const page = url.searchParams.get("page");

  if (page && page !== "0") {
    normalized.searchParams.set("page", page);
  }

  return normalized.toString();
}

function normalizeForeignAffairsUrl(url: URL): string {
  const normalized = new URL(url.pathname, "https://www.foreignaffairs.com");
  normalized.search = url.search;
  normalized.hash = "";
  return normalized.toString();
}

function resolveUrl(href: string, pageUrl: string): URL | null {
  try {
    return new URL(href, pageUrl);
  } catch {
    return null;
  }
}

function isForeignAffairsHost(hostname: string): boolean {
  return hostname === "foreignaffairs.com" || hostname === "www.foreignaffairs.com";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null);
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

function childNodes(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function getAttribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
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
