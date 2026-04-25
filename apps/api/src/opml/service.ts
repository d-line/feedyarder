import { XMLBuilder, XMLParser } from "fast-xml-parser";

import type { ExportableFeed, ImportedFeedInput } from "./repository.js";

interface ImportParsedFeed {
  feedUrl: string;
  folderTitle: string | null;
  siteUrl: string | null;
  title: string | null;
}

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  format: true,
  ignoreAttributes: false,
  suppressEmptyNode: true
});

export function parseOpmlDocument(opml: string): ImportedFeedInput[] {
  if (opml.trim().length === 0) {
    throw new Error("OPML document is empty.");
  }

  const parsed = parser.parse(opml) as Record<string, unknown>;
  const opmlRoot = readObject(parsed.opml);
  const body = readObject(opmlRoot?.body);

  if (!body) {
    throw new Error("OPML body is missing.");
  }

  const seenFeedUrls = new Set<string>();
  const collected: ImportedFeedInput[] = [];

  visitOutlines(body.outline, null, seenFeedUrls, collected);

  return collected;
}

export function buildOpmlDocument(feeds: ExportableFeed[]): string {
  const grouped = new Map<string, ExportableFeed[]>();
  const ungrouped: ExportableFeed[] = [];

  for (const feed of feeds) {
    if (feed.folderTitle) {
      const current = grouped.get(feed.folderTitle) ?? [];
      current.push(feed);
      grouped.set(feed.folderTitle, current);
    } else {
      ungrouped.push(feed);
    }
  }

  const bodyOutline: unknown[] = [];

  for (const [folderTitle, folderFeeds] of grouped.entries()) {
    bodyOutline.push({
      "@_text": folderTitle,
      "@_title": folderTitle,
      outline: folderFeeds.map(buildFeedOutline)
    });
  }

  for (const feed of ungrouped) {
    bodyOutline.push(buildFeedOutline(feed));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({
    opml: {
      "@_version": "1.0",
      body: {
        outline: bodyOutline
      },
      head: {
        title: "Feedyarder Export"
      }
    }
  })}`;
}

function buildFeedOutline(feed: ExportableFeed): Record<string, string> {
  const title = feed.title ?? feed.feedUrl;

  return {
    "@_feedyarderPaused": feed.isPaused ? "true" : "false",
    "@_htmlUrl": feed.siteUrl ?? "",
    "@_text": title,
    "@_title": title,
    "@_type": "rss",
    "@_xmlUrl": feed.feedUrl
  };
}

function visitOutlines(
  input: unknown,
  currentFolderTitle: string | null,
  seenFeedUrls: Set<string>,
  collected: ImportParsedFeed[]
): void {
  const outlines = toArray(input);

  for (const outline of outlines) {
    const node = readObject(outline);

    if (!node) {
      continue;
    }

    const xmlUrl = normalizeUrl(readText(node["@_xmlUrl"]));
    const nextFolderTitle =
      xmlUrl === null
        ? normalizeText(readText(node["@_title"])) ?? normalizeText(readText(node["@_text"])) ?? currentFolderTitle
        : currentFolderTitle;

    if (xmlUrl) {
      if (seenFeedUrls.has(xmlUrl)) {
        continue;
      }

      seenFeedUrls.add(xmlUrl);
      collected.push({
        feedUrl: xmlUrl,
        folderTitle: currentFolderTitle,
        siteUrl: normalizeUrl(readText(node["@_htmlUrl"])),
        title: normalizeText(readText(node["@_title"])) ?? normalizeText(readText(node["@_text"]))
      });
      continue;
    }

    visitOutlines(node.outline, nextFolderTitle, seenFeedUrls, collected);
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function normalizeText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUrl(value: string | null): string | null {
  const trimmed = normalizeText(value);

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}
