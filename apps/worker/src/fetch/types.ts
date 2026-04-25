export type FetchStatus = "success" | "not_modified" | "error";
export type FetchErrorCategory = "network" | "parse";

export interface DueFeed {
  id: string;
  feedUrl: string;
  title: string | null;
  fetchIntervalMinutes: number;
  consecutiveErrorCount: number;
  etag: string | null;
  lastModified: string | null;
}

export interface FetchCycleSummaryItem {
  feedId: string;
  feedUrl: string;
  status: FetchStatus;
  errorCategory?: FetchErrorCategory;
  errorMessage?: string;
  missingPublishedAtCount?: number;
}

export interface FetchOutcome {
  status: FetchStatus;
  errorCategory?: FetchErrorCategory;
  errorMessage?: string;
  missingPublishedAtCount: number;
  nextFetchIntervalMinutes: number;
}
