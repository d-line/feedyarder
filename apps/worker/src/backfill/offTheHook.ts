import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface OffTheHookArchiveMonth {
  title: string;
  url: string;
}

export interface OffTheHookAudioFile {
  bitrateKbps: number | null;
  part: string | null;
  url: string;
}

export interface OffTheHookMonthPage {
  items: NormalizedItem[];
  pageUrl: string;
}

const archiveUrl = "https://www.2600.com/offthehook/archive_ra.html";
const requestHeaders: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Feedyarder/0.1 (+https://localhost)"
};

export async function fetchOffTheHookArchiveMonths(
  timeoutMs: number
): Promise<OffTheHookArchiveMonth[]> {
  const response = await fetch(archiveUrl, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Off The Hook archive request failed with HTTP ${response.status}.`);
  }

  return parseOffTheHookArchiveMonths(await response.text(), archiveUrl);
}

export async function fetchOffTheHookMonthPage(
  url: string,
  feedId: string,
  timeoutMs: number
): Promise<OffTheHookMonthPage> {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Off The Hook month request failed with HTTP ${response.status}: ${url}`);
  }

  return parseOffTheHookMonthPage(await response.text(), url, feedId);
}

export function parseOffTheHookArchiveMonths(
  html: string,
  pageUrl: string
): OffTheHookArchiveMonth[] {
  const document = parse(html);
  const months = new Map<string, OffTheHookArchiveMonth>();

  for (const option of findElements(document, (element) => element.tagName === "option")) {
    const value = getAttribute(option, "value");
    const resolved = value ? resolveUrl(value, pageUrl) : null;

    if (!resolved || !isOffTheHookMonthUrl(resolved)) {
      continue;
    }

    resolved.search = "";
    resolved.hash = "";

    const url = resolved.toString();
    const title = normalizeWhitespace(textContent(option));

    months.set(url, {
      title: title || readMonthTitle(resolved),
      url
    });
  }

  return Array.from(months.values());
}

export function parseOffTheHookMonthPage(
  html: string,
  pageUrl: string,
  feedId: string
): OffTheHookMonthPage {
  const pageHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  const dateMarkers = Array.from(pageHtml.matchAll(
    /<font\b[^>]*>\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*-\s*<\/font\s*>/gi
  ));
  const items: NormalizedItem[] = [];

  for (const [index, dateMarker] of dateMarkers.entries()) {
    const parsedDate = parseEpisodeDate(
      `- ${dateMarker[1]} / ${dateMarker[2]} / ${dateMarker[3]} -`,
      pageUrl
    );
    const markerStart = dateMarker.index;
    const markerEnd = markerStart === undefined ? null : markerStart + dateMarker[0].length;
    const nextMarkerStart = dateMarkers[index + 1]?.index ?? pageHtml.length;

    if (!parsedDate || markerEnd === null) {
      continue;
    }

    const fragment = parseFragment(pageHtml.slice(markerEnd, nextMarkerStart));
    const parents = buildParentMap(fragment);
    const segmentNodes = fragment.childNodes;
    const audioFiles = collectAudioFiles(segmentNodes, parents, pageUrl, parsedDate.dateKey);
    const selectedAudio = pickHighestQualityAudio(audioFiles);

    if (!selectedAudio) {
      continue;
    }

    const descriptionNodes = readDescriptionNodes(segmentNodes);
    const summaryText = normalizeText(descriptionNodes.map(textContent).join(" "));
    const contentHtml = serializeDescription(descriptionNodes, summaryText);
    const guid = `oth${parsedDate.dateKey}-hq`;
    const title = `Off The Hook - ${parsedDate.displayDate}`;

    items.push({
      author: null,
      contentHtml,
      dedupeKey: buildDedupeKey(feedId, guid, pageUrl, title, parsedDate.publishedAt),
      guid,
      publishedAt: parsedDate.publishedAt,
      rawExtensionData: {
        enclosure: {
          "@_length": null,
          "@_type": "audio/mpeg",
          "@_url": selectedAudio.url
        },
        offTheHook: {
          archivePageUrl: pageUrl,
          audioFiles,
          bitrateKbps: selectedAudio.bitrateKbps,
          dateKey: parsedDate.dateKey,
          selectedAudioUrl: selectedAudio.url
        }
      },
      summaryText,
      title,
      url: pageUrl
    });
  }

  return { items, pageUrl };
}

export function isOffTheHookFeed(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();

    return (
      (hostname === "2600.com" || hostname === "www.2600.com") &&
      url.pathname === "/oth-broadband.xml"
    );
  } catch {
    return false;
  }
}

export function resolveOffTheHookArchiveUrl(): string {
  return archiveUrl;
}

function readDescriptionNodes(segmentNodes: HtmlNode[]): HtmlNode[] {
  const downloadIndex = segmentNodes.findIndex((node) =>
    /download\s+it\s+now!/i.test(normalizeWhitespace(textContent(node)))
  );

  return downloadIndex < 0 ? [] : segmentNodes.slice(0, downloadIndex);
}

function collectAudioFiles(
  segmentNodes: HtmlNode[],
  parents: Map<HtmlNode, HtmlElement>,
  pageUrl: string,
  dateKey: string
): OffTheHookAudioFile[] {
  const audioFiles = new Map<string, OffTheHookAudioFile>();

  for (const node of segmentNodes) {
    for (const link of findElements(node, (element) => element.tagName === "a")) {
      const href = getAttribute(link, "href");
      const url = href ? resolveUrl(href, pageUrl) : null;
      const identity = url ? readAudioIdentity(url) : null;

      if (!url || !identity || identity.dateKey !== dateKey) {
        continue;
      }

      const bitrateKbps =
        identity.filenameBitrateKbps ?? readNearbyBitrateKbps(link, parents);

      audioFiles.set(url.toString(), {
        bitrateKbps,
        part: identity.part,
        url: url.toString()
      });
    }
  }

  return Array.from(audioFiles.values());
}

function pickHighestQualityAudio(
  audioFiles: OffTheHookAudioFile[]
): OffTheHookAudioFile | null {
  let selected: OffTheHookAudioFile | null = null;

  for (const audioFile of audioFiles) {
    if (
      !selected ||
      (audioFile.bitrateKbps ?? -1) > (selected.bitrateKbps ?? -1)
    ) {
      selected = audioFile;
    }
  }

  return selected;
}

function readNearbyBitrateKbps(
  link: HtmlElement,
  parents: Map<HtmlNode, HtmlElement>
): number | null {
  const parent = parents.get(link);

  if (!parent) {
    return null;
  }

  const linkIndex = parent.childNodes.indexOf(link);

  if (linkIndex < 0) {
    return null;
  }

  let label = "";

  for (let index = linkIndex + 1; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes[index];

    if (!node || isElement(node, "br")) {
      break;
    }

    label += ` ${textContent(node)}`;
  }

  const match = normalizeWhitespace(label).match(/\b(\d+)\s*k(?:bps)?\b/i);
  const value = match?.[1] ? Number(match[1]) : Number.NaN;

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readAudioIdentity(url: URL): {
  dateKey: string;
  filenameBitrateKbps: number | null;
  part: string | null;
} | null {
  const filename = url.pathname.split("/").at(-1) ?? "";
  const match = filename.match(/^off_the_hook__(\d{8})([a-z])?(?:-(\d+))?\.mp3$/i);

  if (!match?.[1]) {
    return null;
  }

  const filenameBitrateKbps = match[3] ? Number(match[3]) : null;

  return {
    dateKey: match[1],
    filenameBitrateKbps:
      filenameBitrateKbps !== null && Number.isSafeInteger(filenameBitrateKbps)
        ? filenameBitrateKbps
        : null,
    part: match[2]?.toLowerCase() ?? null
  };
}

function parseEpisodeDate(
  value: string,
  pageUrl: string
): { dateKey: string; displayDate: string; publishedAt: string } | null {
  const match = normalizeWhitespace(value).match(
    /^-\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*-$/
  );

  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const pageYear = readPageYear(pageUrl);
  const markerYear = Number(match[3]);
  const year = match[3].length === 4 ? markerYear : pageYear;
  const month = Number(match[1]);
  const day = Number(match[2]);

  if (!year || !isValidDate(year, month, day)) {
    return null;
  }

  const publishedAt = new Date(Date.UTC(year, month - 1, day)).toISOString();
  const dateKey = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  const displayDate = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(publishedAt));

  return { dateKey, displayDate, publishedAt };
}

function readPageYear(pageUrl: string): number | null {
  try {
    const match = new URL(pageUrl).pathname.match(/^\/offthehook\/(\d{4})\//);
    const year = match?.[1] ? Number(match[1]) : Number.NaN;

    return Number.isSafeInteger(year) ? year : null;
  } catch {
    return null;
  }
}

function isValidDate(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day));

  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function serializeDescription(nodes: HtmlNode[], summaryText: string | null): string | null {
  if (!summaryText) {
    return null;
  }

  const fragment = {
    childNodes: nodes,
    nodeName: "#document-fragment"
  } as DefaultTreeAdapterMap["documentFragment"];
  const html = serialize(fragment).trim();
  const cleaned = html
    .replace(/^(?:\s*<p>\s*<\/p>\s*)+/i, "")
    .replace(/(?:\s*<p>\s*<\/p>\s*)+$/i, "")
    .trim();

  return cleaned || null;
}

function readMonthTitle(url: URL): string {
  const match = url.pathname.match(/^\/offthehook\/(\d{4})\/(\d{2})\d{2}\.html$/);

  if (!match?.[1] || !match[2]) {
    return url.toString();
  }

  const month = Number(match[2]);
  const date = new Date(Date.UTC(Number(match[1]), month - 1, 1));

  if (date.getUTCMonth() !== month - 1) {
    return url.toString();
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(date);
}

function isOffTheHookMonthUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();

  return (
    (hostname === "2600.com" || hostname === "www.2600.com") &&
    /^\/offthehook\/\d{4}\/\d{4}\.html$/.test(url.pathname)
  );
}

function buildParentMap(node: HtmlNode): Map<HtmlNode, HtmlElement> {
  const parents = new Map<HtmlNode, HtmlElement>();

  function visit(current: HtmlNode): void {
    if (!("childNodes" in current)) {
      return;
    }

    for (const child of current.childNodes) {
      if ("tagName" in current) {
        parents.set(child, current);
      }

      visit(child);
    }
  }

  visit(node);
  return parents;
}

function findElements(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean
): HtmlElement[] {
  const matches: HtmlElement[] = [];

  function visit(current: HtmlNode): void {
    if ("tagName" in current && predicate(current)) {
      matches.push(current);
    }

    if ("childNodes" in current) {
      for (const child of current.childNodes) {
        visit(child);
      }
    }
  }

  visit(node);
  return matches;
}

function isElement(node: HtmlNode, tagName: string): node is HtmlElement {
  return "tagName" in node && node.tagName === tagName;
}

function getAttribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function textContent(node: HtmlNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  if (!("childNodes" in node)) {
    return "";
  }

  return node.childNodes.map(textContent).join(" ");
}

function normalizeText(value: string | null): string | null {
  const normalized = value ? normalizeWhitespace(value) : "";
  return normalized || null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveUrl(value: string, baseUrl: string): URL | null {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}
