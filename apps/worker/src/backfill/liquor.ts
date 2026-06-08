import { XMLParser } from "fast-xml-parser";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface LiquorSitemap {
  sitemapUrls: string[];
  urlEntries: LiquorSitemapEntry[];
}

export interface LiquorSitemapEntry {
  lastModified: string | null;
  url: string;
}

export interface LiquorTaxonomy {
  title: string;
  url: string;
}

export interface LiquorTaxonomyArticle {
  documentId: string;
  title: string | null;
  url: string;
}

export interface LiquorTaxonomyPage {
  articles: LiquorTaxonomyArticle[];
  childTaxonomies: LiquorTaxonomy[];
  title: string | null;
  url: string;
}

export interface LiquorArticleSource {
  sitemapLastModified: string | null;
  sitemapUrl: string;
  taxonomyPaths: string[][];
}

interface StructuredImage {
  height: number | null;
  url: string;
  width: number | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});

const defaultUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

export const liquorRootTaxonomies: LiquorTaxonomy[] = [
  {
    title: "Cocktail & Other Recipes",
    url: "https://www.liquor.com/cocktail-and-other-recipes-4779343"
  },
  {
    title: "Spirits & Liqueurs",
    url: "https://www.liquor.com/spirits-and-liqueurs-4779376"
  },
  {
    title: "Beer & Wine",
    url: "https://www.liquor.com/beer-and-wine-4779360"
  },
  {
    title: "The Basics",
    url: "https://www.liquor.com/bar-and-cocktail-basics-4779357"
  },
  {
    title: "Behind the Bar",
    url: "https://www.liquor.com/behind-the-bar-4779351"
  },
  {
    title: "News",
    url: "https://www.liquor.com/news-5070031"
  }
];

export async function fetchLiquorSitemap(
  url: string,
  timeoutMs: number
): Promise<LiquorSitemap> {
  const response = await fetch(url, {
    headers: buildLiquorRequestHeaders(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.text();

  assertLiquorResponse(response, body, "sitemap");
  return parseLiquorSitemap(body, url);
}

export async function fetchLiquorTaxonomyPage(
  url: string,
  timeoutMs: number
): Promise<LiquorTaxonomyPage> {
  const response = await fetch(url, {
    headers: buildLiquorRequestHeaders(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.text();

  assertLiquorResponse(response, body, "taxonomy");
  return parseLiquorTaxonomyPage(body, url);
}

export async function fetchLiquorArticle(
  url: string,
  feedId: string,
  timeoutMs: number,
  source: LiquorArticleSource
): Promise<NormalizedItem | null> {
  const response = await fetch(url, {
    headers: buildLiquorRequestHeaders(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.text();

  if (response.status === 404) {
    return null;
  }

  assertLiquorResponse(response, body, "article");
  return parseLiquorArticle(body, url, feedId, source);
}

export function parseLiquorSitemap(xml: string, sitemapUrl: string): LiquorSitemap {
  let parsed: unknown;

  try {
    parsed = xmlParser.parse(xml);
  } catch (error) {
    throw new Error(`Liquor.com sitemap XML could not be parsed: ${formatError(error)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Liquor.com sitemap response was not an XML document.");
  }

  const record = parsed as Record<string, unknown>;
  const sitemapEntries = readXmlEntries(record.sitemapindex, "sitemap");
  const urlEntries = readXmlEntries(record.urlset, "url");

  if (sitemapEntries.length === 0 && urlEntries.length === 0) {
    throw new Error(`Liquor.com sitemap contained no URLs: ${sitemapUrl}`);
  }

  return {
    sitemapUrls: uniqueUrls(
      sitemapEntries
        .map((entry) => readXmlString(entry.loc))
        .filter((value): value is string => value !== null)
    ),
    urlEntries: urlEntries.flatMap((entry) => {
      const url = readXmlString(entry.loc);

      if (!url || !isLiquorUrl(url)) {
        return [];
      }

      return [{
        lastModified: parseDate(readXmlString(entry.lastmod)),
        url: normalizeLiquorUrl(url)
      }];
    })
  };
}

export function parseLiquorTaxonomyPage(
  html: string,
  pageUrl: string
): LiquorTaxonomyPage {
  const document = parse(html);
  const childTaxonomies = new Map<string, LiquorTaxonomy>();
  const articles = new Map<string, LiquorTaxonomyArticle>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");
    const url = href ? resolveLiquorUrl(href, pageUrl) : null;

    if (!url) {
      continue;
    }

    if (hasClass(link, "mntl-taxonomy-nodes__link")) {
      const title = normalizeWhitespace(textContent(link));

      if (title) {
        childTaxonomies.set(url, { title, url });
      }

      continue;
    }

    const documentId = getAttribute(link, "data-doc-id");

    if (!documentId || !/^\d+$/.test(documentId)) {
      continue;
    }

    articles.set(url, {
      documentId,
      title: pickDescendantText(link, "card__title-text"),
      url
    });
  }

  return {
    articles: Array.from(articles.values()),
    childTaxonomies: Array.from(childTaxonomies.values()),
    title: pickHeading(document),
    url: normalizeLiquorUrl(pageUrl)
  };
}

export function parseLiquorArticle(
  html: string,
  pageUrl: string,
  feedId: string,
  source: LiquorArticleSource
): NormalizedItem | null {
  const document = parse(html);
  const structured = pickStructuredArticle(document);

  if (!structured) {
    return null;
  }

  const canonicalUrl =
    pickLinkHref(document, "canonical", pageUrl) ??
    normalizeLiquorUrl(pageUrl);
  const documentId = pickDocumentId(document, canonicalUrl);
  const title =
    readString(structured.headline) ??
    readString(structured.name) ??
    pickMetaContent(document, "property", "og:title") ??
    pickHeading(document);
  const summaryText =
    readString(structured.description) ??
    pickMetaContent(document, "name", "description") ??
    pickMetaContent(document, "property", "og:description");

  if (!documentId || !title) {
    return null;
  }

  const publishedAt = parseDate(readString(structured.datePublished));
  const modifiedAt = parseDate(readString(structured.dateModified));
  const author = pickAuthors(structured.author);
  const image = pickStructuredImage(structured.image);
  const articleBody = readString(structured.articleBody);
  const types = readStringArray(structured["@type"]);
  const categories = uniqueStrings([
    ...readStringArray(structured.articleSection),
    ...readStringArray(structured.recipeCategory),
    ...readStringArray(structured.recipeCuisine)
  ]);
  const keywords = readKeywords(structured.keywords);

  return {
    author,
    contentHtml: buildContentHtml(
      canonicalUrl,
      title,
      articleBody ?? summaryText,
      image?.url ?? null
    ),
    dedupeKey: buildDedupeKey(feedId, documentId, canonicalUrl, title, publishedAt),
    guid: documentId,
    publishedAt,
    rawExtensionData: {
      liquor: {
        backfilledFrom: source.sitemapUrl,
        categories,
        documentId,
        image,
        keywords,
        modifiedAt,
        sitemapLastModified: source.sitemapLastModified,
        structuredData: structured,
        taxonomyPaths: source.taxonomyPaths,
        types
      }
    },
    summaryText,
    title,
    url: canonicalUrl
  };
}

export function resolveLiquorRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (!isLiquorHost(url.hostname)) {
    throw new Error(`Expected a Liquor.com URL, got: ${candidate}`);
  }

  return new URL("/", "https://www.liquor.com");
}

export function isLiquorUrl(candidate: string): boolean {
  try {
    return isLiquorHost(new URL(candidate).hostname);
  } catch {
    return false;
  }
}

export function isPotentialLiquorArticleUrl(
  candidate: string,
  taxonomyUrls: ReadonlySet<string>
): boolean {
  if (!isLiquorUrl(candidate)) {
    return false;
  }

  const normalized = normalizeLiquorUrl(candidate);
  const url = new URL(normalized);

  if (taxonomyUrls.has(normalized) || url.pathname === "/") {
    return false;
  }

  return ![
    "/about-us-",
    "/authentication/",
    "/author/",
    "/cdn-cgi/",
    "/contact",
    "/google-news-sitemap",
    "/sitemap"
  ].some((value) => url.pathname.startsWith(value));
}

export function buildLiquorRequestHeaders(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const userAgent =
    env.LIQUOR_BACKFILL_USER_AGENT?.trim() || defaultUserAgent;
  assertHeaderByteString("LIQUOR_BACKFILL_USER_AGENT", userAgent);

  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": userAgent
  };
  const cookie = normalizeLiquorCookie(env.LIQUOR_BACKFILL_COOKIE);

  if (cookie) {
    assertHeaderByteString("LIQUOR_BACKFILL_COOKIE", cookie);
    headers.cookie = cookie;
  }

  return headers;
}

function assertLiquorResponse(response: Response, body: string, stage: string): void {
  if (isCloudflareChallenge(body)) {
    const cookieHint = process.env.LIQUOR_BACKFILL_COOKIE?.trim()
      ? "LIQUOR_BACKFILL_COOKIE may be expired or not match LIQUOR_BACKFILL_USER_AGENT."
      : "Set LIQUOR_BACKFILL_COOKIE to a browser Cookie header or cf_clearance value and set LIQUOR_BACKFILL_USER_AGENT to that browser's exact user agent.";

    throw new Error(
      `Liquor.com ${stage} request was blocked by a Cloudflare challenge: ${response.url}. ${cookieHint}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Liquor.com ${stage} request failed with HTTP ${response.status}: ${response.url}`
    );
  }
}

function isCloudflareChallenge(body: string): boolean {
  return (
    body.includes("<title>Just a moment...</title>") ||
    body.includes("/cdn-cgi/challenge-platform/")
  );
}

function normalizeLiquorCookie(value: string | undefined): string | null {
  const configured = value?.trim();

  if (!configured) {
    return null;
  }

  return configured.includes("=")
    ? configured
    : `cf_clearance=${configured}`;
}

function assertHeaderByteString(name: string, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);

    if (codePoint !== undefined && codePoint > 255) {
      const character = String.fromCodePoint(codePoint);
      const formattedCodePoint = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

      throw new Error(
        `${name} contains non-header character ${JSON.stringify(character)} (${formattedCodePoint}) at index ${index}. Copy only the raw browser value without table icons, checkmarks, or labels.`
      );
    }

    if (codePoint !== undefined && codePoint > 0xffff) {
      index += 1;
    }
  }
}

function pickStructuredArticle(document: HtmlNode): Record<string, unknown> | null {
  for (const script of findElements(
    document,
    (element) =>
      element.tagName === "script" &&
      getAttribute(element, "type") === "application/ld+json"
  )) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(textContent(script));
    } catch {
      continue;
    }

    const article = findStructuredArticle(parsed);

    if (article) {
      return article;
    }
  }

  return null;
}

function findStructuredArticle(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = findStructuredArticle(entry);

      if (result) {
        return result;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const types = readStringArray(record["@type"]);

  if (types.some((type) => ["Article", "NewsArticle", "Recipe"].includes(type))) {
    return record;
  }

  const graph = record["@graph"];

  if (Array.isArray(graph)) {
    return findStructuredArticle(graph);
  }

  return null;
}

function pickDocumentId(document: HtmlNode, canonicalUrl: string): string | null {
  for (const element of findElements(document, () => true)) {
    const value = getAttribute(element, "data-doc-id");

    if (value && /^\d+$/.test(value)) {
      return value;
    }
  }

  const pathMatch = new URL(canonicalUrl).pathname.match(/-(\d+)\/?$/);
  return pathMatch?.[1] ?? null;
}

function pickAuthors(value: unknown): string | null {
  const authors = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => {
      if (typeof entry === "string") {
        return [normalizeWhitespace(entry)];
      }

      if (!entry || typeof entry !== "object") {
        return [];
      }

      const name = readString((entry as Record<string, unknown>).name);
      return name ? [name] : [];
    })
    .filter(Boolean);

  return authors.length > 0 ? uniqueStrings(authors).join(", ") : null;
}

function pickStructuredImage(value: unknown): StructuredImage | null {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (typeof candidate === "string") {
    return { height: null, url: candidate, width: null };
  }

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const url = readString(record.url) ?? readString(record.contentUrl);

  if (!url) {
    return null;
  }

  return {
    height: readPositiveInteger(record.height),
    url,
    width: readPositiveInteger(record.width)
  };
}

function readKeywords(value: unknown): string[] {
  if (typeof value === "string") {
    return uniqueStrings(value.split(",").map((entry) => normalizeWhitespace(entry)));
  }

  return uniqueStrings(readStringArray(value));
}

function buildContentHtml(
  url: string,
  title: string,
  body: string | null,
  imageUrl: string | null
): string {
  const parts: string[] = [];

  if (imageUrl) {
    parts.push(`<p><img src="${escapeHtml(imageUrl)}" alt="" /></p>`);
  }

  if (body) {
    for (const paragraph of body.split(/\n{2,}/).map(normalizeWhitespace).filter(Boolean)) {
      parts.push(`<p>${escapeHtml(paragraph)}</p>`);
    }
  }

  parts.push(`<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`);
  return parts.join("");
}

function readXmlEntries(value: unknown, key: string): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return [];
  }

  const entries = (value as Record<string, unknown>)[key];

  if (Array.isArray(entries)) {
    return entries.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object"
    );
  }

  return entries && typeof entries === "object"
    ? [entries as Record<string, unknown>]
    : [];
}

function readXmlString(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeWhitespace(value) || null;
  }

  if (value && typeof value === "object") {
    return readXmlString((value as Record<string, unknown>)["#text"]);
  }

  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && normalizeWhitespace(value)
    ? normalizeWhitespace(value)
    : null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value
        .map((entry) => readString(entry))
        .filter((entry): entry is string => entry !== null)
    );
  }

  const single = readString(value);
  return single ? [single] : [];
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickHeading(document: HtmlNode): string | null {
  const heading = findElements(document, (element) => element.tagName === "h1")[0];
  const value = heading ? normalizeWhitespace(textContent(heading)) : "";
  return value || null;
}

function pickDescendantText(element: HtmlElement, className: string): string | null {
  const descendant = findElements(
    element,
    (candidate) => hasClass(candidate, className)
  )[0];
  const value = descendant ? normalizeWhitespace(textContent(descendant)) : "";
  return value || null;
}

function pickMetaContent(
  document: HtmlNode,
  attributeName: string,
  attributeValue: string
): string | null {
  const meta = findElements(
    document,
    (element) =>
      element.tagName === "meta" &&
      getAttribute(element, attributeName) === attributeValue
  )[0];
  const content = meta ? getAttribute(meta, "content") : null;
  return content ? normalizeWhitespace(content) : null;
}

function pickLinkHref(document: HtmlNode, rel: string, pageUrl: string): string | null {
  const link = findElements(
    document,
    (element) =>
      element.tagName === "link" &&
      getAttribute(element, "rel") === rel
  )[0];
  const href = link ? getAttribute(link, "href") : null;
  return href ? resolveLiquorUrl(href, pageUrl) : null;
}

function resolveLiquorUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return isLiquorHost(url.hostname) ? normalizeLiquorUrl(url.toString()) : null;
  } catch {
    return null;
  }
}

function normalizeLiquorUrl(value: string): string {
  const url = new URL(value);
  url.hostname = "www.liquor.com";
  url.hash = "";
  url.search = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

function isLiquorHost(hostname: string): boolean {
  return hostname === "liquor.com" || hostname === "www.liquor.com";
}

function uniqueUrls(values: string[]): string[] {
  return uniqueStrings(
    values.flatMap((value) => {
      try {
        return [normalizeLiquorUrl(value)];
      } catch {
        return [];
      }
    })
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function findElements(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean
): HtmlElement[] {
  const matches: HtmlElement[] = [];

  if ("tagName" in node && predicate(node as HtmlElement)) {
    matches.push(node as HtmlElement);
  }

  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      matches.push(...findElements(child, predicate));
    }
  }

  return matches;
}

function getAttribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function hasClass(element: HtmlElement, className: string): boolean {
  return (getAttribute(element, "class") ?? "").split(/\s+/).includes(className);
}

function textContent(node: HtmlNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  if ("childNodes" in node) {
    return node.childNodes.map(textContent).join("");
  }

  return "";
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
