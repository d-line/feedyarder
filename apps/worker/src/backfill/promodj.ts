import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface PromodjSection {
  title: string;
  url: string;
}

export interface PromodjListedItem {
  id: string;
  title: string;
  url: string;
}

export interface PromodjGroupPage {
  items: PromodjListedItem[];
  nextPageUrl: string | null;
  pageNumber: number;
}

export interface PromodjParsedItem {
  item: NormalizedItem;
  source: {
    durationSeconds: number | null;
    imageUrl: string | null;
    streamUrl: string | null;
    styles: string[];
  };
}

const requestHeaders: HeadersInit = {
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

const promodjMusicUrl = "https://promodj.com/chillrussia/music";

export async function fetchPromodjMusicSections(timeoutMs: number): Promise<PromodjSection[]> {
  const response = await fetch(promodjMusicUrl, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`PromoDJ music page request failed with HTTP ${response.status}.`);
  }

  return parsePromodjMusicSections(await response.text(), promodjMusicUrl);
}

export async function fetchPromodjGroupPage(
  url: string,
  timeoutMs: number
): Promise<PromodjGroupPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`PromoDJ group page request failed with HTTP ${response.status}.`);
  }

  return parsePromodjGroupPage(await response.text(), url);
}

export async function fetchPromodjItemPage(
  listedItem: PromodjListedItem,
  feedId: string,
  timeoutMs: number
): Promise<PromodjParsedItem> {
  const response = await fetch(listedItem.url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`PromoDJ item page request failed with HTTP ${response.status}.`);
  }

  return parsePromodjItemPage(await response.text(), feedId, listedItem);
}

export function parsePromodjMusicSections(html: string, pageUrl: string): PromodjSection[] {
  const document = parse(html);
  const sections = new Map<string, PromodjSection>();

  for (const link of findElements(document, (element) => element.tagName === "a" && hasClass(element, "files_group_title"))) {
    const href = getAttribute(link, "href");

    if (!href || !href.includes("/groups/")) {
      continue;
    }

    const url = resolveUrl(href, pageUrl)?.toString();
    const title = normalizeWhitespace(textContent(link));

    if (url && title) {
      sections.set(url, { title, url });
    }
  }

  return Array.from(sections.values());
}

export function parsePromodjGroupPage(html: string, pageUrl: string): PromodjGroupPage {
  const pageHtml = html.slice(0, findPaginationStart(html));
  const document = parse(pageHtml);
  const parents = buildParentMap(document);
  const items = new Map<string, PromodjListedItem>();

  for (const link of findElements(document, (element) => element.tagName === "a")) {
    const fileId = getAttribute(link, "amba")?.match(/^file:(\d+)$/)?.[1] ?? null;

    if (!fileId || !isPrimaryTrackTitleLink(link, parents)) {
      continue;
    }

    const href = getAttribute(link, "href");
    const url = href ? resolveUrl(href, pageUrl)?.toString() : null;
    const title = normalizeWhitespace(textContent(link));

    if (url && title) {
      items.set(fileId, { id: fileId, title, url });
    }
  }

  return {
    items: Array.from(items.values()),
    nextPageUrl: pickNextPageUrl(html, pageUrl),
    pageNumber: parsePageNumber(pageUrl)
  };
}

export function parsePromodjItemPage(
  html: string,
  feedId: string,
  fallback: PromodjListedItem
): PromodjParsedItem {
  const document = parse(html);
  const title = readMeta(document, "og:title", "property") ?? fallback.title;
  const url = readMeta(document, "og:url", "property") ?? fallback.url;
  const summaryText = readMeta(document, "og:description", "property");
  const imageUrl = readMeta(document, "og:image", "property");
  const streamUrl =
    readMeta(document, "twitter:player:stream", "name") ??
    extractPlayerStringValue(html, "URL");
  const downloadUrl =
    extractPlayerStringValue(html, "downloadURL") ??
    pickDownloadUrl(document, url);
  const durationSeconds =
    parseInteger(readMeta(document, "og:video:duration", "property")) ??
    parseDurationSeconds(extractLabeledText(html, "Duration"));
  const contentHtml = pickMoreHtml(document);
  const publishedAt = parsePromodjPublicationDate(extractLabeledText(html, "Publication"));
  const styles = extractStyles(html);
  const guid = `promodj:file:${fallback.id}`;

  return {
    item: {
      author: "C H I L L",
      contentHtml,
      dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
      guid,
      publishedAt,
      rawExtensionData: {
        enclosure: {
          "@_length": null,
          "@_type": "audio/mpeg",
          "@_url": streamUrl ?? downloadUrl
        },
        "itunes:duration": durationSeconds === null ? null : String(durationSeconds),
        "itunes:image": imageUrl ? { "@_href": imageUrl } : null,
        promodj: {
          downloadUrl,
          fileId: fallback.id,
          sourceUrl: url,
          styles
        }
      },
      summaryText,
      title,
      url
    },
    source: {
      durationSeconds,
      imageUrl,
      streamUrl,
      styles
    }
  };
}

export function isPromodjMaveBackfillFeed(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.hostname === "cloud.mave.digital" && url.pathname === "/33812";
  } catch {
    return false;
  }
}

export function resolvePromodjMusicUrl(): string {
  return promodjMusicUrl;
}

function isPrimaryTrackTitleLink(
  link: HtmlElement,
  parents: Map<HtmlNode, HtmlElement>
): boolean {
  const parent = parents.get(link);
  const grandparent = parent ? parents.get(parent) : null;

  return Boolean(
    parent &&
      parent.tagName === "div" &&
      hasClass(parent, "title") &&
      grandparent &&
      grandparent.tagName === "div" &&
      hasClass(grandparent, "track2")
  );
}

function pickNextPageUrl(html: string, pageUrl: string): string | null {
  const document = parse(html);
  const nextPage = findElements(
    document,
    (element) => element.tagName === "a" && getAttribute(element, "id") === "next_page"
  )[0];
  const href = nextPage ? getAttribute(nextPage, "href") : null;

  return href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;
}

function pickDownloadUrl(document: HtmlNode, pageUrl: string): string | null {
  const link = findElements(
    document,
    (element) => element.tagName === "a" && getAttribute(element, "id") === "download_flasher"
  )[0];
  const href = link ? getAttribute(link, "href") : null;

  return href ? (resolveUrl(href, pageUrl)?.toString() ?? null) : null;
}

function pickMoreHtml(document: HtmlNode): string | null {
  const content = findElements(
    document,
    (element) =>
      element.tagName === "div" &&
      hasClass(element, "dj_universal") &&
      hasClass(element, "perfect")
  )[0];

  if (!content) {
    return null;
  }

  const html = innerHtml(content);
  return html.trim() ? html.trim() : null;
}

function readMeta(
  document: HtmlNode,
  key: string,
  attributeName: "name" | "property"
): string | null {
  const meta = findElements(
    document,
    (element) =>
      element.tagName === "meta" && getAttribute(element, attributeName) === key
  )[0];

  return normalizeText(meta ? getAttribute(meta, "content") : null);
}

function extractLabeledText(html: string, label: string): string | null {
  const match = html.match(
    new RegExp(`<b>\\s*${escapeRegExp(label)}:\\s*</b>\\s*([^<]+)`, "i")
  );

  return normalizeText(decodeHtmlEntities(match?.[1] ?? null));
}

function extractStyles(html: string): string[] {
  const match = html.match(/<b>\s*Styles:\s*<\/b>\s*<span class="styles">([\s\S]*?)<\/span>/i);

  if (!match?.[1]) {
    return [];
  }

  const fragment = parse(match[1]);

  return findElements(fragment, (element) => element.tagName === "a")
    .map((element) => normalizeWhitespace(textContent(element)))
    .filter((style) => style.length > 0);
}

function extractPlayerStringValue(html: string, key: string): string | null {
  const match = html.match(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"])*)"`));

  if (!match?.[1]) {
    return null;
  }

  try {
    return resolveUrl(JSON.parse(`"${match[1]}"`), "https://promodj.com")?.toString() ?? null;
  } catch {
    return null;
  }
}

function parsePromodjPublicationDate(value: string | null): string | null {
  const match = value?.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, day, monthName, year, hour, minute] = match;

  if (!day || !monthName || !year || !hour || !minute) {
    return null;
  }

  const month = monthNames.get(monthName.toLowerCase());

  if (month === undefined) {
    return null;
  }

  const date = new Date(
    Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute))
  );

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDurationSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":").map((part) => Number(part));

  if (parts.length === 0 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
}

function parsePageNumber(pageUrl: string): number {
  const url = new URL(pageUrl);
  const page = url.searchParams.get("page");

  return page && /^\d+$/.test(page) ? Number(page) : 1;
}

function findPaginationStart(html: string): number {
  const index = html.indexOf('<nav><div class="Navigator">');
  return index === -1 ? html.length : index;
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

function buildParentMap(root: HtmlNode): Map<HtmlNode, HtmlElement> {
  const parents = new Map<HtmlNode, HtmlElement>();

  function visit(node: HtmlNode): void {
    for (const child of childNodes(node)) {
      if (isElement(node)) {
        parents.set(child, node);
      }

      visit(child);
    }
  }

  visit(root);
  return parents;
}

function innerHtml(element: HtmlElement): string {
  const fragment = {
    childNodes: childNodes(element),
    nodeName: "#document-fragment"
  } as DefaultTreeAdapterMap["documentFragment"];

  return serialize(fragment);
}

function childNodes(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? (node.childNodes as HtmlNode[]) : [];
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
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

  return childNodes(node).map((child) => textContent(child)).join("");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveUrl(value: string, baseUrl: string): URL | null {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return textContent(parse(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const monthNames = new Map<string, number>([
  ["january", 0],
  ["february", 1],
  ["march", 2],
  ["april", 3],
  ["may", 4],
  ["june", 5],
  ["july", 6],
  ["august", 7],
  ["september", 8],
  ["october", 9],
  ["november", 10],
  ["december", 11]
]);
