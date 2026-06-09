import { parse, type DefaultTreeAdapterTypes } from "parse5";

const DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_DISCOVERY_DOCUMENT_BYTES = 5 * 1024 * 1024;
const FEED_CONTENT_TYPES = new Set([
  "application/atom+xml",
  "application/feed+json",
  "application/json",
  "application/rdf+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml"
]);

export interface DiscoveredFeed {
  feedUrl: string;
  title: string | null;
  type: string;
}

export interface FeedDiscoveryResponse {
  feeds: DiscoveredFeed[];
  siteUrl: string;
}

export class FeedDiscoveryError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "FeedDiscoveryError";
    this.code = code;
    this.status = status;
  }
}

export async function discoverFeeds(
  pageUrl: string,
  fetchImplementation: typeof fetch = fetch
): Promise<FeedDiscoveryResponse> {
  const requestedUrl = parseHttpUrl(pageUrl);
  let response: Response;

  try {
    response = await fetchImplementation(requestedUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "user-agent": "Feedyarder/0.1 (+https://localhost)"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    });
  } catch {
    throw fetchFailedError();
  }

  if (!response.ok) {
    throw new FeedDiscoveryError(
      502,
      "feed_discovery_http_error",
      `The webpage returned HTTP ${response.status}.`
    );
  }

  const finalUrl = parseHttpUrl(response.url || requestedUrl.href);
  let body: string;

  try {
    body = await readLimitedText(response);
  } catch (error) {
    if (error instanceof FeedDiscoveryError) {
      throw error;
    }

    throw fetchFailedError();
  }

  const document = parse(body);
  const baseUrl = findBaseUrl(document, finalUrl);
  const feeds = findFeedLinks(document, baseUrl);

  return {
    feeds,
    siteUrl: finalUrl.href
  };
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FeedDiscoveryError(
      400,
      "unsupported_discovery_url",
      "Feed discovery supports only HTTP and HTTPS URLs."
    );
  }

  return url;
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_DISCOVERY_DOCUMENT_BYTES
  ) {
    await response.body?.cancel();
    throw pageTooLargeError();
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    byteCount += value.byteLength;

    if (byteCount > MAX_DISCOVERY_DOCUMENT_BYTES) {
      await reader.cancel();
      throw pageTooLargeError();
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function pageTooLargeError(): FeedDiscoveryError {
  return new FeedDiscoveryError(
    422,
    "feed_discovery_page_too_large",
    "The webpage is too large to inspect for feeds."
  );
}

function fetchFailedError(): FeedDiscoveryError {
  return new FeedDiscoveryError(
    502,
    "feed_discovery_fetch_failed",
    "The webpage could not be fetched."
  );
}

function findBaseUrl(document: DefaultTreeAdapterTypes.Document, fallbackUrl: URL): URL {
  const baseElement = findElements(document, "base")[0];
  const href = baseElement ? getAttribute(baseElement, "href") : null;

  if (!href) {
    return fallbackUrl;
  }

  try {
    return new URL(href, fallbackUrl);
  } catch {
    return fallbackUrl;
  }
}

function findFeedLinks(
  document: DefaultTreeAdapterTypes.Document,
  baseUrl: URL
): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  const seenUrls = new Set<string>();

  for (const element of findElements(document, "link")) {
    const rel = getAttribute(element, "rel")
      ?.toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const type = normalizeContentType(getAttribute(element, "type"));
    const href = getAttribute(element, "href");

    if (!rel?.includes("alternate") || !type || !FEED_CONTENT_TYPES.has(type) || !href) {
      continue;
    }

    let feedUrl: URL;

    try {
      feedUrl = new URL(href, baseUrl);
    } catch {
      continue;
    }

    if (
      (feedUrl.protocol !== "http:" && feedUrl.protocol !== "https:") ||
      seenUrls.has(feedUrl.href)
    ) {
      continue;
    }

    seenUrls.add(feedUrl.href);
    feeds.push({
      feedUrl: feedUrl.href,
      title: normalizeTitle(getAttribute(element, "title")),
      type
    });
  }

  return feeds;
}

function findElements(
  node: DefaultTreeAdapterTypes.Node,
  tagName: string
): DefaultTreeAdapterTypes.Element[] {
  const matches: DefaultTreeAdapterTypes.Element[] = [];

  if ("tagName" in node && node.tagName === tagName) {
    matches.push(node);
  }

  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      matches.push(...findElements(child, tagName));
    }
  }

  return matches;
}

function getAttribute(
  element: DefaultTreeAdapterTypes.Element,
  name: string
): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function normalizeContentType(value: string | null): string | null {
  const type = value?.split(";", 1)[0]?.trim().toLowerCase();
  return type || null;
}

function normalizeTitle(value: string | null): string | null {
  const title = value?.trim();
  return title || null;
}
