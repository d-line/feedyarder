import type { WorkerConfig } from "../config.js";

import type { DueFeed } from "./types.js";

export class HttpStatusError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export interface FetchedFeedDocument {
  body: string | null;
  etag: string | null;
  httpStatus: number;
  lastModified: string | null;
  status: "success" | "not_modified";
}

export async function fetchFeedDocument(
  feed: DueFeed,
  config: Pick<WorkerConfig, "FETCH_TOTAL_TIMEOUT_MS">
): Promise<FetchedFeedDocument> {
  const response = await fetch(feed.feedUrl, {
    headers: buildConditionalHeaders(feed),
    signal: AbortSignal.timeout(config.FETCH_TOTAL_TIMEOUT_MS)
  });

  if (response.status === 304) {
    return {
      body: null,
      etag: response.headers.get("etag"),
      httpStatus: response.status,
      lastModified: response.headers.get("last-modified"),
      status: "not_modified"
    };
  }

  if (!response.ok) {
    throw new HttpStatusError(
      response.status,
      `Feed request failed with HTTP ${response.status}.`
    );
  }

  return {
    body: await response.text(),
    etag: response.headers.get("etag"),
    httpStatus: response.status,
    lastModified: response.headers.get("last-modified"),
    status: "success"
  };
}

function buildConditionalHeaders(feed: DueFeed): HeadersInit {
  const headers: Record<string, string> = {
    "user-agent": "Feedyarder/0.1 (+https://localhost)"
  };

  if (feed.etag) {
    headers["if-none-match"] = feed.etag;
  }

  if (feed.lastModified) {
    headers["if-modified-since"] = feed.lastModified;
  }

  return headers;
}
