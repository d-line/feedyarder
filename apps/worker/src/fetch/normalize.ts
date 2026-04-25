import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";

import { ParseError } from "./errors.js";
import type { NormalizedItem } from "./types.js";

interface ParsedFeed {
  faviconUrl: string | null;
  items: NormalizedItem[];
  missingPublishedAtCount: number;
  siteUrl: string | null;
  title: string | null;
}

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  processEntities: false,
  parseTagValue: false,
  trimValues: true
});

export function parseFeedDocument(xml: string, feedId: string): ParsedFeed {
  if (xml.trim().length === 0) {
    throw new ParseError("Feed body is empty.");
  }

  let document: unknown;

  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new ParseError(error instanceof Error ? error.message : "Failed to parse XML.");
  }

  if (!document || typeof document !== "object") {
    throw new ParseError("Parsed XML document is empty.");
  }

  if ("rss" in document || "rdf:RDF" in document) {
    return parseRssLikeDocument(document as Record<string, unknown>, feedId);
  }

  if ("feed" in document) {
    return parseAtomDocument(document as Record<string, unknown>, feedId);
  }

  throw new ParseError("Unsupported feed format.");
}

function parseRssLikeDocument(
  document: Record<string, unknown>,
  feedId: string
): ParsedFeed {
  const rssRoot = (document.rss ?? document["rdf:RDF"]) as Record<string, unknown> | undefined;
  const channel = readObject(rssRoot?.channel) ?? rssRoot;

  if (!channel) {
    throw new ParseError("RSS channel is missing.");
  }

  const items = getArray(channel.item).map((item) =>
    normalizeRssItem(readObject(item), feedId)
  );
  const missingPublishedAtCount = items.filter((item) => item.publishedAt === null).length;

  return {
    faviconUrl:
      normalizeUrl(readText(readObject(channel.image)?.url)) ??
      deriveFaviconUrl(normalizeUrl(readText(channel.link))),
    items,
    missingPublishedAtCount,
    siteUrl: normalizeUrl(readText(channel.link)),
    title: readText(channel.title)
  };
}

function parseAtomDocument(
  document: Record<string, unknown>,
  feedId: string
): ParsedFeed {
  const feed = readObject(document.feed);

  if (!feed) {
    throw new ParseError("Atom feed root is missing.");
  }

  const items = getArray(feed.entry).map((entry) => normalizeAtomEntry(readObject(entry), feedId));
  const missingPublishedAtCount = items.filter((item) => item.publishedAt === null).length;
  const siteUrl = resolveAtomLink(feed.link);

  return {
    faviconUrl:
      normalizeUrl(readText(feed.icon)) ??
      normalizeUrl(readText(feed.logo)) ??
      deriveFaviconUrl(siteUrl),
    items,
    missingPublishedAtCount,
    siteUrl,
    title: readText(feed.title)
  };
}

function normalizeRssItem(item: Record<string, unknown> | null, feedId: string): NormalizedItem {
  if (!item) {
    throw new ParseError("RSS item is malformed.");
  }

  const guid = normalizeText(readText(item.guid));
  const url = normalizeUrl(readText(item.link));
  const title = normalizeText(readText(item.title));
  const author =
    normalizeText(readText(item["dc:creator"])) ??
    normalizeText(readText(item.author)) ??
    normalizeText(readText(item["itunes:author"]));
  const summaryText =
    normalizeText(readText(item.description)) ?? normalizeText(readText(item.summary));
  const contentHtml =
    normalizeText(readText(item["content:encoded"])) ??
    normalizeText(readText(item.description));
  const publishedAt = parsePublishedAt([
    readText(item.pubDate),
    readText(item.published),
    readText(item.updated),
    readText(item["dc:date"])
  ]);

  return {
    author,
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: collectExtensionData(item),
    summaryText,
    title,
    url
  };
}

function normalizeAtomEntry(
  entry: Record<string, unknown> | null,
  feedId: string
): NormalizedItem {
  if (!entry) {
    throw new ParseError("Atom entry is malformed.");
  }

  const guid = normalizeText(readText(entry.id));
  const url = resolveAtomLink(entry.link);
  const title = normalizeText(readText(entry.title));
  const author = normalizeText(
    readText(readObject(entry.author)?.name) ?? readText(entry["itunes:author"])
  );
  const summaryText = normalizeText(readText(entry.summary));
  const contentHtml = normalizeText(readText(entry.content)) ?? summaryText;
  const publishedAt = parsePublishedAt([
    readText(entry.published),
    readText(entry.updated),
    readText(entry.created)
  ]);

  return {
    author,
    contentHtml,
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: collectExtensionData(entry),
    summaryText,
    title,
    url
  };
}

function buildDedupeKey(
  feedId: string,
  guid: string | null,
  url: string | null,
  title: string | null,
  publishedAt: string | null
): string {
  const source = guid
    ? `guid:${feedId}:${guid}`
    : `fallback:${feedId}:${url ?? ""}:${title ?? ""}:${publishedAt ?? ""}`;

  return createHash("sha256").update(source).digest("hex");
}

function collectExtensionData(source: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(source).filter(([key]) => key.includes(":") || key === "enclosure");

  return Object.fromEntries(entries);
}

function parsePublishedAt(candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const date = new Date(candidate);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function resolveAtomLink(input: unknown): string | null {
  const links = getArray(input);

  for (const link of links) {
    const object = readObject(link);
    const rel = normalizeText(readText(object?.["@_rel"]));
    const href = normalizeUrl(readText(object?.["@_href"]));

    if (href && (!rel || rel === "alternate")) {
      return href;
    }
  }

  return null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function getArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value) {
    return readText((value as Record<string, unknown>)["#text"]);
  }

  if (value && typeof value === "object" && "__cdata" in value) {
    return readText((value as Record<string, unknown>).__cdata);
  }

  return null;
}

function normalizeText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeUrl(value: string | null): string | null {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function deriveFaviconUrl(siteUrl: string | null): string | null {
  if (!siteUrl) {
    return null;
  }

  try {
    return new URL("/favicon.ico", siteUrl).toString();
  } catch {
    return null;
  }
}
