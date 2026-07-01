export type FetchStatus = "success" | "not_modified" | "error";
export type FetchErrorCategory = "network" | "parse";

export interface DueFeed {
  id: string;
  feedUrl: string;
  title: string | null;
  status: string;
  fetchIntervalMinutes: number;
  consecutiveErrorCount: number;
  lastErrorCategory: FetchErrorCategory | null;
  lastErrorMessage: string | null;
  etag: string | null;
  lastModified: string | null;
  authUsername: string | null;
  authPassword: string | null;
}

export interface FetchCycleSummaryItem {
  feedId: string;
  feedUrl: string;
  feedTitle?: string;
  status: FetchStatus;
  httpStatus?: number;
  errorCategory?: FetchErrorCategory;
  errorMessage?: string;
  missingPublishedAtCount?: number;
  previousStatus?: string;
  previousErrorCategory?: FetchErrorCategory;
  previousConsecutiveErrorCount?: number;
  consecutiveErrorCount?: number;
}

export interface NormalizedItem {
  guid: string | null;
  dedupeKey: string;
  title: string | null;
  url: string | null;
  author: string | null;
  summaryText: string | null;
  contentHtml: string | null;
  publishedAt: string | null;
  rawExtensionData: Record<string, unknown>;
}

export interface FetchOutcome {
  status: FetchStatus;
  errorCategory: FetchErrorCategory | null;
  errorMessage: string | null;
  missingPublishedAtCount: number;
  nextFetchIntervalMinutes: number;
  newItemCount: number;
  httpStatus: number | null;
  etag: string | null;
  lastModified: string | null;
  feedTitle: string | null;
  siteUrl: string | null;
  faviconUrl: string | null;
  items: NormalizedItem[];
  durationMs: number;
}
