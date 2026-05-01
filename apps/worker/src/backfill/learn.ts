import { parse, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface LearnCategory {
  title: string;
  url: string;
}

export interface LearnGuidePreview {
  author: string | null;
  favoritesCount: number | null;
  imageAlt: string | null;
  imageUrl: string | null;
  isNew: boolean;
  skillLevel: string | null;
  title: string;
  url: string;
}

export interface LearnCategoryPage {
  categoryTitle: string | null;
  guides: LearnGuidePreview[];
  nextPageUrl: string | null;
  pageNumber: number;
}

export interface LearnGuideDetail {
  author: string | null;
  categories: string[];
  description: string | null;
  guideId: string | null;
  guideType: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  skillLevel: string | null;
  title: string | null;
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchLearnCategories(rootUrl: string, timeoutMs: number): Promise<LearnCategory[]> {
  const url = new URL("/categories", resolveLearnRootUrl(rootUrl));
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Adafruit Learn categories request failed with HTTP ${response.status}.`);
  }

  return parseLearnCategories(await response.text(), url.toString());
}

export async function fetchLearnCategoryPage(
  url: string,
  timeoutMs: number
): Promise<LearnCategoryPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return {
      categoryTitle: null,
      guides: [],
      nextPageUrl: null,
      pageNumber: parseGuidePageNumber(url)
    };
  }

  if (!response.ok) {
    throw new Error(`Adafruit Learn category request failed with HTTP ${response.status}.`);
  }

  return parseLearnCategoryPage(await response.text(), url);
}

export async function fetchLearnGuideDetail(
  url: string,
  timeoutMs: number
): Promise<LearnGuideDetail | null> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Adafruit Learn guide request failed with HTTP ${response.status}.`);
  }

  return parseLearnGuideDetail(await response.text(), url);
}

export function parseLearnCategories(html: string, pageUrl: string): LearnCategory[] {
  const document = parse(html);
  const categories = new Map<string, LearnCategory>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const href = getAttribute(link, "href");

    if (!href) {
      continue;
    }

    const url = resolveUrl(href, pageUrl);

    if (!url || url.hostname !== "learn.adafruit.com" || !url.pathname.startsWith("/category/")) {
      continue;
    }

    const title = normalizeWhitespace(textContent(link));

    if (title.length > 0) {
      categories.set(url.toString(), { title, url: url.toString() });
    }
  }

  return Array.from(categories.values()).sort((left, right) => left.url.localeCompare(right.url));
}

export function parseLearnCategoryPage(html: string, pageUrl: string): LearnCategoryPage {
  const document = parse(html);
  const categoryTitle = pickPageTitle(document);
  const guides = findElements(
    document,
    (element) => element.tagName === "div" && hasClass(element, "guide-preview")
  )
    .map((card) => parseGuidePreview(card, pageUrl))
    .filter((guide): guide is LearnGuidePreview => guide !== null);

  return {
    categoryTitle,
    guides,
    nextPageUrl: pickNextPageUrl(document, pageUrl),
    pageNumber: parseGuidePageNumber(pageUrl)
  };
}

export function parseLearnGuideDetail(html: string, pageUrl: string): LearnGuideDetail {
  const document = parse(html);
  const article = findElements(document, (element) => element.tagName === "article" && getAttribute(element, "data-guide-id") !== null)[0];
  const structuredData = pickStructuredData(document);
  const title = pickMetaContent(document, "guide-title") ?? pickHeaderTitle(document) ?? structuredData.title;
  const description =
    pickMetaContent(document, "description") ??
    pickPropertyContent(document, "og:description") ??
    structuredData.description;
  const imageUrl =
    pickPropertyContent(document, "og:image") ??
    pickMetaContent(document, "twitter:image:src") ??
    structuredData.imageUrl;
  const publishedAt = parseDate(structuredData.datePublished);

  return {
    author: pickGuideAuthors(document) ?? structuredData.author,
    categories: article ? pickGuideCategories(article) : [],
    description,
    guideId: article ? getAttribute(article, "data-guide-id") : null,
    guideType: article ? pickBadgeValue(article, "Guide Type") : null,
    imageUrl: imageUrl ? (resolveUrl(imageUrl, pageUrl)?.toString() ?? imageUrl) : null,
    publishedAt,
    skillLevel: article ? pickBadgeValue(article, "Skill Level") : null,
    title
  };
}

export function normalizeLearnGuide(
  preview: LearnGuidePreview,
  detail: LearnGuideDetail | null,
  feedId: string,
  sourceCategory: LearnCategory,
  sourcePageUrl: string
): NormalizedItem {
  const guideId = detail?.guideId ?? inferGuideId(preview.imageUrl);
  const guid = guideId ? `tag:learn.adafruit.com,2005:Guides::External/${guideId}` : null;
  const title = detail?.title ?? preview.title;
  const author = detail?.author ?? preview.author;
  const publishedAt = detail?.publishedAt ?? null;
  const imageUrl = detail?.imageUrl ?? preview.imageUrl;
  const description = detail?.description ?? preview.imageAlt;
  const categories = detail?.categories ?? [sourceCategory.title];
  const skillLevel = detail?.skillLevel ?? preview.skillLevel;
  const guideType = detail?.guideType ?? null;
  const summaryText = buildSummaryText(description, categories, skillLevel, guideType);

  return {
    author,
    contentHtml: buildContentHtml(preview.url, title, description, imageUrl, categories, skillLevel, guideType),
    dedupeKey: buildDedupeKey(feedId, guid, preview.url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      adafruitLearn: {
        categories,
        favoritesCount: preview.favoritesCount,
        guideId,
        guideType,
        imageAlt: preview.imageAlt,
        imageUrl,
        isNew: preview.isNew,
        skillLevel,
        sourceCategory,
        sourcePageUrl
      }
    },
    summaryText,
    title,
    url: preview.url
  };
}

export function resolveLearnRootUrl(candidate: string): URL {
  const url = new URL(candidate);

  if (url.hostname !== "learn.adafruit.com") {
    throw new Error(`Expected an Adafruit Learn URL, got: ${candidate}`);
  }

  return new URL("/", url);
}

function parseGuidePreview(card: HtmlElement, pageUrl: string): LearnGuidePreview | null {
  const titleLink = findElements(
    card,
    (element) => element.tagName === "a" && hasClass(element, "title")
  )[0];
  const href = titleLink ? getAttribute(titleLink, "href") : null;
  const title = titleLink ? normalizeWhitespace(textContent(titleLink)) : null;
  const url = href ? resolveUrl(href, pageUrl)?.toString() : null;

  if (!title || !url) {
    return null;
  }

  return {
    author: pickPreviewAuthor(card),
    favoritesCount: pickFavoritesCount(card),
    imageAlt: pickPreviewImage(card)?.alt ?? null,
    imageUrl: pickPreviewImage(card)?.url ?? null,
    isNew: findElements(card, (element) => element.tagName === "div" && hasClass(element, "badge") && hasClass(element, "new")).length > 0,
    skillLevel: pickPreviewSkillLevel(card),
    title,
    url
  };
}

function pickPreviewAuthor(card: HtmlElement): string | null {
  const authorName = findElements(card, (element) => element.tagName === "span" && hasClass(element, "name"))[0];

  return authorName ? normalizeWhitespace(textContent(authorName)) : null;
}

function pickPreviewImage(card: HtmlElement): { alt: string | null; url: string | null } | null {
  const image = findElements(card, (element) => element.tagName === "img" && hasClass(element, "image-preview"))[0];

  if (!image) {
    return null;
  }

  return {
    alt: getAttribute(image, "alt"),
    url: getAttribute(image, "src")
  };
}

function pickPreviewSkillLevel(card: HtmlElement): string | null {
  const badge = findElements(card, (element) => element.tagName === "div" && hasClass(element, "badge"))
    .find((element) => getAttribute(element, "aria-label") === "Guide skill level");

  return badge ? normalizeWhitespace(textContent(badge)) : null;
}

function pickFavoritesCount(card: HtmlElement): number | null {
  const badge = findElements(card, (element) => element.tagName === "div" && hasClass(element, "favorites"))[0];
  const count = badge ? Number(normalizeWhitespace(textContent(badge))) : NaN;

  return Number.isInteger(count) ? count : null;
}

function pickPageTitle(document: HtmlNode): string | null {
  const title = findElements(document, (element) => element.tagName === "h1" && hasClass(element, "title"))[0];

  return title ? normalizeWhitespace(textContent(title)) : null;
}

function pickNextPageUrl(document: HtmlNode, pageUrl: string): string | null {
  const next = findElements(document, (element) => element.tagName === "a")
    .find((link) => getAttribute(link, "rel") === "next" && normalizeWhitespace(textContent(link)).toLowerCase() === "next");
  const href = next ? getAttribute(next, "href") : null;

  return href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;
}

function parseGuidePageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const page = Number(url.searchParams.get("guide_page") ?? "1");

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function pickStructuredData(document: HtmlNode): {
  author: string | null;
  datePublished: string | null;
  description: string | null;
  imageUrl: string | null;
  title: string | null;
} {
  for (const script of findElements(document, (element) => element.tagName === "script" && getAttribute(element, "type") === "application/ld+json")) {
    try {
      const parsed = JSON.parse(textContent(script)) as {
        author?: { name?: string };
        datePublished?: string;
        description?: string;
        image?: string;
        name?: string;
      };

      if (parsed.datePublished || parsed.name || parsed.description) {
        return {
          author: parsed.author?.name ?? null,
          datePublished: parsed.datePublished ?? null,
          description: parsed.description ?? null,
          imageUrl: parsed.image ?? null,
          title: parsed.name ?? null
        };
      }
    } catch {
      continue;
    }
  }

  return {
    author: null,
    datePublished: null,
    description: null,
    imageUrl: null,
    title: null
  };
}

function pickMetaContent(document: HtmlNode, name: string): string | null {
  const meta = findElements(
    document,
    (element) => element.tagName === "meta" && getAttribute(element, "name") === name
  )[0];

  return meta ? getAttribute(meta, "content") : null;
}

function pickPropertyContent(document: HtmlNode, property: string): string | null {
  const meta = findElements(
    document,
    (element) => element.tagName === "meta" && getAttribute(element, "property") === property
  )[0];

  return meta ? getAttribute(meta, "content") : null;
}

function pickHeaderTitle(document: HtmlNode): string | null {
  const title = findElements(document, (element) => element.tagName === "h1" && hasClass(element, "title"))[0];

  return title ? normalizeWhitespace(textContent(title)) : null;
}

function pickGuideAuthors(document: HtmlNode): string | null {
  const byline = findElements(document, (element) => element.tagName === "div" && hasClass(element, "byline"))[0];

  if (!byline) {
    return null;
  }

  const authors = findElements(byline, (element) => element.tagName === "a")
    .map((link) => normalizeWhitespace(textContent(link)))
    .filter((author) => author.length > 0);

  return authors.length > 0 ? authors.join(", ") : null;
}

function pickGuideCategories(document: HtmlNode): string[] {
  const links = findElements(document, (element) => element.tagName === "a")
    .filter((link) => {
      const href = getAttribute(link, "href") ?? "";
      return href.startsWith("/category/") || href.startsWith("https://learn.adafruit.com/category/");
    })
    .map((link) => normalizeWhitespace(textContent(link)))
    .filter((category) => category.length > 0);

  return Array.from(new Set(links));
}

function pickBadgeValue(document: HtmlNode, label: string): string | null {
  const badge = findElements(
    document,
    (element) => element.tagName === "div" && hasClass(element, "badge") && getAttribute(element, "title") === label
  )[0];

  return badge ? normalizeWhitespace(textContent(badge)) : null;
}

function inferGuideId(imageUrl: string | null): string | null {
  const match = imageUrl?.match(/\/guides\/(?:cropped_images|images)\/0*([1-9]\d*)\//);

  return match?.[1] ?? null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildSummaryText(
  description: string | null,
  categories: string[],
  skillLevel: string | null,
  guideType: string | null
): string | null {
  const parts = [
    description,
    categories.length > 0 ? `Categories: ${categories.join(", ")}` : null,
    skillLevel ? `Skill level: ${skillLevel}` : null,
    guideType ? `Guide type: ${guideType}` : null
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" — ") : null;
}

function buildContentHtml(
  url: string,
  title: string,
  description: string | null,
  imageUrl: string | null,
  categories: string[],
  skillLevel: string | null,
  guideType: string | null
): string {
  const parts = [`<p><a href="${escapeHtml(url)}">Open guide on Adafruit Learn</a></p>`];

  if (imageUrl) {
    parts.push(`<p><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}"></p>`);
  }

  if (description) {
    parts.push(`<p>${escapeHtml(description)}</p>`);
  }

  const metadata = buildSummaryText(null, categories, skillLevel, guideType);

  if (metadata) {
    parts.push(`<p>${escapeHtml(metadata)}</p>`);
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

function resolveUrl(href: string, pageUrl: string | URL): URL | null {
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
